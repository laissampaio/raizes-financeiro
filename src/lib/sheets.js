import { parseValorBR, parseDataBR, parseMesAno, rowsToObjects } from './parse'

const SHEETS_ID = import.meta.env.VITE_GOOGLE_SHEETS_ID
const ABA_LANCAMENTOS = 'Lançamentos'
const ABA_ORCAMENTOS = 'Orçamentos'

export class SheetsError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'SheetsError'
    this.code = code
  }
}

// Le as duas abas da planilha e retorna os dados ja limpos/tipados,
// prontos pra virar o JSON que vai no prompt do Claude.
export async function lerSheets(accessToken) {
  const ranges = [ABA_LANCAMENTOS, ABA_ORCAMENTOS]
    .map((aba) => `ranges=${encodeURIComponent(aba)}`)
    .join('&')
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_ID}/values:batchGet?${ranges}`

  let response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    throw new SheetsError(
      'Não foi possível conectar ao Google Sheets. Verifique sua conexão.',
      'NETWORK',
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new SheetsError(
      'Sua sessão do Google expirou ou não tem acesso à planilha. Faça login novamente.',
      'AUTH_EXPIRED',
    )
  }
  if (!response.ok) {
    throw new SheetsError(
      `Não foi possível ler a planilha (HTTP ${response.status}).`,
      'HTTP_ERROR',
    )
  }

  const data = await response.json()
  const valueRanges = data.valueRanges || []

  // batchGet retorna os ranges na mesma ordem em que foram pedidos.
  const lancamentos = extrairLancamentos(valueRanges[0]?.values)
  const projetos = extrairOrcamentos(valueRanges[1]?.values)

  return { projetos, lancamentos }
}

function checarColunas(linhas, obrigatorias, nomeAba) {
  if (linhas.length === 0) return
  const colunas = Object.keys(linhas[0])
  const faltando = obrigatorias.filter((c) => !colunas.includes(c))
  if (faltando.length > 0) {
    throw new SheetsError(
      `Aba "${nomeAba}": coluna(s) não encontrada(s): ${faltando.join(', ')}.`,
      'COLUNA_FALTANDO',
    )
  }
}

function extrairLancamentos(values) {
  const linhas = rowsToObjects(values)
  checarColunas(linhas, ['Data', 'Categoria', 'Detalhamento', 'Débito'], ABA_LANCAMENTOS)

  return linhas
    .filter((row) => String(row['Categoria'] ?? '').trim() === 'Projetos')
    .filter((row) => String(row['Detalhamento'] ?? '').trim() !== '')
    .map((row) => ({
      data: parseDataBR(row['Data']),
      detalhamento: String(row['Detalhamento']).trim(),
      debito: parseValorBR(row['Débito']),
      credito: parseValorBR(row['Crédito']),
    }))
}

function extrairOrcamentos(values) {
  const linhas = rowsToObjects(values)
  checarColunas(linhas, ['Nome Projeto', 'Data Início', 'Data Final'], ABA_ORCAMENTOS)

  return linhas
    .filter((row) => String(row['Nome Projeto'] ?? '').trim() !== '')
    .map((row) => {
      const valorRaw = row['Valor Total']
      const valorVazio = valorRaw === undefined || String(valorRaw).trim() === ''
      return {
        nome: String(row['Nome Projeto']).trim(),
        data_inicio: parseMesAno(row['Data Início']),
        data_fim: parseMesAno(row['Data Final']),
        valor_total: valorVazio ? null : parseValorBR(valorRaw),
      }
    })
}
