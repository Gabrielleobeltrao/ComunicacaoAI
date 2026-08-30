import type { OfficeBlueprintV1 } from './types.js'

// O que mudou entre a proposta anterior e a de agora.
//
// Uma revisão é uma resposta inteira do modelo, não um `git diff`: ele devolve a
// proposta corrigida e ninguém vê o que saiu junto. Sumir com um agente entre duas
// versões é a mudança mais cara possível — e a mais silenciosa. Aqui ela é dita.
//
// Puro de propósito: nada de banco, nada de relógio. A mesma dupla de blueprints
// produz sempre a mesma lista, o que a torna testável sem subir nada.

export type BlueprintChangeKind = 'floor' | 'agent' | 'sector' | 'routine' | 'app' | 'knowledge'

export interface BlueprintChange {
  kind: BlueprintChangeKind
  key: string
  label: string
  change: 'added' | 'removed' | 'changed'
  /** Quais campos mudaram, em português. Vazio em adição e remoção. */
  fields: string[]
}

/** Tetos: uma lista de mudanças que não cabe na tela não é informação, é ruído. */
const MAX_MUDANCAS = 60
const MAX_CAMPOS = 6

interface Lista {
  kind: BlueprintChangeKind
  campo: keyof OfficeBlueprintV1
  rotulo: (item: Record<string, unknown>) => string
}

const LISTAS: Lista[] = [
  { kind: 'floor', campo: 'floors', rotulo: (i) => String(i.name ?? i.key ?? '') },
  { kind: 'agent', campo: 'agents', rotulo: (i) => String(i.name ?? i.key ?? '') },
  { kind: 'sector', campo: 'sectors', rotulo: (i) => String(i.name ?? i.key ?? '') },
  { kind: 'routine', campo: 'routines', rotulo: (i) => String(i.name ?? i.key ?? '') },
  { kind: 'app', campo: 'appRequirements', rotulo: (i) => String(i.appKey ?? i.key ?? '') },
  { kind: 'knowledge', campo: 'knowledgeRequirements', rotulo: (i) => String(i.title ?? i.key ?? '') },
]

/** O nome do campo como a pessoa o conhece. Sem tradução, o diff fala inglês de schema. */
const CAMPO: Record<string, string> = {
  name: 'nome',
  title: 'título',
  mission: 'missão',
  description: 'descrição',
  objective: 'objetivo',
  role: 'quando é chamado',
  instructions: 'instruções',
  constraints: 'restrições',
  rationale: 'justificativa',
  preset: 'perfil',
  workMode: 'modo do andar',
  mode: 'modo do setor',
  instruction: 'instrução',
  memberAgentKeys: 'membros',
  coordinatorAgentKey: 'coordenador',
  stages: 'etapas',
  steps: 'etapas',
  floorKey: 'andar',
  ownerAgentKey: 'agente responsável',
  triggerType: 'gatilho',
  cron: 'agendamento',
  action: 'ação',
  resourceId: 'recurso ligado',
  appKey: 'app',
  reason: 'motivo',
  required: 'obrigatório',
  agentKeys: 'agentes',
  actionKeys: 'permissões',
  scope: 'destino',
  targetKey: 'destino',
  state: 'estado',
  content: 'conteúdo',
  expectedSource: 'origem',
  capabilities: 'capacidades',
  delegationPolicy: 'delegação',
  model: 'modelo',
  provider: 'provedor',
}

const chave = (item: unknown): string | null => {
  const k = (item as { key?: unknown })?.key
  return typeof k === 'string' && k.trim() ? k.trim() : null
}

const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function camposMudados(antes: Record<string, unknown>, depois: Record<string, unknown>): string[] {
  const nomes = new Set([...Object.keys(antes), ...Object.keys(depois)])
  const mudou: string[] = []
  for (const nome of nomes) {
    if (nome === 'key') continue
    if (igual(antes[nome], depois[nome])) continue
    mudou.push(CAMPO[nome] ?? nome)
  }
  return mudou.sort().slice(0, MAX_CAMPOS)
}

/**
 * A diferença entre duas propostas, por `key`.
 *
 * Casar por `key` e não por posição é o que faz uma reordenação não virar "tudo mudou".
 * Sem versão anterior não há mudança nenhuma a mostrar — e isso não é o mesmo que
 * "nada mudou": é a primeira proposta.
 */
export function diffBlueprints(antes: OfficeBlueprintV1 | null | undefined, depois: OfficeBlueprintV1 | null | undefined): BlueprintChange[] {
  if (!antes || !depois) return []
  const mudancas: BlueprintChange[] = []

  for (const lista of LISTAS) {
    const anteriores = new Map<string, Record<string, unknown>>()
    for (const item of (antes[lista.campo] ?? []) as unknown[]) {
      const k = chave(item)
      if (k) anteriores.set(k, item as Record<string, unknown>)
    }
    const vistos = new Set<string>()

    for (const item of (depois[lista.campo] ?? []) as unknown[]) {
      const k = chave(item)
      if (!k) continue
      vistos.add(k)
      const anterior = anteriores.get(k)
      const atual = item as Record<string, unknown>
      if (!anterior) {
        mudancas.push({ kind: lista.kind, key: k, label: lista.rotulo(atual), change: 'added', fields: [] })
        continue
      }
      const fields = camposMudados(anterior, atual)
      if (fields.length > 0) mudancas.push({ kind: lista.kind, key: k, label: lista.rotulo(atual), change: 'changed', fields })
    }

    for (const [k, anterior] of anteriores) {
      // O que saiu. É a mudança que ninguém percebe sozinho, e por isso vem primeiro
      // na ordenação lá embaixo.
      if (!vistos.has(k)) mudancas.push({ kind: lista.kind, key: k, label: lista.rotulo(anterior), change: 'removed', fields: [] })
    }
  }

  const peso = { removed: 0, added: 1, changed: 2 }
  return mudancas.sort((a, b) => peso[a.change] - peso[b.change]).slice(0, MAX_MUDANCAS)
}
