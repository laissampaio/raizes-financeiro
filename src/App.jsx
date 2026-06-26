import { useEffect, useState } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import HeaderTopo from './components/HeaderTopo'
import SumarioTopo from './components/SumarioTopo'
import FiltrosBotoes from './components/FiltrosBotoes'
import CardProjeto from './components/CardProjeto'
import CardProjetoSkeleton from './components/CardProjetoSkeleton'
import ErrorBanner from './components/ErrorBanner'
import { getStoredToken, setStoredToken, clearStoredToken } from './lib/auth'
import { lerSheets } from './lib/sheets'
import { analisarComClaude } from './lib/claude'
import { slugProjeto } from './lib/parse'

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

function filtrarProjetos(projetos, filtro) {
  if (filtro === 'todos') return projetos
  if (filtro === 'encerrados') return projetos.filter((p) => p.status === 'ENCERRADO')
  return projetos.filter((p) => p.alerta === filtro)
}

function App() {
  const [accessToken, setAccessToken] = useState(() => getStoredToken())
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  const [dashboardData, setDashboardData] = useState(null)
  const [atualizadoEm, setAtualizadoEm] = useState(null)
  const [filtroAtivo, setFiltroAtivo] = useState('todos')
  const [destacado, setDestacado] = useState(null)
  const [scrollTarget, setScrollTarget] = useState(null)

  const autenticado = Boolean(accessToken)

  const login = useGoogleLogin({
    scope: SCOPE,
    onSuccess: (resp) => {
      setStoredToken(resp.access_token, resp.expires_in)
      setAccessToken(resp.access_token)
      setErro(null)
    },
    onError: () => setErro('Não foi possível entrar com o Google. Tente novamente.'),
  })

  async function handleAtualizar() {
    setCarregando(true)
    setErro(null)
    try {
      const { projetos, lancamentos } = await lerSheets(accessToken)
      const resultado = await analisarComClaude(projetos, lancamentos)
      setDashboardData(resultado)
      setAtualizadoEm(
        new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      )
    } catch (err) {
      if (err.code === 'AUTH_EXPIRED') {
        clearStoredToken()
        setAccessToken(null)
        setErro('Sua sessão do Google expirou. Faça login novamente.')
      } else {
        setErro(err.message || 'Ocorreu um erro inesperado. Tente novamente.')
      }
    } finally {
      setCarregando(false)
    }
  }

  function handleSelecionarProjeto(nome) {
    setFiltroAtivo('todos')
    setScrollTarget(nome)
  }

  useEffect(() => {
    if (!scrollTarget) return
    const id = `card-${slugProjeto(scrollTarget)}`
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setDestacado(scrollTarget)
      setTimeout(() => setDestacado((atual) => (atual === scrollTarget ? null : atual)), 2000)
    }
    setScrollTarget(null)
  }, [scrollTarget, filtroAtivo])

  const projetos = dashboardData?.projetos ?? []
  const projetosFiltrados = filtrarProjetos(projetos, filtroAtivo)

  return (
    <div className="pagina">
      <HeaderTopo
        autenticado={autenticado}
        carregando={carregando}
        atualizadoEm={atualizadoEm}
        onLogin={login}
        onAtualizar={handleAtualizar}
      />

      {erro && <ErrorBanner mensagem={erro} onRetry={autenticado ? handleAtualizar : undefined} />}

      {!autenticado && (
        <div className="estado-vazio">
          <i className="ti ti-lock" aria-hidden="true" />
          <p>Faça login para ver os dados</p>
        </div>
      )}

      {autenticado && carregando && (
        <div className="cards-lista">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardProjetoSkeleton key={i} />
          ))}
        </div>
      )}

      {autenticado && !carregando && !dashboardData && (
        <div className="estado-vazio">
          <i className="ti ti-cloud-upload" aria-hidden="true" />
          <p>Clique em Atualizar para carregar os projetos</p>
        </div>
      )}

      {autenticado && !carregando && dashboardData && (
        <>
          <SumarioTopo
            projetos={projetos}
            resumo={dashboardData.resumo}
            onSelecionarProjeto={handleSelecionarProjeto}
          />
          <FiltrosBotoes filtroAtivo={filtroAtivo} onSelecionar={setFiltroAtivo} />
          <div className="cards-lista">
            {projetosFiltrados.map((projeto) => (
              <CardProjeto
                key={projeto.nome}
                projeto={projeto}
                id={`card-${slugProjeto(projeto.nome)}`}
                destacado={destacado === projeto.nome}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default App
