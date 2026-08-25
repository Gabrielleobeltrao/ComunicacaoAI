import type { AppDefinition } from '../../types.js'
import { native } from '../shared.js'
import { ALPACA_DOMAINS } from './client.js'

/**
 * Alpaca — a primeira corretora de verdade.
 *
 * SOMENTE SIMULAÇÃO neste ciclo. A conexão nasce em `paper`, e `live` é recusado em
 * três lugares: ao criar a conexão, ao resolvê-la para execução, e no cliente — que
 * não tem endereço de produção compilado. Ligar produção é decisão de produto, e ela
 * não foi tomada.
 *
 * O risco de cada ação é declarado aqui e é o que o grant usa: consulta é `read` e roda
 * sozinha; qualquer coisa que mexa em ordem ou posição é `high_risk` e exige que o dono
 * tenha autorizado AQUELA ação para uso autônomo — uma por uma, não em bloco.
 */

const str = (description: string) => ({ type: 'string', description })
const num = (description: string) => ({ type: 'number', description })
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
})

export const manifest: AppDefinition = {
  key: 'alpaca',
  version: '1.0.0',
  source: 'system',
  name: 'Alpaca (simulação)',
  description:
    'Conta de simulação da Alpaca: consulta saldo, posições e cotações, e envia ordens no ambiente de teste. Nenhuma ordem real é enviada.',
  icon: 'candlestick-chart',
  categories: ['dados', 'financeiro'],
  documentationUrl: 'https://alpaca.markets/docs/',
  auth: {
    kind: 'api_key',
    fields: [
      { key: 'keyId', label: 'Key ID', placeholder: 'PK...', required: true, secret: true },
      { key: 'secretKey', label: 'Secret Key', required: true, secret: true },
    ],
  },
  allowedDomains: ALPACA_DOMAINS,
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'alpaca_conta',
      name: 'Consultar conta',
      description: 'Saldo, patrimônio e poder de compra da conta de simulação.',
      risk: 'read',
      inputSchema: schema({}),
      execution: native('alpaca_conta'),
    },
    {
      key: 'alpaca_posicoes',
      name: 'Listar posições',
      description: 'As posições abertas, com preço médio e resultado não realizado.',
      risk: 'read',
      inputSchema: schema({}),
      execution: native('alpaca_posicoes'),
    },
    {
      key: 'alpaca_ordens',
      name: 'Listar ordens',
      description: 'As ordens da conta — abertas por padrão.',
      risk: 'read',
      inputSchema: schema({ status: str('open, closed ou all'), limit: num('quantas listar') }),
      execution: native('alpaca_ordens'),
    },
    {
      key: 'alpaca_cotacao',
      name: 'Consultar cotação',
      description: 'A última melhor compra e melhor venda de um ativo.',
      risk: 'read',
      inputSchema: schema({ symbol: str('o ativo, ex.: AAPL') }, ['symbol']),
      execution: native('alpaca_cotacao'),
    },
    {
      key: 'alpaca_barras',
      name: 'Buscar velas',
      description: 'As velas OHLCV fechadas de um ativo, prontas para análise.',
      risk: 'read',
      inputSchema: schema({ symbol: str('o ativo'), timeframe: str('1Min, 5Min, 15Min, 1Hour ou 1Day'), limit: num('quantas velas') }, ['symbol']),
      execution: native('alpaca_barras'),
    },
    {
      key: 'alpaca_criar_ordem',
      name: 'Enviar ordem',
      description: 'Envia uma ordem de compra ou venda na conta de simulação.',
      // Uma ordem muda dinheiro de lugar. Que seja simulado hoje não muda a classe do
      // risco — muda só a conta que sente.
      risk: 'high_risk',
      inputSchema: schema(
        {
          symbol: str('o ativo'),
          side: str('buy ou sell'),
          quantity: num('quantidade'),
          type: str('market ou limit'),
          limitPrice: num('preço limite'),
          timeInForce: str('day, gtc, ioc ou fok'),
        },
        ['symbol', 'side', 'quantity'],
      ),
      execution: native('alpaca_criar_ordem'),
    },
    {
      key: 'alpaca_ordem_bracket',
      name: 'Enviar ordem com proteção',
      description: 'Envia uma ordem com stop-loss e take-profit presos a ela.',
      risk: 'high_risk',
      inputSchema: schema(
        {
          symbol: str('o ativo'),
          side: str('buy ou sell'),
          quantity: num('quantidade'),
          type: str('market ou limit'),
          limitPrice: num('preço limite da entrada'),
          takeProfitPrice: num('preço do take-profit'),
          stopLossPrice: num('preço do stop-loss'),
          timeInForce: str('day ou gtc'),
        },
        ['symbol', 'side', 'quantity', 'takeProfitPrice', 'stopLossPrice'],
      ),
      execution: native('alpaca_ordem_bracket'),
    },
    {
      key: 'alpaca_cancelar_ordem',
      name: 'Cancelar ordem',
      description: 'Cancela uma ordem ainda aberta.',
      risk: 'high_risk',
      inputSchema: schema({ orderId: str('o id da ordem') }, ['orderId']),
      execution: native('alpaca_cancelar_ordem'),
    },
    {
      key: 'alpaca_substituir_ordem',
      name: 'Alterar ordem',
      description: 'Muda quantidade ou preço de uma ordem aberta.',
      risk: 'high_risk',
      inputSchema: schema({ orderId: str('o id da ordem'), quantity: num('nova quantidade'), limitPrice: num('novo limite'), stopPrice: num('novo stop') }, ['orderId']),
      execution: native('alpaca_substituir_ordem'),
    },
    {
      key: 'alpaca_fechar_posicao',
      name: 'Encerrar posição',
      description: 'Encerra uma posição aberta, no todo ou em parte.',
      risk: 'high_risk',
      inputSchema: schema({ symbol: str('o ativo'), quantity: num('quantidade a encerrar') }, ['symbol']),
      execution: native('alpaca_fechar_posicao'),
    },
  ],
  status: 'published',
  availability: 'available',
  // Nasce em simulação: é o único ambiente que este App executa, e o selo depende disso.
  defaultEnvironment: 'paper',
  dataAccess: [
    'Lê saldo, posições, ordens e cotações da sua conta de simulação da Alpaca.',
    'Envia ordens SOMENTE no ambiente de simulação. O ambiente de produção está bloqueado nesta plataforma.',
  ],
  storageNote: 'As duas chaves ficam criptografadas e nunca são reexibidas. Cotações e velas ficam guardadas por tempo limitado.',
  disconnectNote: 'Desconectar tira o acesso dos agentes. Ordens já enviadas continuam na corretora e precisam ser tratadas lá.',
  providerCostNote: 'A conta e os limites de chamada são da Alpaca; esta plataforma não intermedia nada.',
}
