import { getAlertaConfig, getStatusLabel, TEMPO_COR } from '../lib/alertaConfig'

function formatBRL(valor) {
  if (valor == null) return '—'
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatPct(valor) {
  if (valor == null) return '—'
  return `${Math.round(valor)}%`
}

function clampPct(valor) {
  return Math.min(100, Math.max(0, valor ?? 0))
}

function CardProjeto({ projeto, id, destacado }) {
  const cfg = getAlertaConfig(projeto.alerta)
  const mostrarBarraGasto = projeto.pct_gasto != null && cfg.barGasto != null

  return (
    <article id={id} className={`card-projeto${destacado ? ' destaque' : ''}`}>
      <div className="card-projeto-barra" style={{ '--cor-alerta': cfg.barLateral }} />

      <div className="card-projeto-corpo">
        <div className="card-header">
          <div className="card-header-info">
            <h3>{projeto.nome}</h3>
            <span className="datas">
              {projeto.data_inicio} – {projeto.data_fim} ·{' '}
              <span className="status-texto">{getStatusLabel(projeto.status)}</span>
            </span>
          </div>
          <div className="card-header-badges">
            <span
              className="badge"
              style={{ '--badge-bg': cfg.badgeBg, '--badge-text': cfg.badgeText }}
            >
              {cfg.label}
            </span>
          </div>
        </div>

        <div className="barras">
          <div className="barra-linha">
            <span className="barra-label">Tempo</span>
            <div className="barra-trilha">
              <div
                className="barra-progresso"
                style={{ width: `${clampPct(projeto.pct_tempo)}%`, '--cor-barra': TEMPO_COR }}
              />
            </div>
            <span className="barra-pct">{formatPct(projeto.pct_tempo)}</span>
          </div>

          {mostrarBarraGasto && (
            <div className="barra-linha">
              <span className="barra-label">Orçamento</span>
              <div className="barra-trilha">
                <div
                  className="barra-progresso"
                  style={{ width: `${clampPct(projeto.pct_gasto)}%`, '--cor-barra': cfg.barGasto }}
                />
              </div>
              <span className="barra-pct">{formatPct(projeto.pct_gasto)}</span>
            </div>
          )}
        </div>

        <div className="card-valores">
          <div className="item">
            <span className="rotulo">Orçamento total</span>
            <span className="valor">{formatBRL(projeto.orcamento_total)}</span>
          </div>
          <div className="item">
            <span className="rotulo">Total gasto</span>
            <span className="valor">{formatBRL(projeto.total_gasto)}</span>
          </div>
          {projeto.saldo_restante != null && (
            <div className="item">
              <span className="rotulo">Saldo restante</span>
              <span className="valor">{formatBRL(projeto.saldo_restante)}</span>
            </div>
          )}
        </div>

      </div>
    </article>
  )
}

export default CardProjeto
