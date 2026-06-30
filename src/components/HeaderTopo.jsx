function HeaderTopo({ carregando, contagem, atualizadoEm, onAtualizar }) {
  const sincronizando = contagem !== null
  const ocupado = carregando || sincronizando

  let labelBotao = 'Atualizar'
  if (sincronizando) labelBotao = `Sincronizando... (${contagem}s)`
  else if (carregando) labelBotao = 'Buscando dados...'

  return (
    <header className="header-topo">
      <div className="header-titulos">
        <h1>Projetos — controle de orçamento</h1>
        <p>Raízes Desenvolvimento Sustentável</p>
      </div>

      <div className="header-acoes">
        {atualizadoEm && <span className="header-timestamp">Atualizado às {atualizadoEm}</span>}
        <button
          type="button"
          className="btn btn-atualizar"
          onClick={onAtualizar}
          disabled={ocupado}
        >
          <i className={`ti ti-refresh${ocupado ? ' girando' : ''}`} aria-hidden="true" />
          {labelBotao}
        </button>
      </div>
    </header>
  )
}

export default HeaderTopo
