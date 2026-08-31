import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

// O cofre das credenciais do dono — e a rotação da chave que o abre.
//
// O formato agora é VERSIONADO. Sem versão, trocar a chave era escolher entre dois
// males: perder toda credencial já guardada ou nunca mais trocar a chave. Com versão e
// uma lista de chaves antigas, a troca é um deploy: a chave nova passa a cifrar, as
// antigas continuam decifrando o que já existe até tudo ser regravado.

const ALGORITHM = 'aes-256-gcm'
const VERSAO = 'v2'
const SAL = 'comunicacaoai-secrets'

/** A derivação é cara de propósito; repeti-la a cada credencial não é. */
const cacheDeChaves = new Map<string, Buffer>()
const derivar = (segredo: string): Buffer => {
  const guardada = cacheDeChaves.get(segredo)
  if (guardada) return guardada
  const chave = scryptSync(segredo, SAL, 32)
  cacheDeChaves.set(segredo, chave)
  return chave
}

function chaveAtual(): Buffer {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) throw new Error('ENCRYPTION_KEY is not set')
  return derivar(secret)
}

/**
 * As chaves que ainda DECIFRAM, em ordem: a atual e as anteriores.
 *
 * `ENCRYPTION_KEY_PREVIOUS` aceita mais de uma, separadas por vírgula — uma rotação
 * pode pegar a anterior no meio do caminho, e perder credencial numa janela dessas
 * significa canal de WhatsApp mudo e integração quebrada sem ninguém entender por quê.
 */
function chavesParaDecifrar(): Buffer[] {
  const anteriores = (process.env.ENCRYPTION_KEY_PREVIOUS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(derivar)
  return [chaveAtual(), ...anteriores]
}

export function encrypt(plainText: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, chaveAtual(), iv)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [VERSAO, iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join('.')
}

function abrir(chave: Buffer, ivB64: string, tagB64: string, dataB64: string): string {
  const decipher = createDecipheriv(ALGORITHM, chave, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

export function decrypt(payload: string): string {
  const partes = String(payload ?? '').split('.')
  // Três partes é o formato ANTERIOR, sem versão. Ele continua sendo lido: o que já
  // está no banco não se reescreve sozinho, e recusá-lo aqui apagaria integrações.
  const [ivB64, tagB64, dataB64] = partes.length === 4 && partes[0] === VERSAO ? partes.slice(1) : partes

  let ultimo: unknown
  for (const chave of chavesParaDecifrar()) {
    try {
      return abrir(chave, ivB64, tagB64, dataB64)
    } catch (error) {
      // GCM falha inteiro quando a chave está errada — não há como saber qual era sem
      // tentar. A última falha é a que sobe, e ela não diz qual chave foi tentada.
      ultimo = error
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error('Não foi possível decifrar')
}

/** Este texto foi cifrado com a chave ATUAL? É o que diz se a regravação já terminou. */
export function usesCurrentKey(payload: string): boolean {
  const partes = String(payload ?? '').split('.')
  const [ivB64, tagB64, dataB64] = partes.length === 4 && partes[0] === VERSAO ? partes.slice(1) : partes
  try {
    abrir(chaveAtual(), ivB64, tagB64, dataB64)
    return true
  } catch {
    return false
  }
}

/** Recifra com a chave atual. Decifrar com a antiga e cifrar com a nova, num passo. */
export const reencrypt = (payload: string): string => encrypt(decrypt(payload))
