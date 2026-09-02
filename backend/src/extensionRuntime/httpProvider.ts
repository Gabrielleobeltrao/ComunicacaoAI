import { createHmac, randomUUID } from 'node:crypto'
import type { SandboxExecuteRequest, SandboxHealth, SandboxResult, SandboxRuntimeProvider, SandboxTestRequest } from './provider.js'

// O ADAPTADOR para o runner remoto — o único lugar do backend que fala com ele.
//
// A URL vem da CONFIGURAÇÃO do servidor, nunca de um pedido: deixar o cliente escolher o
// endereço do runner seria entregar a ele um proxy para a rede interna, e o código de
// terceiro passaria a rodar onde quem pediu quisesse.
//
// A autenticação é de serviço — HMAC sobre o corpo, com instante e nonce. Sem sessão de
// navegador: cookie viaja sozinho e identifica pessoa, quando o que precisa ser provado
// aqui é qual serviço está falando.

const SKEW_HEADER = 'x-sandbox-timestamp'
const NONCE_HEADER = 'x-sandbox-nonce'
const SIG_HEADER = 'x-sandbox-signature'

export interface HttpProviderConfig {
  baseUrl: string
  secret: string
  /** O teto de tempo DESTE lado. O runner tem o dele; o menor manda. */
  timeoutMs?: number
}

const assinar = (secret: string, timestamp: number, nonce: string, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex')

/**
 * A resposta é conferida antes de virar resultado.
 *
 * O runner está do outro lado de uma fronteira; tratar o que ele devolve como já válido
 * significaria que um runner comprometido escolhe o que o backend acredita.
 */
function normalizar(bruto: unknown): SandboxResult {
  const r = (bruto ?? {}) as Partial<SandboxResult>
  if (r.ok === true) {
    return {
      ok: true,
      output: r.output,
      ...(r.metrics
        ? {
            metrics: {
              cpuMs: Number(r.metrics.cpuMs ?? 0),
              wallMs: Number(r.metrics.wallMs ?? 0),
              memoryMb: Number(r.metrics.memoryMb ?? 0),
              outputBytes: Number(r.metrics.outputBytes ?? 0),
            },
          }
        : {}),
    }
  }
  const tipos = ['timeout', 'oom', 'runtime', 'denied', 'unavailable'] as const
  const kind = tipos.includes(r.error?.kind as (typeof tipos)[number]) ? (r.error!.kind as (typeof tipos)[number]) : 'runtime'
  return { ok: false, error: { kind, message: String(r.error?.message ?? 'a execução falhou').slice(0, 300) } }
}

const perfilVazio: SandboxHealth['profile'] = {
  nonRoot: false,
  readOnlyRootFs: false,
  networkDenied: false,
  noNewPrivileges: false,
  seccomp: false,
  ephemeral: false,
  verifiedCleanup: false,
}

export function httpSandboxProvider(config: HttpProviderConfig): SandboxRuntimeProvider {
  const timeoutMs = config.timeoutMs ?? 20_000
  const base = config.baseUrl.replace(/\/$/, '')

  async function chamar(caminho: string, corpo: unknown): Promise<unknown> {
    const body = JSON.stringify(corpo ?? {})
    const timestamp = Date.now()
    const nonce = randomUUID()
    const controle = new AbortController()
    const relogio = setTimeout(() => controle.abort(), timeoutMs)
    try {
      const resposta = await fetch(`${base}${caminho}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SKEW_HEADER]: String(timestamp),
          [NONCE_HEADER]: nonce,
          [SIG_HEADER]: assinar(config.secret, timestamp, nonce, body),
        },
        body,
        signal: controle.signal,
      })
      if (!resposta.ok) return { ok: false, error: { kind: 'unavailable', message: `o runner respondeu ${resposta.status}` } }
      return await resposta.json()
    } finally {
      clearTimeout(relogio)
    }
  }

  return {
    async execute(request: SandboxExecuteRequest): Promise<SandboxResult> {
      try {
        return normalizar(await chamar('/execute', request))
      } catch {
        // Runner fora do ar é indisponibilidade, não falha do código de quem escreveu.
        return { ok: false, error: { kind: 'unavailable', message: 'o runtime isolado não respondeu' } }
      }
    },
    async testVersion(request: SandboxTestRequest): Promise<SandboxResult> {
      try {
        // Teste roda sem capacidade nenhuma: ele prova que o código roda, não o que ele alcança.
        return normalizar(await chamar('/test', { ...request, capabilityHandles: [] }))
      } catch {
        return { ok: false, error: { kind: 'unavailable', message: 'o runtime isolado não respondeu' } }
      }
    },
    async health(): Promise<SandboxHealth> {
      try {
        const bruto = (await chamar('/health', {})) as { ok?: boolean; profile?: Partial<SandboxHealth['profile']>; runtimes?: unknown[] }
        // Cada item do perfil é lido como booleano do que VEIO; ausente é falso, e não
        // "provavelmente sim".
        const profile = Object.fromEntries(
          (Object.keys(perfilVazio) as (keyof SandboxHealth['profile'])[]).map((k) => [k, bruto.profile?.[k] === true]),
        ) as SandboxHealth['profile']
        return {
          ok: bruto.ok === true,
          profile,
          runtimes: (bruto.runtimes ?? []).filter((r): r is 'javascript' | 'python' => r === 'javascript' || r === 'python'),
        }
      } catch {
        return { ok: false, profile: perfilVazio, runtimes: [], detail: 'o runtime isolado não respondeu' }
      }
    },
  }
}

/**
 * Monta o provider a partir da configuração do servidor — ou não monta.
 *
 * Sem URL e sem segredo, devolve `null` e o padrão fail-closed continua valendo. É a
 * mesma regra do resto: o que não foi configurado não existe.
 */
export function providerFromEnv(): SandboxRuntimeProvider | null {
  const baseUrl = process.env.SANDBOX_RUNNER_URL
  const secret = process.env.SANDBOX_RUNNER_SECRET
  if (!baseUrl || !secret) return null
  return httpSandboxProvider({ baseUrl, secret, ...(process.env.SANDBOX_RUNNER_TIMEOUT_MS ? { timeoutMs: Number(process.env.SANDBOX_RUNNER_TIMEOUT_MS) } : {}) })
}
