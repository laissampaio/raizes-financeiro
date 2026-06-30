// Paleta e labels do briefing. Ponto unico de verdade pras cores de alerta,
// usado pelo card, pelo sumario e pelos filtros.

export const TEMPO_COR = '#378ADD'

const NEUTRO = {
  barLateral: '#9CA3AF',
  barGasto: null,
  badgeBg: '#EDEDEF',
  badgeText: '#52525B',
}

const CONFIG = {
  VERMELHO: {
    barLateral: '#E24B4A',
    barGasto: '#E24B4A',
    badgeBg: '#FCEBEB',
    badgeText: '#A32D2D',
    label: 'Crítico',
  },
  AMARELO: {
    barLateral: '#BA7517',
    barGasto: '#BA7517',
    badgeBg: '#FAEEDA',
    badgeText: '#854F0B',
    label: 'Atenção',
  },
  VERDE: {
    barLateral: '#639922',
    barGasto: '#639922',
    badgeBg: '#EAF3DE',
    badgeText: '#3B6D11',
    label: 'No prazo',
  },
  ABAIXO: {
    barLateral: '#378ADD',
    barGasto: '#378ADD',
    badgeBg: '#E6F1FB',
    badgeText: '#185FA5',
    label: 'Abaixo do previsto',
  },
  SEM_ORCAMENTO: {
    ...NEUTRO,
    label: 'Sem orçamento',
  },
  ENCERRADO: {
    ...NEUTRO,
    label: 'Encerrado',
  },
}

// Qualquer valor de alerta que a Claude devolva fora dessas chaves (ex.: um
// projeto NAO_INICIADO, que nao esta na enum oficial do prompt) cai aqui em
// vez de quebrar a UI.
export function getAlertaConfig(alerta) {
  if (CONFIG[alerta]) return CONFIG[alerta]
  return { ...NEUTRO, label: alerta || '—' }
}

const STATUS_LABEL = {
  ATIVO: 'Ativo',
  ENCERRADO: 'Encerrado',
  NAO_INICIADO: 'Não iniciado',
}

export function getStatusLabel(status) {
  return STATUS_LABEL[status] ?? status ?? '—'
}

// Usado pelos 4 blocos do sumario no topo.
export const SUMARIO_BLOCOS = [
  { key: 'VERMELHO', titulo: 'Críticos', cor: '#E24B4A' },
  { key: 'AMARELO', titulo: 'Atenção', cor: '#BA7517' },
  { key: 'VERDE', titulo: 'No prazo', cor: '#639922' },
  { key: 'ABAIXO', titulo: 'Abaixo do previsto', cor: '#378ADD' },
]

export const FILTROS = [
  { key: 'andamento', label: 'Em Andamento' },
  { key: 'todos', label: 'Todos' },
]
