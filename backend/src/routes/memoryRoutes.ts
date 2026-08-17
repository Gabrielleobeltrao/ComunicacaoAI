// A memória vista de fora: o que está guardado, onde, e como tirar de lá.
//
// Tudo é dono-escopado por construção: a lista de alvos que uma consulta pode tocar
// é montada a partir da conta autenticada, nunca recebida do cliente. Um id de outra
// conta simplesmente não aparece na lista, então não há o que vazar mesmo que ele
// seja adivinhado.
import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { scopesForOwner } from '../memory/access.js'
import { clearMemories, deleteMemory, isMemoryScope, MAX_PAGE_SIZE, searchMemory, summarizeMemories } from '../memory/records.js'

export const memoryRouter = Router({ mergeParams: true })

const oid = (raw: string): ObjectId | null => (ObjectId.isValid(raw) ? new ObjectId(raw) : null)

const serialize = (r: {
  _id: ObjectId
  scope: string
  scopeKey: string
  key: string
  payload: unknown
  sourceType: string
  sourceId: string | null
  metadata: Record<string, unknown>
  dedupeKey: string | null
  createdAt: Date
  updatedAt: Date
  expiresAt: Date | null
}) => ({
  id: r._id.toString(),
  scope: r.scope,
  scopeKey: r.scopeKey,
  key: r.key,
  payload: r.payload,
  sourceType: r.sourceType,
  sourceId: r.sourceId,
  metadata: r.metadata,
  dedupeKey: r.dedupeKey,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  expiresAt: r.expiresAt,
})

/**
 * Os lugares que guardam memória nesta conta, com quanto cada um tem.
 *
 * É o que a tela precisa para desenhar os escopos sem baixar registro nenhum — e é
 * também a lista que define o que as outras rotas aceitam.
 */
memoryRouter.get('/scopes', async (req, res) => {
  const floorId = typeof req.query.floorId === 'string' ? oid(req.query.floorId) : null
  const escopos = await scopesForOwner(res.locals.userId, { floorId })
  const resumo = await summarizeMemories(
    res.locals.userId,
    escopos.map((e) => e.scopeKey),
  )
  res.json(
    escopos.map((e) => ({
      scope: e.scope,
      scopeKey: e.scopeKey,
      label: e.label,
      count: resumo[e.scopeKey]?.count ?? 0,
      lastAt: resumo[e.scopeKey]?.lastAt ?? null,
    })),
  )
})

// Busca. Sem `scopeKey`, procura em tudo que a conta pode ver — que é o comportamento
// esperado de quem abre a tela e digita um nome.
memoryRouter.get('/', async (req, res) => {
  const permitidos = await scopesForOwner(res.locals.userId)
  const pedido = typeof req.query.scopeKey === 'string' ? req.query.scopeKey : null
  const alvos = pedido ? permitidos.filter((e) => e.scopeKey === pedido) : permitidos
  if (pedido && alvos.length === 0) {
    // Alvo que não é desta conta: devolve vazio em vez de 403. Dizer "existe, mas
    // não é seu" já é contar alguma coisa.
    res.json({ items: [], total: 0 })
    return
  }

  const escopo = typeof req.query.scope === 'string' && isMemoryScope(req.query.scope) ? req.query.scope : null
  const filtrados = escopo ? alvos.filter((e) => e.scope === escopo) : alvos

  const limit = Math.min(Number(req.query.limit) || 20, MAX_PAGE_SIZE)
  const skip = Math.max(0, Number(req.query.skip) || 0)
  const data = (v: unknown): Date | null => {
    if (typeof v !== 'string' || !v.trim()) return null
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const r = await searchMemory({
    tenantId: res.locals.userId,
    scopeKeys: filtrados.map((e) => e.scopeKey),
    query: typeof req.query.q === 'string' ? req.query.q : null,
    key: typeof req.query.key === 'string' ? req.query.key : null,
    sourceType: typeof req.query.sourceType === 'string' ? req.query.sourceType : null,
    since: data(req.query.since),
    until: data(req.query.until),
    limit,
    skip,
  })

  const rotulos = new Map(permitidos.map((e) => [e.scopeKey, e.label]))
  res.json({
    total: r.total,
    items: r.items.map((i) => ({ ...serialize(i), scopeLabel: rotulos.get(i.scopeKey) ?? null })),
  })
})

memoryRouter.delete('/:memoryId', async (req, res) => {
  const id = oid(String(req.params.memoryId))
  if (!id) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const permitidos = await scopesForOwner(res.locals.userId)
  const ok = await deleteMemory(
    res.locals.userId,
    id,
    permitidos.map((e) => e.scopeKey),
  )
  if (!ok) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json({ deleted: 1 })
})

/**
 * Limpar um alvo inteiro, ou só uma chave dele.
 *
 * `scopeKey` é obrigatório e conferido contra a lista da conta: sem isso, um corpo
 * vazio apagaria a memória inteira do prédio, que não é um erro do qual se volta.
 */
memoryRouter.post('/clear', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const scopeKey = typeof body.scopeKey === 'string' ? body.scopeKey.trim() : ''
  if (!scopeKey) {
    res.status(400).json({ error: 'informe o destino a limpar' })
    return
  }
  const permitidos = await scopesForOwner(res.locals.userId)
  const alvo = permitidos.find((e) => e.scopeKey === scopeKey)
  if (!alvo) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const key = typeof body.key === 'string' && body.key.trim() ? body.key.trim() : null
  const deleted = await clearMemories(res.locals.userId, scopeKey, key)
  res.json({ deleted })
})
