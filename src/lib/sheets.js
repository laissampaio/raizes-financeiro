import {
  parseValorBR,
  parseDataBR,
  parseMesAno,
  rowsToObjects,
  getColApprox,
  normalizarHeader,
  localizarLinhaCabecalho,
} from './parse'

const SHEETS_ID = import.meta.env.VITE_GOOGLE_SHEETS_ID
const ABA_LANCAMENTOS = 'Lançamentos'

// A planilha real não tem uma aba "Orçamentos" separada (como o briefing
// original supunha) — tem uma aba "Proposta dos Projetos" com duas tabelas
// lado a lado: linhas de custo por item (A:K, várias linhas por projeto,
// precisa somar "Valor Total") e o registro de datas por projeto (N:P, uma
// linha por projeto). As duas têm coluna "Nome Projeto", então lemos como
// dois ranges separados pra evitar que uma sobrescreva a outra ao mapear
// por nome de cabeçalho.
const ABA_PROPOSTAS = 'Proposta dos Projetos'

export class SheetsError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'SheetsError'
    this.code = code
  }
}

// Le os dados da planilha e retorna ja limpos/tipados, prontos pra virar o
// JSON que vai no prompt do Claude.
export async function lerSheets(accessToken) {
  const titulos = await buscarTitulosAbas(accessToken)

  const abaLancamentos = encontrarAba(titulos, ABA_LANCAMENTOS)
  const abaPropostas = encontrarAba(titulos, ABA_PROPOSTAS)
  const faltando = [
    !abaLancamentos && ABA_LANCAMENTOS,
    !abaPropostas && ABA_PROPOSTAS,
  ].filter(Boolean)
  if (faltando.length > 0) {
    throw new SheetsError(
      `Não encontrei a(s) aba(s) ${faltando.map((f) => `"${f}"`).join(' e ')} na planilha. ` +
        `Abas existentes: ${titulos.join(', ')}.`,
      'ABA_NAO_ENCONTRADA',
    )
  }

  const ranges = [
    `'${abaLancamentos}'`,
    `'${abaPropostas}'!A:K`,
    `'${abaPropostas}'!N:P`,
  ]
    .map((r) => `ranges=${encodeURIComponent(r)}`)
    .join('&')
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_ID}/values:batchGet?${ranges}`

  const response = await chamarSheetsApi(url, accessToken)
  const data = await response.json()
  const valueRanges = data.valueRanges || []

  // batchGet retorna os ranges na mesma ordem em que foram pedidos.
  const lancamentos = extrairLancamentos(valueRanges[0]?.values)
  const linhasCusto = linhasComCabecalhoReal(valueRanges[1]?.values, ['Nome Projeto', 'Valor Total'])
  const linhasDatas = linhasComCabecalhoReal(valueRanges[2]?.values, [
    'Nome Projeto',
    'Data Inicio',
    'Data Final',
  ])
  const projetos = montarProjetos(linhasCusto, linhasDatas)

  return { projetos, lancamentos }
}

async function buscarTitulosAbas(accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_ID}?fields=sheets.properties.title`
  const response = await chamarSheetsApi(url, accessToken)
  const data = await response.json()
  return (data.sheets ?? []).map((s) => s.properties.title)
}

function encontrarAba(titulos, esperado) {
  const alvo = normalizarHeader(esperado)
  return titulos.find((t) => normalizarHeader(t) === alvo)
}

async function chamarSheetsApi(url, accessToken) {
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
    const detalhe = await extrairErroGoogle(response)
    throw new SheetsError(
      `Não foi possível ler a planilha (HTTP ${response.status}${detalhe ? `: ${detalhe}` : ''}).`,
      'HTTP_ERROR',
    )
  }

  return response
}

async function extrairErroGoogle(response) {
  try {
    const data = await response.json()
    return data?.error?.message ?? null
  } catch {
    return null
  }
}

// Acha a linha de cabecalho de verdade (em vez de assumir que e a primeira)
// e so depois mapeia as linhas em objetos por nome de coluna.
function linhasComCabecalhoReal(values, esperadas) {
  if (!values || values.length === 0) return []
  const indice = localizarLinhaCabecalho(values, esperadas)
  return rowsToObjects(values.slice(indice))
}

function checarColunas(linhas, obrigatorias, nomeAba) {
  if (linhas.length === 0) return
  const colunas = Object.keys(linhas[0]).map(normalizarHeader)
  const faltando = obrigatorias.filter((esperada) => !colunas.includes(normalizarHeader(esperada)))
  if (faltando.length > 0) {
    throw new SheetsError(
      `Aba "${nomeAba}": coluna(s) não encontrada(s): ${faltando.join(', ')}.`,
      'COLUNA_FALTANDO',
    )
  }
}

function extrairLancamentos(values) {
  const esperadas = ['Data', 'Categoria', 'Detalhamento', 'Débito']
  const linhas = linhasComCabecalhoReal(values, esperadas)
  checarColunas(linhas, esperadas, ABA_LANCAMENTOS)

  return linhas
    .filter((row) => String(getColApprox(row, 'Categoria')).trim() === 'Projetos')
    .filter((row) => String(getColApprox(row, 'Detalhamento')).trim() !== '')
    .map((row) => ({
      data: parseDataBR(getColApprox(row, 'Data')),
      detalhamento: String(getColApprox(row, 'Detalhamento')).trim(),
      debito: parseValorBR(getColApprox(row, 'Débito')),
      credito: parseValorBR(getColApprox(row, 'Crédito')),
    }))
}

// Soma "Valor Total" por "Nome Projeto" nas linhas de custo, depois junta
// com o registro de datas (uma linha por projeto). Um projeto sem nenhuma
// linha de custo correspondente fica com valor_total = null (SEM_ORCAMENTO),
// em vez de 0 — são situações diferentes.
function montarProjetos(linhasCusto, linhasDatas) {
  checarColunas(linhasCusto, ['Nome Projeto', 'Valor Total'], ABA_PROPOSTAS)
  checarColunas(linhasDatas, ['Nome Projeto', 'Data Inicio', 'Data Final'], ABA_PROPOSTAS)

  const totalPorProjeto = new Map()
  for (const linha of linhasCusto) {
    const nome = String(getColApprox(linha, 'Nome Projeto')).trim()
    if (!nome) continue
    const valor = parseValorBR(getColApprox(linha, 'Valor Total'))
    totalPorProjeto.set(nome, (totalPorProjeto.get(nome) ?? 0) + valor)
  }

  return linhasDatas
    .filter((linha) => String(getColApprox(linha, 'Nome Projeto')).trim() !== '')
    .map((linha) => {
      const nome = String(getColApprox(linha, 'Nome Projeto')).trim()
      return {
        nome,
        data_inicio: parseMesAno(getColApprox(linha, 'Data Inicio')),
        data_fim: parseMesAno(getColApprox(linha, 'Data Final')),
        valor_total: totalPorProjeto.has(nome) ? totalPorProjeto.get(nome) : null,
      }
    })
}
