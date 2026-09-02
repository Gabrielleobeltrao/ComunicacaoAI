import { Router } from 'express'
import { receiveWebhook } from '../monitoring/webhookSource.js'

// O RECEPTOR público — sem autenticação de sessão, e por isso com cuidado dobrado.
//
// Quem prova quem é aqui é a ASSINATURA do corpo, não um cookie: quem entrega é o servidor
// de outra empresa, e ele não tem sessão nesta. Fonte inexistente e assinatura errada
// respondem a mesma coisa — dizer "existe, mas a assinatura está errada" entrega meia
// informação a quem está adivinhando endereços.

export const monitoringWebhookRouter = Router()

monitoringWebhookRouter.post('/:publicKey', async (req, res) => {
  const chave = String(req.params.publicKey ?? '')
  // O corpo CRU é o que foi assinado. Reserializar o objeto já parseado mudaria um espaço
  // e derrubaria a assinatura de um provedor honesto.
  const corpo = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body ?? {})

  const r = await receiveWebhook(chave, corpo, req.headers as Record<string, string | undefined>)
  if (r.ok) return void res.status(202).json({ received: true })

  if (r.reason === 'duplicate') {
    // Repetida é 200: o provedor fez o que devia, e insistir não vai melhorar nada.
    return void res.status(200).json({ received: true, duplicate: true })
  }
  if (r.reason === 'paused') return void res.status(409).json({ error: 'source_paused' })
  if (r.reason === 'schema' || r.reason === 'mapping') return void res.status(422).json({ error: 'payload_mismatch' })
  res.status(404).json({ error: 'not_found' })
})
