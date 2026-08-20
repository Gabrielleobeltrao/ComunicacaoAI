// Qual modelo de embedding roda — e por que isso é uma decisão de dinheiro.
//
// Modelos têm preços diferentes. Um nome digitado errado numa variável de ambiente não
// pode virar uma chamada a um modelo mais caro que ninguém escolheu, e um recuo não pode
// ser usado para contornar um limite da conta: a franquia é a mesma nos dois modelos.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { VOYAGE_MODELS, DEFAULT_VOYAGE_MODEL, isVoyageModel, voyageModel, voyageFallbackModel, voyageProvider } = await import('../dist/voyage.js')

const comAmbiente = (vars, fn) => {
  const antes = { ...process.env }
  Object.assign(process.env, vars)
  try {
    return fn()
  } finally {
    for (const k of Object.keys(vars)) {
      if (antes[k] === undefined) delete process.env[k]
      else process.env[k] = antes[k]
    }
  }
}

test('a política lista os modelos aceitos, e o padrão está nela', () => {
  assert.deepEqual([...VOYAGE_MODELS], ['voyage-4', 'voyage-4-lite', 'voyage-4-large', 'voyage-context-4', 'voyage-code-4'])
  assert.ok(isVoyageModel(DEFAULT_VOYAGE_MODEL))
})

test('um modelo configurado e permitido é respeitado', () => {
  comAmbiente({ VOYAGE_MODEL: 'voyage-4-large' }, () => {
    assert.equal(voyageModel(), 'voyage-4-large')
  })
})

test('um modelo FORA da política não vira chamada: cai no padrão, e avisa', () => {
  // O caso perigoso é o silêncio. Um nome errado que "quase funciona" é como uma
  // configuração equivocada vira uma fatura diferente da esperada.
  comAmbiente({ VOYAGE_MODEL: 'voyage-turbo-9-ultra' }, () => {
    assert.equal(voyageModel(), DEFAULT_VOYAGE_MODEL)
  })
  assert.equal(voyageProvider.supportsModel('voyage-turbo-9-ultra'), false)
  assert.equal(voyageProvider.supportsModel('voyage-4-lite'), true)
})

test('sem configuração nenhuma, o padrão manda', () => {
  comAmbiente({ VOYAGE_MODEL: '' }, () => {
    assert.equal(voyageModel(), DEFAULT_VOYAGE_MODEL)
  })
})

// --- o recuo ---------------------------------------------------------------------------------

test('o recuo padrão é permitido e diferente do principal', () => {
  comAmbiente({ VOYAGE_MODEL: 'voyage-4', VOYAGE_MODEL_FALLBACK_ENABLED: 'true', VOYAGE_FALLBACK_MODEL: '' }, () => {
    assert.equal(voyageFallbackModel(), 'voyage-4-lite')
  })
})

test('recuo desligado é recuo nenhum', () => {
  comAmbiente({ VOYAGE_MODEL_FALLBACK_ENABLED: 'false' }, () => {
    assert.equal(voyageFallbackModel(), null)
  })
})

test('um recuo FORA da política é recusado — não é um atalho para outro modelo', () => {
  comAmbiente({ VOYAGE_MODEL_FALLBACK_ENABLED: 'true', VOYAGE_FALLBACK_MODEL: 'gpt-embedding-3' }, () => {
    assert.equal(voyageFallbackModel(), null)
  })
})

test('recuar para o mesmo modelo não é recuar', () => {
  comAmbiente({ VOYAGE_MODEL: 'voyage-4-lite', VOYAGE_FALLBACK_MODEL: 'voyage-4-lite' }, () => {
    assert.equal(voyageFallbackModel(), null)
  })
})

// --- o contrato de provedor ---------------------------------------------------------------------

test('o Voyage cumpre o contrato de provedor — quem vier depois implementa o mesmo', () => {
  for (const metodo of ['embed', 'embedBatch', 'estimateTokens', 'supportsModel', 'getCapabilities']) {
    assert.equal(typeof voyageProvider[metodo], 'function', `falta ${metodo}`)
  }
  const cap = voyageProvider.getCapabilities()
  assert.deepEqual(cap.models, [...VOYAGE_MODELS])
  assert.ok(cap.maxBatchSize > 0)
  assert.ok(cap.maxBatchChars > 0)
  assert.equal(voyageProvider.name, 'voyage')
})
