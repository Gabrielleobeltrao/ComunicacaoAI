import type { AppEnvironment } from './types.js'

/**
 * O teste de conexão que fala com o provider DE VERDADE.
 *
 * O teste genérico confere se os campos obrigatórios estão preenchidos. Isso responde
 * "a configuração está completa", que não é a pergunta: uma chave completa e errada
 * passa nele e falha na primeira ordem.
 *
 * Um App pode registrar aqui uma sonda de LEITURA — nunca de escrita, nunca uma que
 * mova dinheiro. O que ela devolve é `ok` e uma frase; o corpo da resposta do provider
 * não sai daqui, porque ele carrega saldo, posição e, num erro de autenticação, a
 * própria credencial.
 */
export interface ConnectionProbe {
  (config: Record<string, string>, environment: AppEnvironment | string): Promise<{ ok: boolean; message: string }>
}

const probes = new Map<string, ConnectionProbe>()

export const registerConnectionProbe = (appKey: string, probe: ConnectionProbe): void => {
  probes.set(appKey, probe)
}

export const connectionProbeFor = (appKey: string): ConnectionProbe | null => probes.get(appKey) ?? null

/** Teto de espera de uma sonda. Um teste que pendura a tela não é um teste. */
export const PROBE_TIMEOUT_MS = Number(process.env.CONNECTION_PROBE_TIMEOUT_MS ?? 8_000)

/**
 * Corre a sonda com prazo. O `AbortController` fica com quem chama a rede; isto aqui é
 * a rede de segurança para uma sonda que trave sem cancelar nada.
 */
export async function runProbe(probe: ConnectionProbe, config: Record<string, string>, environment: string): Promise<{ ok: boolean; message: string }> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      probe(config, environment),
      new Promise<{ ok: boolean; message: string }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, message: 'O provedor não respondeu a tempo.' }), PROBE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}


/**
 * A sonda que precisa da INSTALAÇÃO inteira, e não só da credencial.
 *
 * A sonda acima recebe o `config` decifrado, que é tudo o que um App de chave e segredo
 * precisa. O App de WebSocket não: o endereço, os cabeçalhos e os subprotocolos moram
 * na configuração PÚBLICA da instalação, e sem eles o teste não tem o que abrir.
 *
 * Registrar aqui é o que faz o botão de testar valer em TODO caminho — a página de
 * Apps, a tela do App e a API —, em vez de um deles chamar o teste de verdade e os
 * outros continuarem respondendo "os campos estão preenchidos".
 */
export interface InstallationProbe {
  (ownerId: string, installationId: string): Promise<{ ok: boolean; message: string }>
}

const installationProbes = new Map<string, InstallationProbe>()

export const registerInstallationProbe = (appKey: string, probe: InstallationProbe): void => {
  installationProbes.set(appKey, probe)
}

export const installationProbeFor = (appKey: string): InstallationProbe | null => installationProbes.get(appKey) ?? null
