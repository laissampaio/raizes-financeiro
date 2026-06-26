import { SUMARIO_BLOCOS } from '../lib/alertaConfig'

function SumarioTopo({ projetos, resumo, onSelecionarProjeto }) {
  return (
    <section className="sumario-grid">
      {SUMARIO_BLOCOS.map((bloco) => {
        const lista = projetos.filter((p) => p.alerta === bloco.key)
        const contador = resumo?.[bloco.key.toLowerCase()] ?? lista.length

        return (
          <div key={bloco.key} className="sumario-bloco" style={{ '--cor-bloco': bloco.cor }}>
            <div className="sumario-bloco-titulo">
              <span className="contador">{contador}</span>
              <span className="label">{bloco.titulo}</span>
            </div>

            {lista.length === 0 ? (
              <p className="sumario-vazio">Nenhum projeto</p>
            ) : (
              <ul className="sumario-lista">
                {lista.map((p) => (
                  <li key={p.nome} onClick={() => onSelecionarProjeto(p.nome)}>
                    <span className="nome">{p.nome}</span>
                    <span className="pct">
                      {p.pct_gasto != null ? `${Math.round(p.pct_gasto)}%` : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </section>
  )
}

export default SumarioTopo
