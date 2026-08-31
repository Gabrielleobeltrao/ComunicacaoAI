import { db, mongoClient } from '../db.js'
import { decrypt, encrypt, usesCurrentKey } from '../crypto.js'

/**
 * Regrava com a chave ATUAL tudo o que ainda está cifrado com uma anterior.
 *
 * A rotação em si já funciona sem isto — `ENCRYPTION_KEY_PREVIOUS` mantém o que existe
 * legível. Este script é o que permite APOSENTAR a chave antiga: enquanto houver um
 * documento cifrado com ela, tirá-la da lista quebra a integração daquele dono, e
 * ninguém saberia qual.
 *
 * Idempotente e retomável: o que já está na chave atual é pulado, e rodar duas vezes
 * não faz diferença. Um documento que não abre com nenhuma chave é REPORTADO e deixado
 * como está — apagar credencial que talvez ainda abra com outra chave seria pior.
 *
 *   ENCRYPTION_KEY=<nova> ENCRYPTION_KEY_PREVIOUS=<antiga> npm run rotate:encryption-key
 */

/** Onde há texto cifrado. `campo` aceita caminho com ponto (`whatsapp.configEnc`). */
const LUGARES: { colecao: string; campo: string }[] = [
  { colecao: 'user_settings', campo: 'anthropicApiKeyEnc' },
  { colecao: 'user_settings', campo: 'openaiApiKeyEnc' },
  { colecao: 'widgets', campo: 'whatsapp.configEnc' },
  { colecao: 'connections', campo: 'encryptedConfig' },
  { colecao: 'app_installations', campo: 'encryptedConfig' },
  { colecao: 'tools', campo: 'auth.secretEncrypted' },
  { colecao: 'automations', campo: 'webhookSecretEncrypted' },
  { colecao: 'oauth_credentials', campo: 'accessToken' },
  { colecao: 'oauth_credentials', campo: 'refreshToken' },
]

const ler = (doc: Record<string, unknown>, caminho: string): unknown =>
  caminho.split('.').reduce<unknown>((atual, parte) => (atual && typeof atual === 'object' ? (atual as Record<string, unknown>)[parte] : undefined), doc)

export async function rotateEncryptedFields(): Promise<{ regravados: number; jaAtuais: number; ilegiveis: number }> {
  let regravados = 0
  let jaAtuais = 0
  let ilegiveis = 0

  for (const { colecao, campo } of LUGARES) {
    const cursor = db.collection(colecao).find({ [campo]: { $type: 'string' } })
    for await (const doc of cursor) {
      const valor = ler(doc as Record<string, unknown>, campo)
      if (typeof valor !== 'string' || !valor) continue
      if (usesCurrentKey(valor)) {
        jaAtuais += 1
        continue
      }
      try {
        const novo = encrypt(decrypt(valor))
        await db.collection(colecao).updateOne({ _id: doc._id }, { $set: { [campo]: novo } })
        regravados += 1
      } catch {
        // Nem o valor nem o motivo entram no log: o que se diz é onde procurar.
        console.error(`[rotate] não foi possível decifrar ${colecao}.${campo} do documento ${String(doc._id)}`)
        ilegiveis += 1
      }
    }
  }
  return { regravados, jaAtuais, ilegiveis }
}

// Execução direta (`npm run rotate:encryption-key`). Importado, não roda nada.
if (process.argv[1]?.includes('rotateEncryptionKey')) {
  await mongoClient.connect()
  const r = await rotateEncryptedFields()
  console.log(`[rotate] regravados: ${r.regravados} · já na chave atual: ${r.jaAtuais} · ilegíveis: ${r.ilegiveis}`)
  if (r.ilegiveis > 0) console.log('[rotate] mantenha a chave anterior em ENCRYPTION_KEY_PREVIOUS enquanto houver ilegíveis')
  await mongoClient.close()
}
