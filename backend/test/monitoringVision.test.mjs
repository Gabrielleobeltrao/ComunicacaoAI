// VISÃO E OCR — a única pergunta que importa: isto pode disparar uma ação?
//
// Ler um número de uma imagem é palpite com boa aparência: `1.234` vira `1234`, `l` vira
// `1`, um gráfico com sombra vira qualquer coisa. Um palpite desses acionando um Flow que
// manda dinheiro é o pior tipo de defeito — raro, silencioso, e quando aparece já
// aconteceu. Estes casos protegem o portão.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIANCA_MINIMA,
  CONFIANCA_MINIMA_CRITICA,
  gateVisionReading,
  registerVisionProvider,
  resetVisionProvider,
  visionProvider,
} from '../dist/monitoring/vision.js'

const evidencia = (over = {}) => ({ rawText: 'R$ 1.234,56', provider: 'ocr-teste', boundingBox: { x: 1, y: 2, width: 3, height: 4 }, ...over })
const leitura = (over = {}) => ({ field: 'preco', value: 'R$ 1.234,56', confidence: 0.99, evidence: evidencia(), ...over })

// --- o provedor padrão RECUSA -------------------------------------------------------

test('sem provedor configurado, a visão não lê nada', async () => {
  resetVisionProvider()
  const p = visionProvider()
  assert.deepEqual(await p.read({ imageRef: 'x', fields: [] }), [])
  assert.equal((await p.health()).ok, false)
})

test('um provedor registrado é usado, e o padrão volta ao ser resetado', async () => {
  registerVisionProvider({ read: async () => [leitura()], health: async () => ({ ok: true, provider: 'fake' }) })
  assert.equal((await visionProvider().health()).ok, true)
  resetVisionProvider()
  assert.equal((await visionProvider().health()).ok, false)
})

// --- a evidência ---------------------------------------------------------------------

test('sem EVIDÊNCIA não passa: não há o que conferir', () => {
  const semTexto = gateVisionReading(leitura({ evidence: { provider: 'x', rawText: '' } }))
  assert.equal(semTexto.accepted, false)
  assert.equal(semTexto.reason, 'no_evidence')

  const semProvedor = gateVisionReading(leitura({ evidence: { rawText: 'a', provider: '' } }))
  assert.equal(semProvedor.reason, 'no_evidence')
})

test('a evidência VOLTA na decisão — é ela que permite conferir depois', () => {
  const r = gateVisionReading(leitura(), { expectedType: 'number', transforms: [{ op: 'number', locale: 'pt-BR' }] })
  assert.equal(r.accepted, true)
  assert.equal(r.evidence.rawText, 'R$ 1.234,56')
  assert.deepEqual(r.evidence.boundingBox, { x: 1, y: 2, width: 3, height: 4 })
  assert.equal(r.evidence.provider, 'ocr-teste')
})

// --- a confiança ---------------------------------------------------------------------------

test('abaixo do piso não passa, e a recusa diz os números', () => {
  const r = gateVisionReading(leitura({ confidence: 0.5 }))
  assert.equal(r.accepted, false)
  assert.equal(r.reason, 'low_confidence')
  assert.match(r.explanation, /50%/)
  assert.match(r.explanation, /70%/)
})

test('dado CRÍTICO tem piso mais alto', () => {
  // Um reconhecedor que se diz 80% seguro erra um em cinco — e um em cinco é muito quando
  // cada erro é uma ação tomada no mundo.
  const naoCritico = gateVisionReading(leitura({ confidence: 0.8 }), { expectedType: 'string' })
  assert.equal(naoCritico.accepted, true)

  const critico = gateVisionReading(leitura({ confidence: 0.8 }), { critical: true, expectedType: 'number', transforms: [{ op: 'number', locale: 'pt-BR' }] })
  assert.equal(critico.accepted, false)
  assert.equal(critico.reason, 'low_confidence')
  assert.ok(CONFIANCA_MINIMA_CRITICA > CONFIANCA_MINIMA)
})

// --- o schema ---------------------------------------------------------------------------------

test('o que não vira número não passa como número', () => {
  const r = gateVisionReading(leitura({ value: 'aproximadamente mil' }), { expectedType: 'number', transforms: [{ op: 'number' }] })
  assert.equal(r.accepted, false)
  assert.equal(r.reason, 'not_a_number')
})

test('ausente NÃO vira zero — a armadilha que este produto já pagou uma vez', () => {
  const r = gateVisionReading(leitura({ value: '' }), { expectedType: 'number', transforms: [{ op: 'number' }] })
  assert.equal(r.accepted, false)
  assert.equal(r.reason, 'not_a_number')
  assert.notEqual(r.value, 0)
})

test('tipo diferente do esperado é recusado', () => {
  const r = gateVisionReading(leitura({ value: 42 }), { expectedType: 'boolean' })
  assert.equal(r.accepted, false)
  assert.equal(r.reason, 'schema_mismatch')
})

// --- a confirmação -------------------------------------------------------------------------------

test('dado CRÍTICO sem segunda leitura não passa', () => {
  const r = gateVisionReading(leitura(), { critical: true, expectedType: 'number', transforms: [{ op: 'number', locale: 'pt-BR' }] })
  assert.equal(r.accepted, false)
  assert.equal(r.reason, 'needs_confirmation')
})

test('duas leituras que DISCORDAM não passam, por mais confiantes que sejam', () => {
  // Uma leitura muito confiante e errada é indistinguível de uma muito confiante e certa.
  const r = gateVisionReading(leitura(), {
    critical: true,
    expectedType: 'number',
    transforms: [{ op: 'number', locale: 'pt-BR' }],
    confirmation: { field: 'preco', value: 'R$ 1.284,56', confidence: 0.99, evidence: evidencia() },
  })
  assert.equal(r.accepted, false)
  assert.equal(r.reason, 'needs_confirmation')
  assert.match(r.explanation, /discordam/)
})

test('duas leituras que CONCORDAM passam', () => {
  const r = gateVisionReading(leitura(), {
    critical: true,
    expectedType: 'number',
    transforms: [{ op: 'number', locale: 'pt-BR' }],
    confirmation: { field: 'preco', value: '1.234,56', confidence: 0.98, evidence: evidencia() },
  })
  assert.equal(r.accepted, true)
  assert.equal(r.value, 1234.56)
})

test('a segunda leitura também precisa de confiança', () => {
  const r = gateVisionReading(leitura(), {
    critical: true,
    expectedType: 'number',
    transforms: [{ op: 'number', locale: 'pt-BR' }],
    confirmation: { field: 'preco', value: '1.234,56', confidence: 0.4, evidence: evidencia() },
  })
  assert.equal(r.accepted, false)
  assert.match(r.explanation, /não tem confiança suficiente/)
})

// --- o valor recusado nunca sai ------------------------------------------------------------------

test('leitura recusada devolve valor NULO — ela não vira dado por engano', () => {
  for (const r of [
    gateVisionReading(leitura({ confidence: 0.1 })),
    gateVisionReading(leitura({ value: 'nada' }), { expectedType: 'number', transforms: [{ op: 'number' }] }),
    gateVisionReading(leitura(), { critical: true, expectedType: 'number', transforms: [{ op: 'number' }] }),
  ]) {
    assert.equal(r.accepted, false)
    assert.equal(r.value, null, 'um valor recusado que ainda saísse acabaria gravado por quem não olhasse `accepted`')
  }
})
