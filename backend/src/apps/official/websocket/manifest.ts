import type { AppDefinition } from '../../types.js'

/**
 * WebSocket Genérico — conectar um serviço que empurra dados, sem escrever código.
 *
 * O que ele NÃO é: um lugar para colar uma expressão. Endereço, caminho, filtro e
 * limite são dados; o servidor lê caminho de objeto e compara texto, e nada além disso.
 * Um App genérico que executasse o que foi digitado seria um App que executa código de
 * quem nem sempre é quem parece.
 *
 * `auth: api_key` com um campo só: o VALOR da credencial. Onde ele vai — cabeçalho,
 * query ou primeira mensagem — é configuração, e mora junto do resto, cifrada.
 */
export const manifest: AppDefinition = {
  key: 'websocket',
  version: '1.0.0',
  source: 'system',
  name: 'WebSocket Genérico',
  description:
    'Conecte um serviço que envia dados continuamente por WebSocket. Colete e guarde, ou faça o que chega disparar uma rotina, um agente ou um setor.',
  icon: 'radio',
  categories: ['dados'],
  auth: {
    kind: 'api_key',
    fields: [
      {
        key: 'token',
        label: 'Credencial',
        placeholder: 'deixe em branco se o serviço não exigir',
        required: false,
        secret: true,
        help: 'Guardada cifrada. Ela nunca volta para a tela, e não aparece em log, evento ou histórico.',
      },
    ],
  },
  // Vazio de propósito: o alcance de um WebSocket não é resolvido por lista de domínio
  // no manifesto — é conferido a cada conexão, com DNS, em `safeWebSocket`.
  allowedDomains: [],
  // Um serviço por conexão, e uma conta pode ouvir vários.
  supportsMultipleConnections: true,
  activation: 'credentials',
  actions: [],
  surfaces: [
    { key: 'overview', label: 'Visão geral', description: 'Conexões, estado, último evento e erros.', kind: 'native', scope: 'account', routeSegment: 'overview' },
    { key: 'messages', label: 'Mensagens', description: 'O que chegou, com filtro por conexão, canal e situação.', kind: 'native', scope: 'account', routeSegment: 'messages' },
    { key: 'subscriptions', label: 'Assinaturas', description: 'O que ouvir em cada conexão, e o que fazer com isso.', kind: 'native', scope: 'account', routeSegment: 'subscriptions' },
    { key: 'logs', label: 'Logs', description: 'Conexão, reconexão, descarte e disparo.', kind: 'native', scope: 'account', routeSegment: 'logs' },
  ],
  sidebar: { pinnable: true, defaultSurfaceKey: 'overview' },
  status: 'published',
  availability: 'available',
  dataAccess: [
    'Recebe as mensagens que o serviço que você conectar enviar.',
    'Guarda um trecho de cada mensagem por tempo limitado, para você conferir o que chegou.',
  ],
  storageNote: 'A credencial fica cifrada e nunca é reexibida. Mensagens e logs têm prazo de validade e somem sozinhos.',
  disconnectNote: 'Desconectar encerra a conexão e pausa as assinaturas. Nada do que já chegou é apagado.',
  providerCostNote: 'A conta e os limites são do serviço que você conectar; esta plataforma não intermedia nada.',
}
