// A FRONTEIRA do código de terceiro — e ela é remota por definição.
//
// Nada aqui executa código. Não há `eval`, `new Function`, `vm`, `child_process`, `exec`,
// Python local nem container iniciado por este processo — e não é uma questão de estilo:
// qualquer uma dessas coisas roda o código do outro DENTRO do processo que tem a conexão
// com o banco, as chaves decifradas e a rede interna. O isolamento que interessa é o que
// existe antes de o código começar, não o que se tenta impor depois.
//
// Este arquivo define o contrato com um runner que mora fora. Enquanto ninguém configurar
// um, o provider padrão RECUSA tudo — e é isso que mantém "código" inexecutável por
// omissão, e não por lembrança de alguém.

export type SandboxRuntime = 'python' | 'javascript'

export interface SandboxLimits {
  cpuMs: number
  memoryMb: number
  pids: number
  wallMs: number
  outputBytes: number
}

/** Os limites que valem quando ninguém disse outra coisa. Apertados de propósito. */
export const DEFAULT_LIMITS: SandboxLimits = { cpuMs: 2_000, memoryMb: 128, pids: 32, wallMs: 5_000, outputBytes: 64 * 1024 }

/**
 * O que o backend manda — e a lista é curta de propósito.
 *
 * Não vai segredo, não vai conexão, não vai token de conta. O que dá acesso a alguma
 * coisa é o `capabilityHandles`: identificadores de curta duração que o runner devolve
 * ao broker, e é o broker que reconfere a permissão antes de qualquer efeito.
 */
export interface SandboxExecuteRequest {
  runtime: SandboxRuntime
  /** Referência à versão publicada. O código é buscado por hash, nunca colado aqui. */
  artifactRef: string
  sha256: string
  input: unknown
  limits: SandboxLimits
  capabilityHandles: string[]
  correlationId: string
}

export interface SandboxTestRequest extends SandboxExecuteRequest {
  /** Teste roda sem NENHUMA capacidade: ele prova que o código roda, não o que ele alcança. */
  capabilityHandles: never[]
}

export interface SandboxResult {
  ok: boolean
  /** Saída JSON ou texto, já limitada pelo runner. Nunca stack, nunca source. */
  output?: unknown
  metrics?: { cpuMs: number; wallMs: number; memoryMb: number; outputBytes: number }
  error?: { kind: 'timeout' | 'oom' | 'runtime' | 'denied' | 'unavailable'; message: string }
}

export interface SandboxHealth {
  ok: boolean
  /** O perfil que o runner AFIRMA cumprir. Produção confere item a item. */
  profile: {
    nonRoot: boolean
    readOnlyRootFs: boolean
    networkDenied: boolean
    noNewPrivileges: boolean
    seccomp: boolean
    ephemeral: boolean
    /** Limpeza conferível depois da execução. */
    verifiedCleanup: boolean
  }
  runtimes: SandboxRuntime[]
  detail?: string
}

export interface SandboxRuntimeProvider {
  testVersion(request: SandboxTestRequest): Promise<SandboxResult>
  execute(request: SandboxExecuteRequest): Promise<SandboxResult>
  health(): Promise<SandboxHealth>
}

/**
 * O provider padrão: RECUSA.
 *
 * Fail-closed não é uma mensagem de erro simpática — é o estado em que o sistema fica
 * quando ninguém configurou nada. Um padrão que executasse "só para desenvolver" acabaria
 * em produção no dia em que alguém esquecesse uma variável de ambiente.
 */
const recusaTudo: SandboxRuntimeProvider = {
  testVersion: async () => ({ ok: false, error: { kind: 'unavailable', message: 'não há runtime isolado configurado' } }),
  execute: async () => ({ ok: false, error: { kind: 'unavailable', message: 'não há runtime isolado configurado' } }),
  health: async () => ({
    ok: false,
    profile: { nonRoot: false, readOnlyRootFs: false, networkDenied: false, noNewPrivileges: false, seccomp: false, ephemeral: false, verifiedCleanup: false },
    runtimes: [],
    detail: 'nenhum provider registrado',
  }),
}

let provider: SandboxRuntimeProvider = recusaTudo
let registradoComoTeste = false

/**
 * Registra o runner. `testOnly` é uma trava real, não um rótulo.
 *
 * Um runner de teste que pudesse ser ligado em produção seria a porta de entrada mais
 * larga que este sistema teria — por isso a recusa acontece aqui, no registro, e não numa
 * conferência que alguém pode esquecer de fazer depois.
 */
export function registerSandboxProvider(p: SandboxRuntimeProvider, opcoes: { testOnly?: boolean } = {}): void {
  if (opcoes.testOnly && process.env.NODE_ENV === 'production') {
    throw new Error('um runner de teste não pode ser registrado em produção')
  }
  provider = p
  registradoComoTeste = Boolean(opcoes.testOnly)
}

export function resetSandboxProvider(): void {
  provider = recusaTudo
  registradoComoTeste = false
}

export const sandboxProvider = (): SandboxRuntimeProvider => provider
export const providerIsTestOnly = (): boolean => registradoComoTeste

/**
 * O perfil de isolamento conferido item a item — e em produção nenhum item é opcional.
 *
 * Um `health()` que devolve `ok: true` é a AFIRMAÇÃO do runner. Aceitar essa afirmação
 * inteira seria confiar no que está do outro lado da fronteira para dizer se a fronteira
 * existe.
 */
export function profileIsAcceptable(health: SandboxHealth): { ok: boolean; missing: string[] } {
  const exigido: (keyof SandboxHealth['profile'])[] = [
    'nonRoot',
    'readOnlyRootFs',
    'networkDenied',
    'noNewPrivileges',
    'seccomp',
    'ephemeral',
    'verifiedCleanup',
  ]
  const missing = exigido.filter((k) => !health.profile?.[k])
  return { ok: health.ok && missing.length === 0, missing }
}
