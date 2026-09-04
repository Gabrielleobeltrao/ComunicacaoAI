import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

// EXECUTAR — num processo filho novo, sem permissão para nada.
//
// O isolamento não é um conjunto de boas intenções escritas em volta do código do outro;
// ele é o que o processo filho NÃO consegue fazer:
//
//   --permission                              nega filesystem, subprocesso, worker e
//                                             addon nativo, dentro do próprio Node
//   --disallow-code-generation-from-strings   mata eval e new Function
//   --max-old-space-size                      teto de heap; estourar mata o processo
//   -e                                        o programa inteiro é o argumento: não há
//                                             arquivo para ler, e nada em disco para
//                                             sobrar depois
//
// O que ESTE arquivo não consegue garantir sozinho é rede: o modelo de permissão do Node
// não cobre socket. Quem garante isso é o container (egress negado), e o runner MEDE isso
// em vez de afirmar — ver profile.mjs. Se a rede não estiver bloqueada, o health responde
// que não está, e o backend recusa habilitar código.

export const RUNTIMES = ['javascript']

const ARGS_BASE = ['--permission', '--disallow-code-generation-from-strings', '--no-warnings', '--input-type=module']

/**
 * A versão em que `--permission` passou a existir com esse nome.
 *
 * Antes dela o flag se chamava `--experimental-permission`, e um Node mais antigo recebe
 * `--permission` como opção desconhecida: ele sai na largada, com código diferente de zero.
 */
const NODE_COM_PERMISSAO = [22, 13, 0]

/**
 * Este Node sabe armar o sandbox?
 *
 * A pergunta é de SEGURANÇA, não de compatibilidade. Sem o modelo de permissão, o processo
 * filho enxerga o disco, abre subprocesso e carrega addon nativo — ou seja, o código do autor
 * roda sem isolamento nenhum. A única resposta segura é não rodar.
 *
 * O sintoma sem esta checagem é pior que a falha: o filho morre em milissegundos e o runner
 * responde "a execução falhou", que aponta o dedo para o script do autor. Foi assim que uma CI
 * inteira ficou vermelha sem ninguém saber por quê — ela roda num Node mais velho que o das
 * imagens, e o sandbox nunca chegou a existir lá.
 */
export function permissaoDisponivel(versao = process.versions.node) {
  const partes = String(versao).split('.').map((n) => Number.parseInt(n, 10))
  for (let i = 0; i < 3; i += 1) {
    const atual = partes[i] ?? 0
    const minimo = NODE_COM_PERMISSAO[i]
    if (atual > minimo) return true
    if (atual < minimo) return false
  }
  return true
}

/**
 * O programa que roda no filho: o código do autor vira uma função, e a entrada chega pelo
 * stdin. Nada de `import()` do que o autor escrever — o `--permission` já nega, e a
 * mensagem daqui explica em vez de deixar o erro cru vazar.
 */
function montarPrograma(source) {
  return `
const __chunks = []
for await (const c of process.stdin) __chunks.push(c)
const __input = JSON.parse(Buffer.concat(__chunks).toString('utf8') || 'null')

// Rede fora do alcance do que é global: o que sobra é o container negar egress.
globalThis.fetch = () => { throw new Error('rede bloqueada') }
globalThis.WebSocket = undefined
globalThis.XMLHttpRequest = undefined

${source}

if (typeof run !== 'function') {
  process.stdout.write(JSON.stringify({ __sandbox: 'error', kind: 'runtime', message: 'o código precisa declarar uma função run(input)' }))
  process.exit(0)
}
try {
  const saida = await run(__input)
  process.stdout.write(JSON.stringify({ __sandbox: 'ok', output: saida === undefined ? null : saida }))
} catch (e) {
  // A mensagem do autor pode conter o que ele quiser; o stack, não — ele conta caminho
  // de arquivo e, com frequência, valor de variável. E uma recusa do modelo de permissão
  // vira uma frase nossa: a do Node ensina qual flag ligar para contornar.
  // O modelo de permissão recusa com ERR_ACCESS_DENIED; carregar addon nativo recusa com
  // ERR_DLOPEN_DISABLED. As duas são a mesma coisa para quem escreveu: não é permitido.
  const negado = e && (e.code === 'ERR_ACCESS_DENIED' || String(e.code || '').startsWith('ERR_DLOPEN'))
  process.stdout.write(JSON.stringify({
    __sandbox: 'error',
    kind: negado ? 'denied' : 'runtime',
    message: negado ? 'esta operação não é permitida no runtime isolado' : String(e && e.message ? e.message : e).slice(0, 300),
  }))
}
process.exit(0)
`
}

export const hashOf = (source) => createHash('sha256').update(source).digest('hex')

/**
 * Roda e devolve resultado tipado. Nunca lança: o chamador recebe erro como dado.
 *
 * O corte por tempo é DURO — `SIGKILL` depois de um `SIGTERM` que não foi obedecido. Um
 * laço infinito não responde a pedido educado, e é exatamente ele que o teto existe para
 * interromper.
 */
export async function executeJavascript({ source, input, limits, sha256 }) {
  const comecou = Date.now()
  if (sha256 && hashOf(source) !== sha256) {
    // O hash é o que liga o que roda ao que foi revisado. Diferente = não é isso.
    return { ok: false, error: { kind: 'denied', message: 'o código não corresponde ao hash revisado' } }
  }

  /**
   * SEM MODELO DE PERMISSÃO, NÃO RODA. Fail-closed, e o motivo é o runner — não o autor.
   *
   * Deixar seguir aqui daria uma de duas coisas, ambas ruins: o filho morrendo com "opção
   * desconhecida" e o erro sendo atribuído ao script de quem escreveu; ou, num Node que
   * aceitasse o flag antigo, o código rodando com isolamento que ninguém conferiu.
   */
  if (!permissaoDisponivel()) {
    return {
      ok: false,
      error: {
        kind: 'denied',
        message: `este runner exige Node ${NODE_COM_PERMISSAO.join('.')} ou mais novo: sem o modelo de permissão o código rodaria sem isolamento`,
      },
    }
  }

  const teto = {
    wallMs: Math.min(30_000, Math.max(100, limits?.wallMs ?? 5_000)),
    memoryMb: Math.min(512, Math.max(16, limits?.memoryMb ?? 128)),
    outputBytes: Math.min(1024 * 1024, Math.max(1024, limits?.outputBytes ?? 64 * 1024)),
  }

  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [...ARGS_BASE, `--max-old-space-size=${teto.memoryMb}`, '-e', montarPrograma(source)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Ambiente VAZIO: nenhum segredo do runner atravessa para o código do autor, nem
      // por engano de configuração. `NODE_OPTIONS` fora daqui também impede que uma
      // variável de ambiente do host reative o que os argumentos desligaram.
      env: { PATH: '/usr/bin:/bin' },
      cwd: '/',
    })

    let saida = ''
    let erro = ''
    let cortado = false
    let excedeu = false

    const relogio = setTimeout(() => {
      cortado = true
      filho.kill('SIGKILL')
    }, teto.wallMs)

    filho.stdout.on('data', (d) => {
      saida += d
      if (saida.length > teto.outputBytes) {
        excedeu = true
        filho.kill('SIGKILL')
      }
    })
    filho.stderr.on('data', (d) => {
      erro += String(d).slice(0, 2000)
    })

    filho.on('error', () => {
      clearTimeout(relogio)
      resolve({ ok: false, error: { kind: 'runtime', message: 'não foi possível iniciar a execução' } })
    })

    filho.on('close', (codigo, sinal) => {
      clearTimeout(relogio)
      const wallMs = Date.now() - comecou
      const metrics = { cpuMs: wallMs, wallMs, memoryMb: teto.memoryMb, outputBytes: saida.length }

      if (cortado) return resolve({ ok: false, metrics, error: { kind: 'timeout', message: `passou de ${teto.wallMs}ms e foi interrompido` } })
      if (excedeu) return resolve({ ok: false, metrics, error: { kind: 'runtime', message: 'a saída passou do limite' } })
      // Heap estourado mata o processo com sinal, ou sai diferente de zero dizendo isso.
      if (sinal || /heap out of memory|Allocation failed/i.test(erro)) {
        return resolve({ ok: false, metrics, error: { kind: 'oom', message: 'a execução passou do limite de memória' } })
      }
      if (codigo !== 0) return resolve({ ok: false, metrics, error: { kind: 'runtime', message: 'a execução falhou' } })

      let corpo
      try {
        corpo = JSON.parse(saida)
      } catch {
        return resolve({ ok: false, metrics, error: { kind: 'runtime', message: 'a execução não devolveu um resultado válido' } })
      }
      if (corpo?.__sandbox === 'ok') return resolve({ ok: true, output: corpo.output, metrics })
      return resolve({ ok: false, metrics, error: { kind: corpo?.kind === 'denied' ? 'denied' : 'runtime', message: String(corpo?.message ?? 'a execução falhou') } })
    })

    filho.stdin.on('error', () => undefined)
    filho.stdin.end(JSON.stringify(input ?? null))
  })
}
