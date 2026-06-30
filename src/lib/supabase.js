import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const GITHUB_TOKEN = import.meta.env.VITE_GITHUB_TOKEN
const GITHUB_REPO = 'laissampaio/raizes-financeiro'
const SYNC_WORKFLOW = 'sync.yml'
const SYNC_ESPERA_MS = 100_000

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function dispararSync(onContagem) {
  if (!GITHUB_TOKEN) throw new Error('VITE_GITHUB_TOKEN não configurado')

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${SYNC_WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'master' }),
    },
  )
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`GitHub API ${res.status}: ${txt}`)
  }

  // Contagem regressiva enquanto o runner inicializa e roda sync.py (~100s)
  const total = Math.ceil(SYNC_ESPERA_MS / 1000)
  for (let i = total; i > 0; i--) {
    onContagem?.(i)
    await new Promise((r) => setTimeout(r, 1000))
  }
  onContagem?.(0)
}

export class SupabaseError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'SupabaseError'
    this.code = code
  }
}

export async function buscarDados() {
  const [resProjetos, resOrcamentos] = await Promise.all([
    supabase.from('dim_projeto').select('id,nome,data_inicio,data_fim').order('nome'),
    supabase
      .from('fact_orcamento_linhas')
      .select('projeto_id,valor_total')
      .not('projeto_id', 'is', null),
  ])

  if (resProjetos.error)
    throw new SupabaseError(`Erro ao buscar projetos: ${resProjetos.error.message}`, 'FETCH')
  if (resOrcamentos.error)
    throw new SupabaseError(`Erro ao buscar orçamentos: ${resOrcamentos.error.message}`, 'FETCH')

  // Supabase PostgREST tem max_rows=1000 por página; busca todas as páginas
  const PAGE = 1000
  const lancamentos = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('fact_lancamentos')
      .select('projeto_id,debito,credito')
      .not('projeto_id', 'is', null)
      .range(offset, offset + PAGE - 1)
    if (error) throw new SupabaseError(`Erro ao buscar lançamentos: ${error.message}`, 'FETCH')
    if (!data || data.length === 0) break
    lancamentos.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }

  return {
    projetos: resProjetos.data,
    lancamentos,
    orcamentos: resOrcamentos.data,
  }
}
