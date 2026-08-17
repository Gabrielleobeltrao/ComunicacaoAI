import type { AppDefinition } from '../../types.js'
import { native } from '../shared.js'
import { MAX_CANDLES, MIN_CANDLES } from './candles.js'
import { PATTERN_KEYS } from './patterns.js'

// --- Candle Analyzer ---------------------------------------------------------------
//
// Um App oficial que não fala com ninguém. Ele recebe uma série OHLCV e devolve o que
// ela mostra: indicadores, padrões e um escore com as razões.
//
// `auth: none` e `allowedDomains: []` não são preguiça de configuração — são o
// contrato. Este App não busca cotação e não conhece corretora, e é por isso que serve
// para qualquer origem de dados: um App de mercado, um webhook, uma planilha. Quem
// traz os dados é outra peça do fluxo.
//
// Todas as ações são `read`: nada aqui altera nada, nem no sistema nem no mundo. Uma
// ação de leitura roda em automação sem precisar de autorização de escrita — que é
// exatamente o que se quer de uma análise que corre a cada vela.

const candleSchema = {
  type: 'object' as const,
  properties: {
    timestamp: { type: 'number', description: 'Momento da vela, em milissegundos.' },
    open: { type: 'number', description: 'Preço de abertura.' },
    high: { type: 'number', description: 'Máxima.' },
    low: { type: 'number', description: 'Mínima.' },
    close: { type: 'number', description: 'Fechamento.' },
    volume: { type: 'number', description: 'Volume negociado. Opcional.' },
    closed: { type: 'boolean', description: 'A vela já fechou. Ausente é tratado como fechada.' },
  },
  required: ['timestamp', 'open', 'high', 'low', 'close'],
  additionalProperties: true,
}

const entradaBase = {
  symbol: { type: 'string', description: 'O ativo, como você o chama. Ex.: PETR4, BTCUSDT. É só um rótulo.' },
  timeframe: { type: 'string', description: 'O período de cada vela. Ex.: 5m, 1h, 1d. É só um rótulo.' },
  candles: {
    type: 'array',
    description: `A série OHLCV, do mais antigo para o mais novo. Mínimo ${MIN_CANDLES}, máximo ${MAX_CANDLES} velas.`,
    items: candleSchema,
  },
  closedOnly: { type: 'boolean', description: 'Ignorar velas ainda em formação. Padrão: true.' },
}

const schemaCom = (extra: Record<string, unknown> = {}, required = ['symbol', 'timeframe', 'candles']) => ({
  type: 'object' as const,
  properties: { ...entradaBase, ...extra },
  required,
  additionalProperties: false,
})

export const manifest: AppDefinition = {
  key: 'candle_analyzer',
  version: '1.0.0',
  source: 'system',
  name: 'Análise de candles',
  description: 'Calcula indicadores e reconhece padrões numa série de candles que você fornecer. Não busca cotação e não opera.',
  icon: 'candlestick-chart',
  categories: ['dados', 'analise'],
  // Sem credencial: não há nada para autenticar contra.
  auth: { kind: 'none', fields: [] },
  // Sem domínio: este App não faz requisição nenhuma.
  allowedDomains: [],
  supportsMultipleConnections: false,
  // Instantâneo: conectar é só habilitar, porque não há o que configurar.
  activation: 'instant',
  actions: [
    {
      key: 'candles_calculate_indicators',
      name: 'Calcular indicadores',
      description:
        'Calcula SMA(20/50), EMA(9/21), RSI(14), ATR(14) e volume relativo de uma série de candles que você já tem. ' +
        'Use quando precisar dos números, sem juízo de valor sobre eles.',
      risk: 'read',
      inputSchema: schemaCom(),
      execution: native('candles_calculate_indicators'),
    },
    {
      key: 'candles_detect_patterns',
      name: 'Reconhecer padrões',
      description:
        'Diz quais padrões de candle aparecem na última vela fechada: Doji, Martelo, Estrela cadente, Engolfo de alta/baixa, Estrela da manhã/noite. ' +
        'Devolve também por que cada um foi reconhecido.',
      risk: 'read',
      inputSchema: schemaCom({
        patterns: {
          type: 'array',
          description: `Restringe a busca a alguns padrões. Vazio procura todos. Valores: ${PATTERN_KEYS.join(', ')}.`,
          items: { type: 'string' },
        },
      }),
      execution: native('candles_detect_patterns'),
    },
    {
      key: 'candles_find_opportunities',
      name: 'Procurar oportunidade',
      description:
        'Junta padrões, tendência, RSI e volume num escore de 0 a 100 e diz se há oportunidade, em que direção e por quê. ' +
        'NÃO recomenda compra nem venda: descreve o que a série mostra.',
      risk: 'read',
      inputSchema: schemaCom({
        patterns: { type: 'array', description: 'Restringe os padrões considerados. Vazio considera todos.', items: { type: 'string' } },
        indicators: { type: 'array', description: 'Reservado para uso futuro; hoje todos os indicadores são calculados.', items: { type: 'string' } },
        minimumScore: { type: 'number', description: 'Escore mínimo para chamar de oportunidade. Padrão: 60.' },
      }),
      execution: native('candles_find_opportunities'),
    },
  ],
  status: 'published',
  // Visível no catálogo, e ainda não ligável. O analisador está pronto e testado, mas o
  // fluxo em volta dele — de onde vêm os candles, o que se faz com o sinal — não está.
  // Liberar a peça isolada convidaria a montar meio caminho e concluir que não
  // funciona.
  availability: 'coming_soon',
  dataAccess: ['Somente os candles que você enviar em cada chamada'],
  storageNote: 'Nada é guardado por este App: ele calcula e devolve. Guardar o resultado é escolha da rotina que o chamou.',
  disconnectNote: 'Desconectar apenas remove as ações dos agentes. Não há dado deste App para apagar.',
}
