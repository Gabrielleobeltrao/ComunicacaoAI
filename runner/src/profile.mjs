import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { access, constants, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// O PERFIL — medido, e não declarado.
//
// Um health que diz "estou isolado" porque alguém escreveu isso na configuração não vale
// nada: é justamente quando a configuração está errada que a afirmação seria falsa. Cada
// item aqui é uma tentativa real, e o resultado é o que a tentativa produziu.
//
// Numa máquina de desenvolvimento, boa parte dá `false` — e é isso que mantém o backend
// recusando habilitar código, sem ninguém precisar lembrar de desligar uma flag.

const ALVO_DE_REDE = { host: process.env.SANDBOX_NET_PROBE_HOST ?? '1.1.1.1', port: Number(process.env.SANDBOX_NET_PROBE_PORT ?? 443) }

/** O modelo de permissão está de pé no filho? Provado rodando um filho e olhando. */
async function permissaoAtiva() {
  return new Promise((resolve) => {
    const filho = spawn(
      process.execPath,
      [
        '--permission',
        '--disallow-code-generation-from-strings',
        '--no-warnings',
        '--input-type=module',
        '-e',
        `let fs = 'permitido'
try { const m = await import('node:fs'); m.readFileSync('/etc/hostname') } catch (e) { fs = e.code === 'ERR_ACCESS_DENIED' ? 'negado' : 'erro' }
let gerado = 'permitido'
try { new Function('return 1')() } catch { gerado = 'negado' }
process.stdout.write(JSON.stringify({ fs, gerado }))`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin' } },
    )
    let saida = ''
    filho.stdout.on('data', (d) => (saida += d))
    filho.on('error', () => resolve(false))
    filho.on('close', () => {
      try {
        const r = JSON.parse(saida)
        resolve(r.fs === 'negado' && r.gerado === 'negado')
      } catch {
        resolve(false)
      }
    })
    setTimeout(() => filho.kill('SIGKILL'), 5_000).unref?.()
  })
}

/** A raiz é somente leitura? Tentar escrever nela é a única resposta honesta. */
async function raizSomenteLeitura() {
  const alvo = '/.sandbox-probe'
  try {
    await writeFile(alvo, 'x')
    await unlink(alvo).catch(() => undefined)
    return false
  } catch {
    return true
  }
}

/** Existe um temporário utilizável? A COTA dele é do deploy; o que se mede aqui é o acesso. */
async function temporarioUtilizavel() {
  try {
    await access(tmpdir(), constants.W_OK)
    const alvo = join(tmpdir(), `probe-${process.pid}`)
    await writeFile(alvo, 'x')
    await unlink(alvo)
    return true
  } catch {
    return false
  }
}

/** A rede está negada? Uma tentativa de conexão diz mais do que qualquer configuração. */
async function redeNegada(timeoutMs = 1_500) {
  return new Promise((resolve) => {
    let soquete
    try {
      soquete = connect({ host: ALVO_DE_REDE.host, port: ALVO_DE_REDE.port })
    } catch {
      return resolve(true)
    }
    const fim = (negada) => {
      soquete.removeAllListeners()
      soquete.destroy()
      resolve(negada)
    }
    soquete.setTimeout(timeoutMs, () => fim(true))
    soquete.on('connect', () => fim(false))
    soquete.on('error', () => fim(true))
  })
}

/**
 * O perfil inteiro.
 *
 * `ephemeral` e `verifiedCleanup` vêm do DEPLOY e são declarados por variável de
 * ambiente: o processo não consegue provar que o container dele é descartável — quem sabe
 * disso é o orquestrador. Falsos por omissão, como tudo aqui.
 */
export async function measureProfile() {
  const [permissao, raiz, temporario, rede] = await Promise.all([permissaoAtiva(), raizSomenteLeitura(), temporarioUtilizavel(), redeNegada()])

  const naoRoot = typeof process.getuid === 'function' ? process.getuid() !== 0 : false
  return {
    nonRoot: naoRoot,
    readOnlyRootFs: raiz,
    networkDenied: rede,
    // O modelo de permissão do Node é o que, dentro do processo, faz o papel do
    // `no-new-privileges` e do seccomp: ele nega a chamada antes de ela sair. As duas
    // variáveis dizem que o container também os aplica — e sem elas isto é falso.
    noNewPrivileges: permissao && process.env.SANDBOX_NO_NEW_PRIVILEGES === '1',
    seccomp: permissao && process.env.SANDBOX_SECCOMP === '1',
    ephemeral: process.env.SANDBOX_EPHEMERAL === '1',
    verifiedCleanup: temporario && process.env.SANDBOX_EPHEMERAL === '1',
    permissionModel: permissao,
    tmpWritable: temporario,
  }
}
