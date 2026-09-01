// O CONSERTO do que o modelo entrega torto.
//
// O caso real: uma proposta chegou com nove erros vermelhos — oito "o agente
// reutilizado precisa apontar para um recurso existente" numa conta que não tinha
// nenhum agente, uma delegação "só estes" sem lista, e três rotinas cujas etapas
// faziam o validador da plataforma responder "id is required" e "unknown step type:
// undefined" na cara de quem estava montando um atendimento.
//
// Nenhum desses erros dependia da pessoa. Recusar e mandar pedir de novo era transferir
// para ela um problema que o código sabe resolver — desde que DIGA o que resolveu.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { repairBlueprintPatch, repairReuseWithoutTarget } = await import('../dist/architect/repair.js')
const { emptyBlueprint } = await import('../dist/architect/blueprint.js')

// --- delegação ---------------------------------------------------------------------------

test('"só estes agentes" sem lista vira delegação por andar, com aviso', () => {
  const { patch, warnings } = repairBlueprintPatch({
    agents: [
      { key: 'marina', name: 'Marina', delegationPolicy: 'selected' },
      { key: 'rafael', name: 'Rafael', delegationPolicy: 'selected', callableAgentKeys: ['marina'] },
      { key: 'tereza', name: 'Tereza', delegationPolicy: 'floor' },
    ],
  })
  // "Só estes" sem dizer quais não é política: é um coordenador mudo.
  assert.equal(patch.agents[0].delegationPolicy, 'floor')
  assert.equal(patch.agents[1].delegationPolicy, 'selected', 'quem trouxe a lista não é tocado')
  assert.equal(patch.agents[2].delegationPolicy, 'floor')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0].message, /Marina/)
  assert.match(warnings[0].message, /agentes do andar/)
})

// --- etapas de rotina ----------------------------------------------------------------------

test('etapa sem id ou sem tipo derruba as etapas da rotina — não a rotina', () => {
  const { patch, warnings } = repairBlueprintPatch({
    routines: [
      { key: 'diaria', name: 'Resumo diário', steps: [{ type: 'agent.run' }, { id: 's2', type: 'agent.run' }] },
      { key: 'boa', name: 'Boa', steps: [{ id: 's1', type: 'agent.run', config: {} }] },
      { key: 'vazia', name: 'Vazia' },
    ],
  })
  // A rotina nasce rascunho de qualquer jeito: sem etapas ela ainda é útil, e a pessoa
  // termina na tela de Rotinas. Com metade das etapas, ela nasceria quebrada.
  assert.deepEqual(patch.routines[0].steps, [])
  assert.equal(patch.routines[1].steps.length, 1, 'a rotina válida passa intacta')
  assert.equal(patch.routines[2].steps, undefined)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0].message, /Resumo diário/)
  assert.match(warnings[0].message, /tela de Rotinas/)
  // E o que a pessoa via — a linguagem interna do validador — não aparece em lugar nenhum.
  assert.doesNotMatch(JSON.stringify(warnings), /id is required|unknown step type/)
})

test('sem nada torto, nada é mexido e nenhum aviso é inventado', () => {
  const patch = { agents: [{ key: 'a', delegationPolicy: 'floor' }], routines: [{ key: 'r', steps: [{ id: 's', type: 'agent.run' }] }] }
  const r = repairBlueprintPatch(structuredClone(patch))
  assert.deepEqual(r.patch, patch)
  assert.deepEqual(r.warnings, [])
})

// --- reaproveitar o que não existe ------------------------------------------------------------

const comReuso = () => ({
  ...emptyBlueprint('Op', 'objetivo'),
  floors: [{ key: 'andar', action: 'reuse', name: 'Trade' }],
  agents: [
    { key: 'a1', action: 'reuse', floorKey: 'andar', name: 'Marina' },
    { key: 'a2', action: 'update', floorKey: 'andar', name: 'Rafael' },
  ],
  sectors: [{ key: 's1', action: 'reuse', floorKey: 'andar', name: 'Mesa', mode: 'orchestrated', memberAgentKeys: ['a1', 'a2'] }],
})

test('reaproveitar o que NÃO existe vira criar, e o aviso diz o que aconteceu', () => {
  // Este é o caso que travava a tela: oito itens exigindo um recurso existente numa
  // conta que não tinha recurso nenhum. Não havia, na tela inteira, o que apontar.
  const { blueprint, warnings } = repairReuseWithoutTarget(comReuso(), { floors: [], agents: [], sectors: [] })
  assert.equal(blueprint.floors[0].action, 'create')
  assert.equal(blueprint.agents[0].action, 'create')
  assert.equal(blueprint.agents[1].action, 'create')
  assert.equal(blueprint.sectors[0].action, 'create')
  assert.equal(warnings.length, 4)
  assert.match(warnings[0].message, /não existe nenhum com esse nome/)
  assert.match(warnings[0].message, /vai ser criado/)
})

test('quando o nome EXISTE, a escolha continua sendo da pessoa', () => {
  // Reaproveitar é mexer no que já está rodando: isso não se decide sozinho.
  const existente = {
    floors: [{ name: 'Trade', mission: null, agents: 2 }],
    agents: [{ name: 'marina', objective: 'x', floor: 'Trade' }],
    sectors: [],
  }
  const { blueprint, warnings } = repairReuseWithoutTarget(comReuso(), existente)
  assert.equal(blueprint.floors[0].action, 'reuse', 'o andar "Trade" existe: continua reaproveitado')
  assert.equal(blueprint.agents[0].action, 'reuse', 'a comparação ignora caixa e acento')
  assert.equal(blueprint.agents[1].action, 'create', '"Rafael" não existe: vira criação')
  assert.equal(blueprint.sectors[0].action, 'create')
  assert.equal(warnings.length, 2)
})

test('item já ligado a um recurso não é desfeito', () => {
  const bp = comReuso()
  bp.agents[0].resourceId = '507f1f77bcf86cd799439011'
  const { blueprint } = repairReuseWithoutTarget(bp, { floors: [], agents: [], sectors: [] })
  assert.equal(blueprint.agents[0].action, 'reuse', 'quem já escolheu o recurso mandou; não se desfaz escolha da pessoa')
  assert.equal(blueprint.agents[0].resourceId, '507f1f77bcf86cd799439011')
})

test('sem saber o que a conta tem, NADA é convertido', () => {
  // A leitura do escritório pode falhar. Tratar "não sei" como "não existe" viraria
  // todo reaproveitamento legítimo em criação, e a pessoa aplicaria uma cópia do
  // próprio escritório sem perceber. O erro bloqueante é chato; o duplicado é
  // irreversível — então o silêncio manda o plano seguir como está.
  const { blueprint, warnings } = repairReuseWithoutTarget(comReuso(), undefined)
  assert.equal(blueprint.floors[0].action, 'reuse')
  assert.equal(blueprint.agents[0].action, 'reuse')
  assert.deepEqual(warnings, [])
})
