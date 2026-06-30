import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export class SupabaseError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'SupabaseError'
    this.code = code
  }
}

export async function buscarDados() {
  const [resProjetos, resGastos, resOrcamentos] = await Promise.all([
    supabase.from('dim_projeto').select('id,nome,data_inicio,data_fim').order('nome'),
    supabase
      .from('fact_lancamentos')
      .select('projeto_id,debito')
      .not('projeto_id', 'is', null),
    supabase
      .from('fact_orcamento_linhas')
      .select('projeto_id,valor_total')
      .not('projeto_id', 'is', null),
  ])

  if (resProjetos.error)
    throw new SupabaseError(`Erro ao buscar projetos: ${resProjetos.error.message}`, 'FETCH')
  if (resGastos.error)
    throw new SupabaseError(`Erro ao buscar lançamentos: ${resGastos.error.message}`, 'FETCH')
  if (resOrcamentos.error)
    throw new SupabaseError(`Erro ao buscar orçamentos: ${resOrcamentos.error.message}`, 'FETCH')

  return {
    projetos: resProjetos.data,
    lancamentos: resGastos.data,
    orcamentos: resOrcamentos.data,
  }
}
