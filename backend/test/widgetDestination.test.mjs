// Para quem o visitante está falando.
//
// Um widget SEM destino não é um widget: é uma caixa de texto que engole mensagem. Isso
// era aceito — os dois campos podiam ficar nulos —, e o resultado era um chat no site do
// cliente recebendo perguntas e nunca respondendo, sem nada dizendo por quê.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { resolveWidgetDestination } = await import('../dist/widgetDestination.js')

const AGENTE = new ObjectId()
const SETOR = new ObjectId()

/** Um setor que EXECUTA: coordenador e mais alguém para coordenar. */
const setorOk = (over = {}) => ({
  _id: SETOR,
  name: 'Suporte',
  mode: 'orchestrated',
  members: [{ agentId: AGENTE }, { agentId: new ObjectId() }],
  coordinatorAgentId: AGENTE,
  stages: [],
  ...over,
})

test('sem destino nenhum é recusado — não existe "Sem atendimento"', () => {
  const r = resolveWidgetDestination({})
  assert.equal(r.ok, false)
  assert.equal(r.code, 'destination_required')
  assert.match(r.reason, /Escolha quem vai atender/)
})

test('os DOIS ao mesmo tempo é recusado — não é o servidor que escolhe', () => {
  const r = resolveWidgetDestination({ agentId: AGENTE, sectorId: SETOR, agentPresent: true, sector: setorOk() })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'destination_conflict')
})

test('agente: o outro lado sai ZERADO', () => {
  const r = resolveWidgetDestination({ agentId: AGENTE, agentPresent: true })
  assert.equal(r.ok, true)
  assert.equal(r.destination.agentId.toString(), AGENTE.toString())
  assert.equal(r.destination.sectorId, null, 'sem isto o destino anterior fica gravado embaixo')
})

test('setor executável: idem, e o agente sai zerado', () => {
  const r = resolveWidgetDestination({ sectorId: SETOR, sector: setorOk() })
  assert.equal(r.ok, true)
  assert.equal(r.destination.sectorId.toString(), SETOR.toString())
  assert.equal(r.destination.agentId, null)
})

test('agente que não existe mais é recusado', () => {
  const r = resolveWidgetDestination({ agentId: AGENTE, agentPresent: false })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'invalid_agent')
})

// --- os setores que NÃO atendem ----------------------------------------------------------

test('"só organizar" não atende — ele agrupa no mapa e não executa nada', () => {
  const r = resolveWidgetDestination({ sectorId: SETOR, sector: setorOk({ mode: 'organization' }) })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'sector_not_executable')
  assert.match(r.reason, /só organiza/)
  assert.match(r.reason, /Suporte/, 'a mensagem diz QUAL setor')
})

test('setor vazio não atende', () => {
  const r = resolveWidgetDestination({ sectorId: SETOR, sector: setorOk({ members: [], coordinatorAgentId: null }) })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'sector_not_executable')
})

test('equipe sem coordenador não atende', () => {
  const r = resolveWidgetDestination({ sectorId: SETOR, sector: setorOk({ coordinatorAgentId: null }) })
  assert.equal(r.ok, false)
  assert.match(r.reason, /coordena/)
})

test('pipeline sem etapa não atende; com etapa válida, atende', () => {
  const vazio = resolveWidgetDestination({
    sectorId: SETOR,
    sector: setorOk({ mode: 'pipeline', stages: [], coordinatorAgentId: null }),
  })
  assert.equal(vazio.ok, false)

  const comEtapa = resolveWidgetDestination({
    sectorId: SETOR,
    sector: setorOk({
      mode: 'pipeline',
      coordinatorAgentId: null,
      stages: [{ id: 'e1', name: 'Triagem', agentId: AGENTE }],
      knownAgentIds: [AGENTE.toString()],
    }),
  })
  assert.equal(comEtapa.ok, true, 'um fluxo em etapas atende como qualquer outro executável')
})

test('etapa apontando para agente removido não atende', () => {
  const r = resolveWidgetDestination({
    sectorId: SETOR,
    sector: setorOk({
      mode: 'pipeline',
      coordinatorAgentId: null,
      stages: [{ id: 'e1', name: 'Triagem', agentId: new ObjectId() }],
      knownAgentIds: [AGENTE.toString()],
    }),
  })
  assert.equal(r.ok, false)
})

test('setor arquivado não atende, e a mensagem diz isso', () => {
  const r = resolveWidgetDestination({ sectorId: SETOR, sector: setorOk({ archivedAt: new Date() }) })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'sector_archived')
})

test('setor que sumiu da conta é recusado — a posse é conferida antes', () => {
  const r = resolveWidgetDestination({ sectorId: SETOR, sector: null })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'invalid_sector')
})
