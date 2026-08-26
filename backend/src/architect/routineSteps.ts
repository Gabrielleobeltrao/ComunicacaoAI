import { ObjectId } from 'mongodb'

// As etapas de uma rotina falam de recursos — "execute o agente X", "grave na memória
// do andar Y" — e falam por ID. O blueprint não tem ids: ele fala por `key`, porque um
// id vindo do modelo é um id inventado.
//
// Aqui é onde as duas linguagens se encontram: a proposta escreve `agentKey`, e a
// aplicação troca por `agentId` com o id REAL, tirado do mapa da operação. Sem esta
// tradução, ou o modelo inventaria ids, ou o Arquiteto só conseguiria propor rotinas
// sem etapa nenhuma — que é o mesmo que não propor rotina.

/** `<campo>Key` no blueprint → `<campo>Id` na definição que o motor executa. */
const TRADUCOES: [string, string][] = [
  ['agentKey', 'agentId'],
  ['ownerAgentKey', 'ownerAgentId'],
  ['sectorKey', 'sectorId'],
  ['floorKey', 'floorId'],
]

const TIPO_DO_CAMPO: Record<string, string> = {
  agentKey: 'agent',
  ownerAgentKey: 'agent',
  sectorKey: 'sector',
  floorKey: 'floor',
}

/** Toda referência por `key` que as etapas fazem, para a validação conferir. */
export function referencedKeys(steps: unknown[]): { kind: string; key: string; field: string }[] {
  const fora: { kind: string; key: string; field: string }[] = []
  for (const step of steps ?? []) {
    const config = (step as { config?: Record<string, unknown> })?.config
    if (!config || typeof config !== 'object') continue
    for (const [campo] of TRADUCOES) {
      const v = config[campo]
      if (typeof v === 'string' && v.trim()) fora.push({ kind: TIPO_DO_CAMPO[campo], key: v.trim(), field: campo })
    }
  }
  return fora
}

/**
 * Troca as `key`s pelos ids reais.
 *
 * `resolve` devolve `undefined` para o que não foi criado — e aí a etapa é deixada
 * como está, sem o campo traduzido. Quem recusa é o validador logo depois: melhor
 * falhar dizendo "a etapa aponta para um agente que não existe" do que gravar uma
 * rotina com um id nulo que só quebra quando alguém a publicar.
 */
export function translateSteps(steps: unknown[], resolve: (kind: string, key: string) => string | undefined, buildingId?: string): unknown[] {
  return (steps ?? []).map((step) => {
    const s = step as Record<string, unknown>
    const config = { ...((s.config as Record<string, unknown>) ?? {}) }
    for (const [campo, destino] of TRADUCOES) {
      const v = config[campo]
      if (typeof v !== 'string' || !v.trim()) continue
      const id = resolve(TIPO_DO_CAMPO[campo], v.trim())
      delete config[campo]
      if (id) config[destino] = id
    }
    // O prédio é um por conta: ele não vem da proposta, vem do servidor.
    if (config.scope === 'building' && buildingId && !config.buildingId) config.buildingId = buildingId
    return { ...s, config }
  })
}

/**
 * A mesma tradução, com ids DE MENTIRA — só para a validação estrutural rodar.
 *
 * O validador de rotinas exige ObjectId onde a proposta ainda tem `key`. Rodar sobre
 * marcadores válidos confere tudo o que importa (tipo de etapa, campos obrigatórios,
 * dependências) sem depender de recurso nenhum existir ainda; a posse das `key`s é
 * conferida à parte, no validador do blueprint.
 */
export function withPlaceholderIds(steps: unknown[]): unknown[] {
  const marcador = new ObjectId('000000000000000000000000').toString()
  return translateSteps(steps, () => marcador, marcador)
}
