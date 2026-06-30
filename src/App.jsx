import { useEffect, useState } from 'react'
import HeaderTopo from './components/HeaderTopo'
import SumarioTopo from './components/SumarioTopo'
import FiltrosBotoes from './components/FiltrosBotoes'
import CardProjeto from './components/CardProjeto'
import CardProjetoSkeleton from './components/CardProjetoSkeleton'
import ErrorBanner from './components/ErrorBanner'
import { buscarDados } from './lib/supabase'
import { calcularMetricas } from './lib/metricas'
import { slugProjeto } from './lib/parse'

function filtrarProjetos(projetos, filtro) {
  if (filtro === 'todos') return projetos
  return projetos.filter((p) => p.status === 'ATIVO')
}

function App() {
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)
  const [projetos, setProjetos] = useState(null)
  const [atualizadoEm, setAtualizadoEm] = useState(null)
  const [filtroAtivo, setFiltroAtivo] = useState('andamento')
  const [destacado, setDestacado] = useState(null)
  const [scrollTarget, setScrollTarget] = useState(null)

  async function carregarDados() {
    setCarregando(true)
    setErro(null)
    try {
      const dados = await buscarDados()
      setProjetos(calcularMetricas(dados))
      setAtualizadoEm(
        new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      )
    } catch (err) {
      setErro(err.message || 'Ocorreu um erro inesperado. Tente novamente.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregarDados()
  }, [])

  function handleSelecionarProjeto(nome) {
    setFiltroAtivo('andamento')
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

  const projetosFiltrados = filtrarProjetos(projetos ?? [], filtroAtivo)

  return (
    <div className="pagina">
      <HeaderTopo
        carregando={carregando}
        atualizadoEm={atualizadoEm}
        onAtualizar={carregarDados}
      />

      {erro && <ErrorBanner mensagem={erro} onRetry={carregarDados} />}

      {carregando && (
        <div className="cards-lista">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardProjetoSkeleton key={i} />
          ))}
        </div>
      )}

      {!carregando && projetos && (
        <>
          <SumarioTopo projetos={projetos} onSelecionarProjeto={handleSelecionarProjeto} />
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
