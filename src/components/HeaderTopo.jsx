function HeaderTopo({ carregando, atualizadoEm, onAtualizar }) {
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
          disabled={carregando}
        >
          <i className={`ti ti-refresh${carregando ? ' girando' : ''}`} aria-hidden="true" />
          {carregando ? 'Buscando dados...' : 'Atualizar'}
        </button>
      </div>
    </header>
  )
}

export default HeaderTopo
