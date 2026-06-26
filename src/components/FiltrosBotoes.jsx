import { FILTROS } from '../lib/alertaConfig'

function FiltrosBotoes({ filtroAtivo, onSelecionar }) {
  return (
    <div className="filtros">
      {FILTROS.map((f) => (
        <button
          key={f.key}
          type="button"
          className={`pill${filtroAtivo === f.key ? ' ativo' : ''}`}
          onClick={() => onSelecionar(f.key)}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}

export default FiltrosBotoes
