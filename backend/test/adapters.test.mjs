// Delivery adapter pure helpers + injected-IO send (plan §12/§21.1). No real
// mail/Telegram, no network — the transport/fetch are faked.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { maskDestination, chunkTelegram, sendEmail, sendTelegram } = await import('../dist/connections/adapters.js')

test('maskDestination hides most of an email/chat id', () => {
  assert.equal(maskDestination('gabriel@example.com'), 'ga***@example.com')
  assert.match(maskDestination('123456789'), /^12\*\*\*89$/)
  assert.equal(maskDestination('123'), '***')
})

test('chunkTelegram splits at the 4096 limit', () => {
  assert.deepEqual(chunkTelegram('short'), ['short'])
  const big = 'x'.repeat(9000)
  const chunks = chunkTelegram(big)
  assert.equal(chunks.length, 3)
  assert.equal(chunks.join('').length, 9000)
  assert.ok(chunks.every((c) => c.length <= 4096))
})

test('sendEmail uses the injected transport and returns the message id', async () => {
  let captured
  const factory = () => ({
    sendMail: async (opts) => {
      captured = opts
      return { messageId: 'mid-1' }
    },
  })
  const res = await sendEmail(
    { host: 'smtp.x', port: 587, secure: false, user: 'u', pass: 'p', from: 'from@x' },
    { to: 'to@x', subject: 'Assunto', text: 'corpo' },
    factory,
  )
  assert.equal(res.providerMessageId, 'mid-1')
  assert.equal(captured.to, 'to@x')
  assert.equal(captured.from, 'from@x')
})

test('sendTelegram posts each chunk via injected fetch and never leaks the token in the return', async () => {
  const calls = []
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return { status: 200, json: async () => ({ ok: true, result: { message_id: calls.length } }) }
  }
  const res = await sendTelegram({ botToken: 'SECRET' }, { chatId: '42', text: 'x'.repeat(5000) }, fakeFetch)
  assert.equal(calls.length, 2) // 5000 chars → 2 chunks
  assert.equal(calls[0].body.chat_id, '42')
  assert.equal(res.providerMessageId, '2')
})

test('sendTelegram throws on a not-ok response', async () => {
  const fakeFetch = async () => ({ status: 400, json: async () => ({ ok: false, description: 'bad token' }) })
  await assert.rejects(sendTelegram({ botToken: 't' }, { chatId: '1', text: 'hi' }, fakeFetch), /bad token/)
})
