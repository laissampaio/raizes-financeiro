// Parsers para os formatos usados na planilha (moeda e datas em pt-BR).
// Normalizamos tudo aqui antes de mandar pro Claude, pra ele nao precisar
// adivinhar formato de numero/data e o calculo financeiro ficar confiavel.

export function parseValorBR(value) {
  if (typeof value === 'number') return value
  if (value === null || value === undefined) return 0

  const raw = String(value).trim()
  if (raw === '') return 0

  const negativoPorParenteses = /^\(.*\)$/.test(raw)
  let limpo = raw.replace(/^\(|\)$/g, '').replace(/R\$\s?/gi, '').trim()
  limpo = limpo.replace(/\./g, '').replace(',', '.')

  const numero = parseFloat(limpo)
  if (Number.isNaN(numero)) return 0

  return negativoPorParenteses ? -Math.abs(numero) : numero
}

// "DD/MM/YYYY" -> "YYYY-MM-DD" (ou null se vazio/invalido)
export function parseDataBR(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return null

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return null

  const [, dia, mes, anoRaw] = match
  const ano = anoRaw.length === 2 ? `20${anoRaw}` : anoRaw

  const diaP = dia.padStart(2, '0')
  const mesP = mes.padStart(2, '0')
  return `${ano}-${mesP}-${diaP}`
}

// "MM/YY" -> "YYYY-MM" (ou null se vazio/invalido)
export function parseMesAno(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return null

  const match = raw.match(/^(\d{1,2})\/(\d{2,4})$/)
  if (!match) return null

  const [, mes, anoRaw] = match
  const ano = anoRaw.length === 2 ? `20${anoRaw}` : anoRaw
  const mesP = mes.padStart(2, '0')
  return `${ano}-${mesP}`
}

// Mapeia linhas brutas da Sheets API (array de arrays) em objetos por nome de
// cabecalho, em vez de depender de posicao fixa de coluna (a aba de
// Orcamentos, por exemplo, tem as colunas relevantes "do lado direito").
export function rowsToObjects(values) {
  if (!values || values.length === 0) return []

  const headers = values[0].map((h) => String(h ?? '').trim())
  const linhas = values.slice(1)

  return linhas
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => {
      const obj = {}
      headers.forEach((header, i) => {
        if (header === '') return
        obj[header] = row[i] !== undefined ? row[i] : ''
      })
      return obj
    })
}

// Acha a linha de cabecalho real entre as primeiras linhas da aba, em vez de
// assumir que e sempre a linha 0 — a aba "Lançamentos", por exemplo, tem uma
// linha de filtros/anotações antes da linha com os nomes de coluna de fato
// ("Crédito"/"Débito"/"Saldo"). Escolhe a linha com mais nomes esperados.
export function localizarLinhaCabecalho(values, esperadas, maxLinhasVarridas = 5) {
  let melhorIndice = 0
  let melhorPontuacao = -1

  for (let i = 0; i < Math.min(maxLinhasVarridas, values.length); i++) {
    const linha = (values[i] ?? []).map(normalizarHeader)
    const pontuacao = esperadas.filter((e) => linha.includes(normalizarHeader(e))).length
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao
      melhorIndice = i
    }
  }

  return melhorIndice
}

export function normalizarHeader(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

// Busca por nome de coluna ignorando acento/maiusculas — a planilha real tem
// inconsistencias (ex.: "Data Inicio" sem acento) em relacao ao que o
// briefing original descrevia, então casar por nome exato é fragil demais.
export function getColApprox(obj, nome) {
  const alvo = normalizarHeader(nome)
  const chave = Object.keys(obj).find((k) => normalizarHeader(k) === alvo)
  return chave !== undefined ? obj[chave] : ''
}

// Slug estavel a partir do nome do projeto, usado como id de DOM pro
// scroll-to-card (precisa ser estavel mesmo quando os filtros escondem o
// card, por isso nao usamos o indice da lista).
export function slugProjeto(nome) {
  return String(nome)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
