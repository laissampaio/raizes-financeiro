function parseInicio(dateStr) {
  if (!dateStr) return null
  const [year, month] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

function parseFim(dateStr) {
  if (!dateStr) return null
  const [year, month] = dateStr.split('-').map(Number)
  return new Date(year, month, 0)
}

export function calcularMetricas({ projetos, lancamentos, orcamentos }) {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const gastoPorId = new Map()
  const entradaPorId = new Map()
  for (const { projeto_id, debito, credito } of lancamentos) {
    if (projeto_id) {
      gastoPorId.set(projeto_id, (gastoPorId.get(projeto_id) ?? 0) + Number(debito ?? 0))
      entradaPorId.set(projeto_id, (entradaPorId.get(projeto_id) ?? 0) + Number(credito ?? 0))
    }
  }

  const orcPorId = new Map()
  for (const { projeto_id, valor_total } of orcamentos) {
    if (projeto_id && valor_total != null) {
      orcPorId.set(projeto_id, (orcPorId.get(projeto_id) ?? 0) + Number(valor_total))
    }
  }

  return projetos.map((p) => {
    const inicio = parseInicio(p.data_inicio)
    const fim = parseFim(p.data_fim)

    let status
    if (!inicio || !fim) status = 'NAO_INICIADO'
    else if (hoje < inicio) status = 'NAO_INICIADO'
    else if (hoje > fim) status = 'ENCERRADO'
    else status = 'ATIVO'

    const duracao = inicio && fim ? fim - inicio : 0
    const decorrido = inicio ? Math.max(0, hoje - inicio) : 0
    const pct_tempo = duracao > 0 ? Math.round(Math.min(100, (decorrido / duracao) * 100)) : 0

    const total_gasto = Math.abs(gastoPorId.get(p.id) ?? 0)
    const total_entradas = entradaPorId.get(p.id) ?? 0
    const orcBruto = orcPorId.has(p.id) ? orcPorId.get(p.id) : null
    const orcamento_total = orcBruto != null && orcBruto > 0 ? orcBruto : null
    const pct_gasto = orcamento_total ? Math.round((total_gasto / orcamento_total) * 100) : null
    const saldo_restante = orcamento_total != null ? orcamento_total - total_gasto : null
    // valor_total_projeto e pct_entradas ficarão TBD até ser preenchido
    const valor_total_projeto = null
    const pct_entradas = null
    const saldo_entradas = null

    let alerta
    if (status === 'ENCERRADO') alerta = 'ENCERRADO'
    else if (status === 'NAO_INICIADO') alerta = 'NAO_INICIADO'
    else if (orcamento_total == null) alerta = 'SEM_ORCAMENTO'
    else if (pct_gasto > pct_tempo + 25) alerta = 'VERMELHO'
    else if (pct_gasto > pct_tempo + 10) alerta = 'AMARELO'
    else if (pct_gasto < pct_tempo - 15) alerta = 'ABAIXO'
    else alerta = 'VERDE'

    const fmt = (d) =>
      d ? d.toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' }).replace('/', '/') : '—'

    return {
      ...p,
      data_inicio: fmt(inicio),
      data_fim: fmt(fim),
      status,
      pct_tempo,
      total_gasto,
      orcamento_total,
      pct_gasto,
      saldo_restante,
      total_entradas,
      valor_total_projeto,
      pct_entradas,
      saldo_entradas,
      alerta,
    }
  })
}
