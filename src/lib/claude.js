const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2000
const TIMEOUT_MS = 30000

export class ClaudeError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ClaudeError'
    this.code = code
  }
}

export async function analisarComClaude(projetos, lancamentos) {
  const prompt = montarPrompt(projetos, lancamentos)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ClaudeError(
        'A análise demorou demais e foi cancelada (timeout). Tente novamente.',
        'TIMEOUT',
      )
    }
    throw new ClaudeError(
      'Não foi possível conectar à API da Claude. Verifique sua conexão.',
      'NETWORK',
    )
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ClaudeError(
        'Chave da API da Anthropic inválida ou ausente. Verifique o .env.',
        'AUTH',
      )
    }
    if (response.status === 429) {
      throw new ClaudeError(
        'Limite de uso da API da Anthropic atingido. Tente novamente em alguns minutos.',
        'RATE_LIMIT',
      )
    }
    throw new ClaudeError(`A API da Claude retornou um erro (HTTP ${response.status}).`, 'HTTP_ERROR')
  }

  const data = await response.json()
  const texto = data?.content?.[0]?.text
  if (!texto) {
    throw new ClaudeError('A resposta da Claude veio vazia ou em formato inesperado.', 'RESPOSTA_VAZIA')
  }

  return parseRespostaClaude(texto)
}

function parseRespostaClaude(texto) {
  const limpo = texto
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()

  let json
  try {
    json = JSON.parse(limpo)
  } catch {
    throw new ClaudeError('A resposta da Claude não é um JSON válido.', 'JSON_INVALIDO')
  }

  if (!json.resumo || !Array.isArray(json.projetos)) {
    throw new ClaudeError('A resposta da Claude não tem o formato esperado.', 'JSON_INVALIDO')
  }

  return json
}

function montarPrompt(projetos, lancamentos) {
  const hoje = new Date().toISOString().slice(0, 10)

  return `Você é o analista financeiro da Raízes Desenvolvimento Sustentável.

Hoje é ${hoje}.

Abaixo estão os dados extraídos do Google Sheets.

## PROJETOS E ORÇAMENTOS
${JSON.stringify(projetos, null, 2)}

## LANÇAMENTOS REALIZADOS (apenas Categoria = "Projetos")
${JSON.stringify(lancamentos, null, 2)}

Para cada projeto, calcule:
1. Total gasto até hoje (soma dos débitos nos lançamentos onde Detalhamento = nome do projeto)
2. Duração total do projeto em dias (data_fim - data_inicio)
3. Dias decorridos até hoje
4. % do tempo decorrido = dias_decorridos / duracao_total * 100
5. % do orçamento gasto = total_gasto / orcamento_total * 100 (null se sem orçamento)
6. Status: ATIVO se hoje entre data_inicio e data_fim, ENCERRADO se passou, NAO_INICIADO se ainda não chegou
7. Alerta (apenas projetos ATIVOS com orçamento definido):
   - VERMELHO: % gasto > % tempo + 25
   - AMARELO: % gasto entre % tempo + 10 e % tempo + 25
   - VERDE: % gasto entre % tempo - 15 e % tempo + 10
   - ABAIXO: % gasto < % tempo - 15
   - SEM_ORCAMENTO: orçamento não definido
8. Narrativa: 1-2 frases em português explicando a situação.
   Exemplos:
   - VERMELHO: "75% do tempo decorrido, mas 93% do orçamento já consumido. Apenas R$ 6.000 restantes."
   - AMARELO: "38% do tempo decorrido, mas 53% do orçamento consumido. Ritmo acima do esperado."
   - VERDE: "Gasto proporcional ao tempo decorrido. Projeto dentro do planejado."
   - ABAIXO: "Gasto bem abaixo do esperado. Pode indicar atraso no início das atividades."
   - SEM_ORCAMENTO: "Orçamento não definido. Gasto total registrado: R$ X."

Atenção: nomes de projetos nos lançamentos podem ter pequenas variações em relação
à aba de orçamentos (ex: "Paracatu" vs "Paracatu Fase 2"). Trate como projetos
separados apenas se a diferença for claramente intencional.

Retorne APENAS JSON válido, sem markdown, sem texto adicional.

{
  "atualizado_em": "YYYY-MM-DD",
  "resumo": {
    "total_ativos": N,
    "vermelho": N,
    "amarelo": N,
    "verde": N,
    "abaixo": N,
    "sem_orcamento": N
  },
  "projetos": [
    {
      "nome": "string",
      "data_inicio": "MM/YY",
      "data_fim": "MM/YY",
      "status": "ATIVO | ENCERRADO | NAO_INICIADO",
      "pct_tempo": number,
      "orcamento_total": number | null,
      "total_gasto": number,
      "pct_gasto": number | null,
      "saldo_restante": number | null,
      "alerta": "VERMELHO | AMARELO | VERDE | ABAIXO | SEM_ORCAMENTO | ENCERRADO",
      "narrativa": "string"
    }
  ],
  "observacoes": ["string"]
}`
}
