// Da configuração de uma etapa para uma gravação de verdade.
//
// É aqui que a configuração escrita pelo dono encontra o evento que chegou: o
// destino é reconferido na conta dele, a chave pode vir de um campo do próprio
// evento, e o mapeamento escolhe o que guardar. Nada disso passa por modelo.
import { ObjectId } from 'mongodb'
import { readPath } from '../automations/conditions.js'
import { assertAgentMayWrite, resolveTarget } from './access.js'
import { clearMemories, deleteMemory, isMemoryScope, isMemoryStrategy, MemoryError, scopeKeyOf, searchMemory, writeMemory } from './records.js'
import type { MemoryStrategy, MemoryTarget } from './records.js'

/**
 * Resolve `{{campo}}` contra o valor que chegou.
 *
 * Diferente do template das etapas: aqui uma variável que não existe vira string
 * vazia em vez de derrubar a execução. Uma chave de deduplicação que depende de um
 * campo opcional é caso comum, e perder o evento inteiro por causa dela seria pior
 * que gravá-lo sem a marca.
 */
export function renderFromValue(texto: string, valor: unknown): string {
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, caminho: string) => {
    const v = readPath(valor, caminho)
    if (v === null || v === undefined) return ''
    return typeof v === 'string' ? v : JSON.stringify(v)
  })
}

/**
 * O que efetivamente vai para o campo `payload`.
 *
 * Sem mapeamento, guarda o evento inteiro — que é o que quase todo mundo quer e
 * ninguém precisa configurar. Com mapeamento, guarda só o que foi pedido: um
 * webhook de pagamento traz cinquenta campos e o dono quer três.
 */
export function applyFieldMap(valor: unknown, fieldMap: Record<string, string> | undefined): unknown {
  if (!fieldMap || Object.keys(fieldMap).length === 0) return valor
  const fora: Record<string, unknown> = {}
  for (const [destino, origem] of Object.entries(fieldMap)) {
    const v = readPath(valor, origem)
    // Campo que não veio neste evento fica de FORA, em vez de entrar como nulo.
    //
    // Escrever nulo diria que o evento afirmou "não tem" — e num `upsert` apagaria o
    // valor que um evento anterior trouxe, que é exatamente o que o `upsert` existe
    // para não fazer: o evento que traz só o telefone não pode apagar o e-mail.
    if (v !== undefined) fora[destino] = v
  }
  return fora
}

export interface MemoryStepContext {
  ownerId: string
  sourceType: string
  sourceId: string | null
}

// Resolve o destino declarado na etapa, na conta certa, e confere se o agente pode
// gravar nele. Falha alto: um destino que não existe mais é erro de configuração, e
// gravar em outro lugar "para não perder" seria pior.
async function alvoDaEtapa(cfg: Record<string, unknown>, ctx: MemoryStepContext): Promise<MemoryTarget> {
  const scope = isMemoryScope(cfg.scope) ? cfg.scope : 'agent'
  const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

  // Sob a permissão de quem esta etapa grava. Vem da própria configuração porque nos
  // modos sem IA não existe passo de agente de onde deduzi-lo — e é exatamente aí
  // que a checagem não pode sumir.
  const dono = texto(cfg.ownerAgentId)
  if (!dono || !ObjectId.isValid(dono)) throw new MemoryError('a etapa de memória não declara o agente responsável')
  const ownerAgentId = new ObjectId(dono)

  // Escopo do agente sem id declarado = o próprio agente responsável, que é o caso
  // comum e não precisa ser escrito na configuração.
  const agentId = texto(cfg.agentId) ?? (scope === 'agent' ? dono : null)

  const alvo = await resolveTarget(ctx.ownerId, scope, {
    agentId,
    sectorId: texto(cfg.sectorId),
    floorId: texto(cfg.floorId),
    buildingId: texto(cfg.buildingId),
  })
  if (!alvo) throw new MemoryError('o destino da memória não existe nesta conta')
  await assertAgentMayWrite(ctx.ownerId, ownerAgentId, alvo)
  return alvo
}

export async function writeFromStep(
  cfg: Record<string, unknown>,
  valor: unknown,
  ctx: MemoryStepContext,
): Promise<{ outcome: string; recordId: string; scopeKey: string }> {
  const alvo = await alvoDaEtapa(cfg, ctx)
  const strategy: MemoryStrategy = isMemoryStrategy(cfg.strategy) ? cfg.strategy : 'append'
  const key = renderFromValue(typeof cfg.key === 'string' && cfg.key.trim() ? cfg.key : 'evento', valor).trim() || 'evento'
  const dedupeBruto = typeof cfg.dedupeKey === 'string' && cfg.dedupeKey.trim() ? renderFromValue(cfg.dedupeKey, valor).trim() : ''
  const fieldMap = (cfg.fieldMap ?? undefined) as Record<string, string> | undefined
  const ttlSeconds = typeof cfg.ttlSeconds === 'number' && cfg.ttlSeconds > 0 ? cfg.ttlSeconds : null

  return writeMemory({
    tenantId: ctx.ownerId,
    target: alvo,
    key,
    payload: applyFieldMap(valor, fieldMap),
    strategy,
    sourceType: ctx.sourceType,
    sourceId: ctx.sourceId,
    // A marca só existe se sobrou alguma coisa depois de resolver o template: uma
    // string vazia travaria TODOS os eventos daquele destino como duplicados um do
    // outro.
    dedupeKey: dedupeBruto || null,
    ttlSeconds,
  })
}

export async function searchFromStep(
  cfg: Record<string, unknown>,
  valor: unknown,
  ctx: MemoryStepContext,
): Promise<{ items: unknown[]; total: number }> {
  const alvo = await alvoDaEtapa(cfg, ctx)
  const query = typeof cfg.query === 'string' && cfg.query.trim() ? renderFromValue(cfg.query, valor) : null
  const key = typeof cfg.key === 'string' && cfg.key.trim() ? renderFromValue(cfg.key, valor) : null
  const limit = typeof cfg.limit === 'number' ? cfg.limit : 20
  const r = await searchMemory({ tenantId: ctx.ownerId, scopeKeys: [scopeKeyOf(alvo)], query, key, limit })
  return { items: r.items, total: r.total }
}

export async function deleteFromStep(
  cfg: Record<string, unknown>,
  valor: unknown,
  ctx: MemoryStepContext,
): Promise<{ deleted: number }> {
  const alvo = await alvoDaEtapa(cfg, ctx)
  const scopeKey = scopeKeyOf(alvo)

  const recordId = typeof cfg.recordId === 'string' ? renderFromValue(cfg.recordId, valor).trim() : ''
  if (recordId && ObjectId.isValid(recordId)) {
    const ok = await deleteMemory(ctx.ownerId, new ObjectId(recordId), [scopeKey])
    return { deleted: ok ? 1 : 0 }
  }

  const key = typeof cfg.key === 'string' && cfg.key.trim() ? renderFromValue(cfg.key, valor).trim() : ''
  // Sem chave nem id, isto apagaria o destino inteiro. Uma etapa automática não pode
  // ter esse poder por omissão de configuração.
  if (!key) throw new MemoryError('apagar exige uma chave ou o id do registro')
  return { deleted: await clearMemories(ctx.ownerId, scopeKey, key) }
}
