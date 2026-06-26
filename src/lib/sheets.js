import {
  parseValorBR,
  parseDataBR,
  parseMesAno,
  rowsToObjects,
  getColApprox,
  normalizarHeader,
} from './parse'

const SHEETS_ID = import.meta.env.VITE_GOOGLE_SHEETS_ID
const ABA_LANCAMENTOS = 'Lançamentos'

// A planilha real não tem uma aba "Orçamentos" separada (como o briefing
// original supunha) — tem uma aba "Proposta de projetos" com duas tabelas
// lado a lado: linhas de custo por item (A:K, várias linhas por projeto,
// precisa somar "Valor Total") e o registro de datas por projeto (N:P, uma
// linha por projeto). As duas têm coluna "Nome Projeto", então lemos como
// dois ranges separados pra evitar que uma sobrescreva a outra ao mapear
// por nome de cabeçalho.
const ABA_PROPOSTAS = 'Proposta de projetos'
const RANGE_LINHAS_CUSTO = `'${ABA_PROPOSTAS}'!A:K`
const RANGE_DATAS_PROJETO = `'${ABA_PROPOSTAS}'!N:P`

export class SheetsError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'SheetsError'
    this.code = code
  }
}

// Le os dados da planilha e retorna ja limpos/tipados, prontos pra virar o
// JSON que vai no prompt do Claude.
export async function lerSheets(accessToken) {
  const ranges = [ABA_LANCAMENTOS, RANGE_LINHAS_CUSTO, RANGE_DATAS_PROJETO]
    .map((r) => `ranges=${encodeURIComponent(r)}`)
    .join('&')
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_ID}/values:batchGet?${ranges}`

  let response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    throw new SheetsError(
      'Não foi possível conectar ao Google Sheets. Verifique sua conexão.',
      'NETWORK',
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new SheetsError(
      'Sua sessão do Google expirou ou não tem acesso à planilha. Faça login novamente.',
      'AUTH_EXPIRED',
    )
  }
  if (!response.ok) {
    const detalhe = await extrairErroGoogle(response)
    throw new SheetsError(
      `Não foi possível ler a planilha (HTTP ${response.status}${detalhe ? `: ${detalhe}` : ''}).`,
      'HTTP_ERROR',
    )
  }

  const data = await response.json()
  const valueRanges = data.valueRanges || []

  // batchGet retorna os ranges na mesma ordem em que foram pedidos.
  const lancamentos = extrairLancamentos(valueRanges[0]?.values)
  const linhasCusto = rowsToObjects(valueRanges[1]?.values)
  const linhasDatas = rowsToObjects(valueRanges[2]?.values)
  const projetos = montarProjetos(linhasCusto, linhasDatas)

  return { projetos, lancamentos }
}

async function extrairErroGoogle(response) {
  try {
    const data = await response.json()
    return data?.error?.message ?? null
  } catch {
    return null
  }
}

function checarColunas(linhas, obrigatorias, nomeAba) {
  if (linhas.length === 0) return
  const colunas = Object.keys(linhas[0]).map(normalizarHeader)
  const faltando = obrigatorias.filter((esperada) => !colunas.includes(normalizarHeader(esperada)))
  if (faltando.length > 0) {
    throw new SheetsError(
      `Aba "${nomeAba}": coluna(s) não encontrada(s): ${faltando.join(', ')}.`,
      'COLUNA_FALTANDO',
    )
  }
}

function extrairLancamentos(values) {
  const linhas = rowsToObjects(values)
  checarColunas(linhas, ['Data', 'Categoria', 'Detalhamento', 'Débito'], ABA_LANCAMENTOS)

  return linhas
    .filter((row) => String(getColApprox(row, 'Categoria')).trim() === 'Projetos')
    .filter((row) => String(getColApprox(row, 'Detalhamento')).trim() !== '')
    .map((row) => ({
      data: parseDataBR(getColApprox(row, 'Data')),
      detalhamento: String(getColApprox(row, 'Detalhamento')).trim(),
      debito: parseValorBR(getColApprox(row, 'Débito')),
      credito: parseValorBR(getColApprox(row, 'Crédito')),
    }))
}

// Soma "Valor Total" por "Nome Projeto" nas linhas de custo, depois junta
// com o registro de datas (uma linha por projeto). Um projeto sem nenhuma
// linha de custo correspondente fica com valor_total = null (SEM_ORCAMENTO),
// em vez de 0 — são situações diferentes.
function montarProjetos(linhasCusto, linhasDatas) {
  checarColunas(linhasCusto, ['Nome Projeto', 'Valor Total'], ABA_PROPOSTAS)
  checarColunas(linhasDatas, ['Nome Projeto', 'Data Inicio', 'Data Final'], ABA_PROPOSTAS)

  const totalPorProjeto = new Map()
  for (const linha of linhasCusto) {
    const nome = String(getColApprox(linha, 'Nome Projeto')).trim()
    if (!nome) continue
    const valor = parseValorBR(getColApprox(linha, 'Valor Total'))
    totalPorProjeto.set(nome, (totalPorProjeto.get(nome) ?? 0) + valor)
  }

  return linhasDatas
    .filter((linha) => String(getColApprox(linha, 'Nome Projeto')).trim() !== '')
    .map((linha) => {
      const nome = String(getColApprox(linha, 'Nome Projeto')).trim()
      return {
        nome,
        data_inicio: parseMesAno(getColApprox(linha, 'Data Inicio')),
        data_fim: parseMesAno(getColApprox(linha, 'Data Final')),
        valor_total: totalPorProjeto.has(nome) ? totalPorProjeto.get(nome) : null,
      }
    })
}
