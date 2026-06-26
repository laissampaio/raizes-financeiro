function HeaderTopo({ autenticado, carregando, atualizadoEm, onLogin, onAtualizar }) {
  return (
    <header className="header-topo">
      <div className="header-titulos">
        <h1>Projetos — controle de orçamento</h1>
        <p>Raízes Desenvolvimento Sustentável</p>
      </div>

      <div className="header-acoes">
        {atualizadoEm && <span className="header-timestamp">Atualizado em {atualizadoEm}</span>}

        {!autenticado && (
          <button type="button" className="btn btn-google" onClick={onLogin}>
            <i className="ti ti-brand-google" aria-hidden="true" />
            Entrar com Google
          </button>
        )}

        {autenticado && (
          <button
            type="button"
            className="btn btn-atualizar"
            onClick={onAtualizar}
            disabled={carregando}
          >
            <i className={`ti ti-refresh${carregando ? ' girando' : ''}`} aria-hidden="true" />
            {carregando ? 'Buscando dados...' : 'Atualizar'}
          </button>
        )}
      </div>
    </header>
  )
}

export default HeaderTopo
