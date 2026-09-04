// O BASELINE do Context Engine — medido, e reproduzível.
//
// `node scripts/evalContextEngine.mjs` (a partir de backend/). Sobe um Mongo próprio,
// monta uma base pequena e realista e roda os mesmos casos duas vezes: com e sem
// expansão pelo grafo. O que sai é o número que decide a flag — e o caso que mais importa
// não é "encontrou", é "não vazou": um retrieval que traz tudo acerta todos os casos de
// encontrar e entrega o setor que o agente não podia ler.
//
// ATENÇÃO ao ler o resultado: sem `VOYAGE_API_KEY` a metade vetorial da busca não roda, e
// quem responde é a busca exata. O ganho medido aqui é o ganho SOBRE ELA. Para decidir o
// padrão de produção, este mesmo script precisa rodar com o provedor de embedding
// configurado — o que este ambiente não tem, e inventar não é uma opção.
import { startMongo, stopMongo } from '../test/helpers/mongoServer.mjs'
process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'chave-de-teste-que-nao-e-segredo'
process.env.VOYAGE_API_KEY = ''

const { mongoClient, db } = await import('../dist/db.js')
await mongoClient.connect()
const { ensureKnowledgeIndexes, createDocumentFor } = await import('../dist/knowledge.js')
const { runContextEvals, compareRuns } = await import('../dist/knowledgeEvals.js')
const { createAgent, getAgentById } = await import('../dist/agents.js')
const { createSector } = await import('../dist/sectors.js')
const { createFloor } = await import('../dist/floors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')
await ensureKnowledgeIndexes()

const DONO = 'eval-baseline'
const andar = await createFloor(DONO, { name: 'Atendimento' })
const marina = await createAgent(DONO, andar._id, 'Marina', { objective: 'atender' })
const outro = await createAgent(DONO, andar._id, 'Rafael', { objective: 'analisar' })
const setorAlheio = await createSector(DONO, andar._id, 'Retaguarda', '#556677', 'orchestrated', [{ agentId: outro._id, order: 0 }])
await ensureDefaultBuilding(DONO)
await db.collection('agents').updateOne({ _id: marina._id }, { $set: { knowledgeAccess: { version: 1, own: true, building: true, floor: true, sectorMode: 'none', selectedSectorIds: [] } } })

// Uma base pequena e realista: política do prédio, procedimento do andar com anexo
// ligado, base própria, e um documento de setor que a Marina NÃO pode ler.
const politica = await createDocumentFor({ ownerType: 'building', ownerId: (await ensureDefaultBuilding(DONO))._id }, { title: 'Política de troca', content: 'A política de troca da empresa PROT100 concede 7 dias corridos.' })
const procedimento = await createDocumentFor({ ownerType: 'floor', ownerId: andar._id }, { title: 'Procedimento de troca', content: 'Para executar o PROT100, confira a nota fiscal e registre no sistema.' })
const anexo = await createDocumentFor({ ownerType: 'floor', ownerId: andar._id }, { title: 'Anexo do procedimento', content: 'O anexo lista os campos obrigatórios do registro de devolução.' })
await db.collection('knowledge_documents').updateOne({ _id: procedimento._id }, { $set: { links: [{ target: 'Anexo do procedimento', resolvedDocumentId: anexo._id }] } })
const propria = await createDocumentFor({ ownerType: 'agent', ownerId: marina._id }, { title: 'Roteiro da Marina', content: 'Ao receber um pedido de troca PROT100, confirme os dados e explique o prazo.' })
const alheio = await createDocumentFor({ ownerType: 'sector', ownerId: setorAlheio._id }, { title: 'Interno da retaguarda', content: 'O PROT100 da retaguarda tem outro fluxo interno.' })

const casos = [
  { id: 'politica-correta', query: 'qual o prazo de troca PROT100', expectDocumentIds: [politica._id.toString()], forbidDocumentIds: [alheio._id.toString()] },
  { id: 'procedimento', query: 'como executar o procedimento PROT100', expectDocumentIds: [procedimento._id.toString()], forbidDocumentIds: [alheio._id.toString()] },
  { id: 'anexo-por-ligacao', query: 'campos obrigatórios do registro de devolução PROT100', expectDocumentIds: [anexo._id.toString()], forbidDocumentIds: [alheio._id.toString()] },
  { id: 'roteiro-proprio', query: 'roteiro de atendimento PROT100', expectDocumentIds: [propria._id.toString()], forbidDocumentIds: [alheio._id.toString()] },
  { id: 'nao-vaza-setor', query: 'fluxo interno da retaguarda PROT100', expectDocumentIds: [], forbidDocumentIds: [alheio._id.toString()] },
]

const agente = await getAgentById(DONO, marina._id)
const baseline = await runContextEvals(DONO, agente, casos, { label: 'sem expansão', graphExpansion: false, topK: 6, minScore: 0 })
const expandido = await runContextEvals(DONO, agente, casos, { label: 'com expansão', graphExpansion: true, topK: 6, minScore: 0 })
const v = compareRuns(baseline, expandido)

const linha = (r) => `${r.label.padEnd(14)} acertos ${r.passed}/${r.cases}  chunks ${r.avgChunks}  chars ${r.avgChars}  latência ${r.avgLatencyMs}ms`
console.log('\n=== BASELINE DO CONTEXT ENGINE ===')
console.log(linha(baseline))
console.log(linha(expandido))
console.log(`\ndelta: acertos ${v.deltaPassed >= 0 ? '+' : ''}${v.deltaPassed} · chunks ${v.deltaChunks >= 0 ? '+' : ''}${v.deltaChunks} · chars ${v.deltaChars >= 0 ? '+' : ''}${v.deltaChars} · latência ${v.deltaLatencyMs >= 0 ? '+' : ''}${v.deltaLatencyMs}ms`)
console.log(`recomenda ligar a expansão? ${v.recommendExpansion ? 'SIM' : 'NÃO'} — ${v.reason}`)
for (const o of baseline.outcomes) console.log(`  [sem] ${o.caseId}: ${o.passed ? 'ok' : 'falhou'} (${o.status}, ${o.chunks} trechos)${o.leaked.length ? ' VAZOU' : ''}`)
for (const o of expandido.outcomes) console.log(`  [com] ${o.caseId}: ${o.passed ? 'ok' : 'falhou'} (${o.status}, ${o.chunks} trechos)${o.leaked.length ? ' VAZOU' : ''}`)

await mongoClient.close()
await stopMongo()
