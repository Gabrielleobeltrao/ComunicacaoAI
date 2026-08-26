import { ObjectId } from 'mongodb'
import { db } from './db.js'
import type { ArchitectStamp } from './architectStamp.js'

// A sector is a TEAM (never a schedule). Its mode says how the team works:
//   'organization' — only groups agents on the map; not executable as a unit.
//   'orchestrated' — a coordinator receives the request, delegates to members and
//                    consolidates the answer (this is the old 'adaptive').
//   'pipeline'     — ordered stages, each an agent, chaining outputs to inputs.
export type SectorMode = 'organization' | 'orchestrated' | 'pipeline'
export const SECTOR_MODES: SectorMode[] = ['organization', 'orchestrated', 'pipeline']

// Legacy documents used 'adaptive'; read it as 'orchestrated' without rewriting.
// Anything unknown falls back to 'orchestrated' (the historical executable default).
export function normalizeSectorMode(mode: unknown): SectorMode {
  if (mode === 'organization' || mode === 'orchestrated' || mode === 'pipeline') return mode
  return 'orchestrated' // covers legacy 'adaptive' and missing/unknown values
}

// Only orchestrated/pipeline sectors can actually run; an organization sector is a
// visual grouping and is refused by delegate_to_sector.
export function sectorIsExecutable(mode: SectorMode): boolean {
  return mode === 'orchestrated' || mode === 'pipeline'
}

// Pipeline only: a conditional jump from this stage to another one (identified
// by its agent). Lets a flow skip ahead, branch (A → B or C), or go back to an
// earlier stage when the topic changes — beyond the plain linear advance.
export interface SectorTransition {
  condition: string
  targetAgentId: ObjectId
}

// Pipeline execution stage — the REAL, deterministic flow (replaces the
// conversational advanceWhen/transitions for the task path). Ordered by array
// position; `dependsOn` chains a stage's input to earlier stages' outputs.
export interface SectorStage {
  id: string
  name: string
  agentId: ObjectId
  instruction: string
  dependsOn: string[] // stage ids whose outputs feed this one ([] = the sector input)
  inputMapping: Record<string, string> // optional named-var mapping (kept simple)
  expectedOutput: string
  retryPolicy: { maxAttempts: number; backoffMs: number }
  onError: 'stop' | 'continue'
}

export interface SectorMember {
  agentId: ObjectId
  // Optional department/sector label (e.g. Suporte, Vendas) used to group
  // members in the UI and to help the adaptive supervisor route. Empty = none.
  sector: string
  // Adaptive: "when to use this agent" hint the supervisor reads. Pipeline:
  // what this stage does. Either way, a short description of the member's role.
  routingDescription: string
  // Pipeline only: the condition under which this stage is complete and the
  // flow should advance to the NEXT member (the simple linear case). Ignored
  // in adaptive mode.
  advanceWhen: string
  // Pipeline only: conditional jumps to non-adjacent stages (skip/branch/back).
  transitions: SectorTransition[]
  // The fallback specialist for ambiguous messages; also the source of
  // widget-level settings (first message, conversation persistence, limit).
  isDefault: boolean
}

export interface Sector {
  _id: ObjectId
  /** A marca do Arquiteto, quando foi ele que criou. Ausente em tudo o mais. */
  architect?: ArchitectStamp
  ownerId: string
  // The Escritório this sector belongs to. Required — a sector is never an
  // orphan (unlike agents, which may have no sector).
  officeId: ObjectId
  name: string
  // The room's base colour on the office map (a CSS colour / hex).
  color: string
  mode: SectorMode
  members: SectorMember[]
  // Orchestrated mode (all additive; absent on legacy/other modes):
  coordinatorAgentId?: ObjectId // the agent that receives, delegates and consolidates
  instruction?: string // how the coordinator should run the team
  inputContract?: string // what the team expects to receive
  outputContract?: string // what the team must produce
  // Pipeline mode: the ordered execution stages (replaces advanceWhen/transitions).
  stages?: SectorStage[]
  // Who may call INTO this sector's people from outside (see sectorAccess.ts).
  // Absent on documents written before this model = 'open_members', which is exactly
  // how they behaved.
  entryPolicy?: string
  exposedAgentIds?: ObjectId[]
  createdAt: Date
  // Set on new writes/edits. Additive — old documents may lack it until edited.
  updatedAt?: Date
}

const sectors = db.collection<Sector>('sectors')

export const MAX_SECTOR_MEMBERS = 10

// Plain-language label for each mode, so the UI never has to invent its own copy.
export const SECTOR_MODE_LABEL: Record<SectorMode, { title: string; help: string }> = {
  organization: { title: 'Só organizar', help: 'Agrupa agentes no mapa. Não executa nada como equipe.' },
  orchestrated: { title: 'Um gerente coordena', help: 'Um coordenador recebe o pedido, aciona quem precisa e junta a resposta.' },
  pipeline: { title: 'Executar em etapas', help: 'As etapas rodam em ordem, cada uma usando o resultado da anterior.' },
}

export type SectorReadinessCode = 'no_members' | 'no_coordinator' | 'coordinator_alone' | 'no_stages' | 'stage_without_agent' | 'agent_pending'

export interface SectorReadinessIssue {
  code: SectorReadinessCode
  message: string
  action: string
  // A blocking issue stops the sector from running; a warning is worth showing but
  // does not make the sector invalid (e.g. a member that still needs a tool).
  severity: 'blocking' | 'warning'
}

export interface SectorReadiness {
  ready: boolean
  issues: SectorReadinessIssue[]
}

export interface SectorReadinessInput {
  mode: SectorMode
  members: { agentId: ObjectId }[]
  coordinatorAgentId?: ObjectId | null
  stages?: { id: string; name: string; agentId?: ObjectId | null }[]
  // Agents referenced by this sector that still have their own pending setup, by name.
  pendingAgentNames?: string[]
  // Ids that exist in the account — a stage pointing at a removed agent is invalid.
  knownAgentIds?: string[]
}

// Is this team able to work? One place, so the wizard, the sector page and the tests
// agree. Legacy sectors (no stages/coordinator recorded) simply report what is
// missing instead of being treated as broken.
export function sectorReadiness(input: SectorReadinessInput): SectorReadiness {
  const issues: SectorReadinessIssue[] = []
  const known = input.knownAgentIds ? new Set(input.knownAgentIds) : null
  const mode = normalizeSectorMode(input.mode)

  if (mode === 'organization') {
    if (input.members.length === 0) issues.push({ code: 'no_members', message: 'Este grupo ainda não tem nenhum agente.', action: 'Adicionar agentes', severity: 'blocking' })
  } else if (mode === 'orchestrated') {
    if (!input.coordinatorAgentId) issues.push({ code: 'no_coordinator', message: 'Falta escolher quem coordena a equipe.', action: 'Escolher coordenador', severity: 'blocking' })
    if (input.members.length === 0) issues.push({ code: 'no_members', message: 'A equipe ainda não tem membros.', action: 'Adicionar membros', severity: 'blocking' })
    // Coordenar sozinho não é coordenar. O setor executa — por isso é aviso, não
    // bloqueio —, mas quem testar vai ver um único agente trabalhando e achar que a
    // orquestração quebrou. Ela não quebrou: não há a quem delegar.
    else if (input.coordinatorAgentId && input.members.every((m) => m.agentId.toString() === input.coordinatorAgentId?.toString())) {
      issues.push({ code: 'coordinator_alone', message: 'A equipe só tem o coordenador: não há a quem delegar.', action: 'Adicionar membros', severity: 'warning' })
    }
  } else {
    const stages = input.stages ?? []
    if (stages.length === 0) issues.push({ code: 'no_stages', message: 'O fluxo ainda não tem nenhuma etapa.', action: 'Adicionar etapa', severity: 'blocking' })
    for (const stage of stages) {
      const id = stage.agentId?.toString()
      if (!id || (known && !known.has(id))) {
        issues.push({ code: 'stage_without_agent', message: `A etapa “${stage.name || stage.id}” está sem um agente válido.`, action: 'Escolher agente', severity: 'blocking' })
      }
    }
  }

  // Agent-level gaps are surfaced, never hidden — but they do not invalidate the team.
  for (const name of input.pendingAgentNames ?? []) {
    issues.push({ code: 'agent_pending', message: `${name} ainda precisa de configuração para trabalhar.`, action: 'Abrir agente', severity: 'warning' })
  }

  return { ready: !issues.some((i) => i.severity === 'blocking'), issues }
}

// Assign stable ids to stages that lack one and clamp the retry policy.
export function normalizeStages(stages: SectorStage[]): SectorStage[] {
  return stages.map((s, i) => ({
    ...s,
    id: s.id && s.id.trim() ? s.id : `s${i + 1}`,
    retryPolicy: { maxAttempts: Math.max(1, Math.min(s.retryPolicy?.maxAttempts ?? 1, 5)), backoffMs: s.retryPolicy?.backoffMs ?? 2000 },
    onError: s.onError === 'continue' ? 'continue' : 'stop',
  }))
}

/**
 * Quem está numa ETAPA é membro do setor.
 *
 * `members` e `stages` eram duas listas independentes, e o editor de pipeline gravava
 * `members: []` de propósito ao salvar as etapas. Toda tela que pergunta "quem trabalha
 * aqui" lê `members` — então um setor em etapas mostrava "0 agentes", sala vazia no mapa
 * e "Sem setor" na página de cada agente, com os agentes existindo o tempo todo dentro
 * das etapas. Pior: `enforceSingleMembership` também lê `members`, então um agente podia
 * ser etapa de quantos pipelines quisesse, ao mesmo tempo, sem ninguém notar.
 *
 * A resposta para "quem está neste setor" passa a ser uma só, gravada. O que cada agente
 * FAZ continua nas etapas; a lista de membros é a consequência, derivada aqui, e não algo
 * que alguém precise manter em dia à mão.
 *
 * A configuração de membro que já existia é preservada (área, descrição), e o mesmo
 * agente em duas etapas vira UM membro — dentro de um fluxo, repetir é legítimo.
 */
export function membersFromStages(stages: SectorStage[], anteriores: SectorMember[] = []): SectorMember[] {
  const porAgente = new Map(anteriores.map((m) => [m.agentId.toString(), m]))
  const vistos = new Set<string>()
  const derivados: SectorMember[] = []
  for (const etapa of stages) {
    const chave = etapa.agentId.toString()
    if (vistos.has(chave)) continue
    vistos.add(chave)
    const anterior = porAgente.get(chave)
    derivados.push({
      agentId: etapa.agentId,
      sector: anterior?.sector ?? '',
      // Sem descrição própria, o nome da etapa explica por que ele está no setor.
      routingDescription: anterior?.routingDescription || etapa.name || '',
      advanceWhen: anterior?.advanceWhen ?? '',
      transitions: anterior?.transitions ?? [],
      isDefault: false,
    })
  }
  return normalizeMembers(derivados)
}

// Exactly one member must be the default. If none/many are flagged, pick the first.
export function normalizeMembers(members: SectorMember[]): SectorMember[] {
  if (members.length === 0) return members
  const defaultIndex = members.findIndex((m) => m.isDefault)
  const chosen = defaultIndex >= 0 ? defaultIndex : 0
  return members.map((m, i) => ({ ...m, isDefault: i === chosen }))
}

export interface SectorTeamFields {
  coordinatorAgentId?: ObjectId | null
  instruction?: string
  inputContract?: string
  outputContract?: string
  stages?: SectorStage[]
  entryPolicy?: string
  exposedAgentIds?: ObjectId[]
  /** A marca do Arquiteto, quando foi ele que criou. Ver `architectStamp.ts`. */
  architect?: ArchitectStamp
}

export async function createSector(
  ownerId: string,
  officeId: ObjectId,
  name: string,
  color: string,
  mode: SectorMode,
  members: SectorMember[],
  extra: SectorTeamFields = {},
) {
  const now = new Date()
  const sector: Omit<Sector, '_id'> = {
    ownerId,
    officeId,
    name,
    color,
    mode,
    // Num pipeline, quem está nas etapas é quem está no setor.
    members:
      normalizeSectorMode(mode) === 'pipeline' && (extra.stages?.length ?? 0) > 0
        ? membersFromStages(normalizeStages(extra.stages ?? []), members)
        : normalizeMembers(members),
    ...(extra.coordinatorAgentId ? { coordinatorAgentId: extra.coordinatorAgentId } : {}),
    ...(extra.instruction !== undefined ? { instruction: extra.instruction } : {}),
    ...(extra.inputContract !== undefined ? { inputContract: extra.inputContract } : {}),
    ...(extra.outputContract !== undefined ? { outputContract: extra.outputContract } : {}),
    ...(extra.stages ? { stages: normalizeStages(extra.stages) } : {}),
    // A NEW executable sector is closed by default; a new group is open. An existing
    // sector is never changed by this — see the migration. (The rule is inlined
    // instead of imported from sectorAccess.ts, which imports this module.)
    entryPolicy: extra.entryPolicy ?? (normalizeSectorMode(mode) === 'organization' ? 'open_members' : 'sector_only'),
    exposedAgentIds: extra.exposedAgentIds ?? [],
    ...(extra.architect ? { architect: extra.architect } : {}),
    createdAt: now,
    updatedAt: now,
  }
  const result = await sectors.insertOne(sector as Sector)
  return { ...sector, _id: result.insertedId }
}

export function listSectors(ownerId: string, floorId?: ObjectId) {
  const filter: Record<string, unknown> = { ownerId }
  if (floorId) filter.officeId = floorId
  return sectors.find(filter).sort({ createdAt: -1 }).toArray()
}

export function getSectorById(ownerId: string, sectorId: ObjectId) {
  return sectors.findOne({ _id: sectorId, ownerId })
}

// Resolve a raw sector id INSIDE an account. Returns null both when the id is
// malformed and when it belongs to someone else — callers must not distinguish the
// two, so an id is never confirmed to exist across tenants. This is the only way a
// sectorId may enter an execution.
export async function resolveOwnedSectorId(ownerId: string, raw: unknown): Promise<ObjectId | null> {
  if (typeof raw !== 'string' || !ObjectId.isValid(raw)) return null
  const sector = await sectors.findOne({ _id: new ObjectId(raw), ownerId }, { projection: { _id: 1 } })
  return sector ? sector._id : null
}

export async function updateSector(
  ownerId: string,
  sectorId: ObjectId,
  updates: {
    name?: string
    color?: string
    mode?: SectorMode
    members?: SectorMember[]
    officeId?: ObjectId
    coordinatorAgentId?: ObjectId | null
    instruction?: string
    inputContract?: string
    outputContract?: string
    stages?: SectorStage[]
    entryPolicy?: string
    exposedAgentIds?: ObjectId[]
  },
) {
  const base: Record<string, unknown> = { ...updates }
  if (updates.members) base.members = normalizeMembers(updates.members)
  if (updates.stages) base.stages = normalizeStages(updates.stages)

  // Pipeline: a lista de membros é DERIVADA das etapas, sempre.
  //
  // A gravação chega com `members: []` do editor (ele limpa de propósito) e `stages`
  // preenchido. Aceitar isso literalmente é o que apagava os agentes de toda a
  // interface e o que deixava um agente ser etapa de vários setores ao mesmo tempo.
  // Aqui a atualização é lida junto com o que já está gravado, porque um PATCH pode
  // mudar só o modo, só as etapas, ou os dois.
  const atual = await sectors.findOne({ _id: sectorId, ownerId })
  const modoFinal = normalizeSectorMode((updates.mode ?? atual?.mode) as SectorMode)
  const etapasFinais = (base.stages as SectorStage[] | undefined) ?? atual?.stages ?? []
  if (modoFinal === 'pipeline' && etapasFinais.length > 0) {
    base.members = membersFromStages(etapasFinais, (base.members as SectorMember[] | undefined) ?? atual?.members ?? [])
  }
  // A null coordinator means "clear it" — $unset rather than storing null.
  const unset = base.coordinatorAgentId === null ? { coordinatorAgentId: '' } : undefined
  if (unset) delete base.coordinatorAgentId
  const update: Record<string, unknown> = { $set: { ...base, updatedAt: new Date() } }
  if (unset) update.$unset = unset
  return sectors.findOneAndUpdate({ _id: sectorId, ownerId }, update, { returnDocument: 'after' })
}

export function deleteSector(ownerId: string, sectorId: ObjectId) {
  return sectors.deleteOne({ _id: sectorId, ownerId })
}

// An agent belongs to at most one sector (parent-child). After adding agents to
// `keepTeamId`, remove them from every OTHER sector of the same owner, so moving
// an agent into a sector transfers it out of its previous one. Affected sectors
// are re-normalized (a pulled member could have been the default).
/**
 * Onde mais este agente já está — como ETAPA de outro setor.
 *
 * Membro é vínculo: mover um agente de um setor para outro é o modelo do produto, e
 * `enforceSingleMembership` faz isso em silêncio porque não há nada a perder. Etapa é
 * TRABALHO CONFIGURADO: apagar a etapa de outro fluxo para acomodar este destruiria o
 * que alguém montou. Então aqui não se move — recusa-se, dizendo onde ele está.
 */
export async function stageConflicts(
  ownerId: string,
  keepTeamId: ObjectId | null,
  agentIds: ObjectId[],
): Promise<{ agentId: string; sectorId: string; sectorName: string; stageName: string }[]> {
  if (agentIds.length === 0) return []
  const filtro: Record<string, unknown> = { ownerId, 'stages.agentId': { $in: agentIds } }
  if (keepTeamId) filtro._id = { $ne: keepTeamId }
  const outros = await sectors.find(filtro).toArray()
  const conflitos: { agentId: string; sectorId: string; sectorName: string; stageName: string }[] = []
  for (const setor of outros) {
    for (const etapa of setor.stages ?? []) {
      if (!agentIds.some((id) => id.equals(etapa.agentId))) continue
      conflitos.push({
        agentId: etapa.agentId.toString(),
        sectorId: setor._id.toString(),
        sectorName: setor.name,
        stageName: etapa.name,
      })
    }
  }
  return conflitos
}

export async function enforceSingleMembership(ownerId: string, keepTeamId: ObjectId, agentIds: ObjectId[]) {
  if (agentIds.length === 0) return
  const affected = await sectors
    .find({ ownerId, _id: { $ne: keepTeamId }, 'members.agentId': { $in: agentIds } })
    .toArray()
  for (const t of affected) {
    const remaining = t.members.filter((m) => !agentIds.some((id) => id.equals(m.agentId)))
    await sectors.updateOne({ _id: t._id }, { $set: { members: normalizeMembers(remaining) } })
  }
}
