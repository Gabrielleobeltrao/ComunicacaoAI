import { createHash } from 'node:crypto'
import type { SandboxRuntime } from './provider.js'

// O SCANNER — e o que ele NÃO é.
//
// Ele não torna código confiável. Ele lê o fonte como TEXTO, depois de tirar comentários
// e literais de string, e procura construções que não têm por que existir numa função de
// extensão: subprocesso, filesystem, rede, import dinâmico, reflexão que reconstrói
// código a partir de string.
//
// Uma varredura léxica é derrotável — ofuscação, concatenação, codificação. É por isso
// que ela não é a defesa: a defesa é o ambiente isolado, e o scanner só evita gastar uma
// execução com o que já dá para recusar de graça. Scanner não substitui sandbox, sandbox
// não substitui grants, e revisão não transforma código em confiável.

export interface ScanFinding {
  rule: string
  /** A linha, para quem escreveu achar. Nunca o trecho inteiro do fonte. */
  line: number
  message: string
  severity: 'block' | 'warn'
}

export interface ScanResult {
  ok: boolean
  findings: ScanFinding[]
  sha256: string
  /** O que o código diz importar. É o SBOM da versão. */
  imports: string[]
  scanner: { name: string; version: string; rules: number }
}

/** A allowlist versionada: só a biblioteca padrão, e só a parte que não abre o mundo. */
export const ALLOWED_IMPORTS: Record<SandboxRuntime, readonly string[]> = {
  python: ['json', 'math', 'statistics', 'datetime', 'decimal', 'itertools', 'functools', 'collections', 're', 'string', 'textwrap', 'unicodedata', 'uuid', 'base64', 'hashlib'],
  javascript: [],
}

interface Regra {
  rule: string
  padrao: RegExp
  message: string
  runtimes: SandboxRuntime[]
  severity?: 'block' | 'warn'
}

/**
 * As regras. Cada uma existe por um caminho concreto de fuga, não por precaução genérica.
 */
const REGRAS: Regra[] = [
  { rule: 'subprocess', padrao: /\b(subprocess|os\.system|os\.popen|os\.exec[lv]|child_process|spawnSync|execSync)\b/, message: 'subprocesso não existe aqui', runtimes: ['python', 'javascript'] },
  { rule: 'filesystem', padrao: /(\bopen\s*\(|\bio\.open\b|\bpathlib\b|\bshutil\b|\bos\.remove\b|\bos\.mkdir\b|\bnode:fs\b)/, message: 'o disco é somente leitura e não é seu', runtimes: ['python', 'javascript'] },
  { rule: 'network', padrao: /(\bsocket\b|\burllib\b|\bhttp\.client\b|\brequests\b|\bhttpx\b|\baiohttp\b|\bfetch\s*\(|\bXMLHttpRequest\b|\bnode:https?\b|\bWebSocket\b)/, message: 'a rede é negada', runtimes: ['python', 'javascript'] },
  { rule: 'dynamic_code', padrao: /(\beval\s*\(|\bexec\s*\(|\bcompile\s*\(|new\s+Function\s*\(|\b__import__\b|\bimportlib\b)/, message: 'construir código a partir de texto não é permitido', runtimes: ['python', 'javascript'] },
  { rule: 'reflection', padrao: /(\bglobals\s*\(|\blocals\s*\(|__builtins__|__subclasses__|__mro__|__class__|constructor\s*\[|\bprocess\.binding\b)/, message: 'reflexão que alcança o interpretador não é permitida', runtimes: ['python', 'javascript'] },
  { rule: 'process_env', padrao: /\b(process\.env|os\.environ|environ\b)/, message: 'nenhum segredo mora no ambiente, e ele não é seu', runtimes: ['python', 'javascript'] },
  { rule: 'dynamic_import', padrao: /\bimport\s*\(/, message: 'import dinâmico não é permitido', runtimes: ['javascript'] },
  { rule: 'ctypes', padrao: /\b(ctypes|cffi|mmap|resource\.setrlimit)\b/, message: 'chamar código nativo não é permitido', runtimes: ['python'] },
  /**
   * Ofuscação: sinal, e não prova.
   *
   * Um `atob` num programa legítimo é raro; num programa que quer esconder o que faz, é
   * o primeiro passo. Marcado como aviso, para a revisão humana olhar — bloquear seria
   * recusar código honesto que decodifica um dado de entrada.
   */
  { rule: 'obfuscation', padrao: /\b(atob|btoa|fromCharCode|b64decode|codecs\.decode|unhexlify)\b/, message: 'decodificação de payload: a revisão precisa olhar', runtimes: ['python', 'javascript'], severity: 'warn' },
]

export const SCANNER = { name: 'lexical', version: '1.0.0', rules: REGRAS.length }

/**
 * Tira só os COMENTÁRIOS.
 *
 * A extração de imports precisa do conteúdo das strings — `require("child_process")` tem
 * o nome do módulo dentro de uma delas, e é exatamente esse nome que a allowlist confere.
 */
export function stripComments(fonte: string): string {
  return semLiterais(fonte, { manterStrings: true })
}

/**
 * Tira comentários e o CONTEÚDO das strings antes de procurar.
 *
 * Sem isto, um comentário explicando "não use subprocess" derruba a publicação, e uma
 * mensagem de erro contendo a palavra "socket" também. O que fica é a forma do código.
 */
export function stripLiterals(fonte: string): string {
  return semLiterais(fonte, { manterStrings: false })
}

function semLiterais(fonte: string, opcoes: { manterStrings: boolean }): string {
  let saida = ''
  let i = 0
  while (i < fonte.length) {
    const c = fonte[i]
    const proximo = fonte[i + 1]
    // Comentários de linha (`//` e `#`) e de bloco.
    if ((c === '/' && proximo === '/') || c === '#') {
      while (i < fonte.length && fonte[i] !== '\n') i++
      continue
    }
    if (c === '/' && proximo === '*') {
      i += 2
      while (i < fonte.length && !(fonte[i] === '*' && fonte[i + 1] === '/')) {
        if (fonte[i] === '\n') saida += '\n'
        i++
      }
      i += 2
      continue
    }
    // Strings: o delimitador fica (para a linha não sumir), o conteúdo some.
    if (c === '"' || c === "'" || c === '`') {
      const aspas = c
      const tripla = fonte[i + 1] === aspas && fonte[i + 2] === aspas
      const abertura = fonte.slice(i, i + (tripla ? 3 : 1))
      i += tripla ? 3 : 1
      let conteudo = ''
      while (i < fonte.length) {
        if (fonte[i] === '\\') {
          conteudo += fonte.slice(i, i + 2)
          i += 2
          continue
        }
        if (tripla ? fonte[i] === aspas && fonte[i + 1] === aspas && fonte[i + 2] === aspas : fonte[i] === aspas) break
        conteudo += fonte[i]
        i++
      }
      i += tripla ? 3 : 1
      saida += opcoes.manterStrings ? abertura + conteudo + abertura : `${aspas}${aspas}${conteudo.replace(/[^\n]/g, '')}`
      continue
    }
    saida += c
    i++
  }
  return saida
}

/** Os imports declarados — o SBOM da versão, lido do fonte e não do que alguém digitou. */
export function extractImports(fonte: string, runtime: SandboxRuntime): string[] {
  const limpo = stripComments(fonte)
  const achados = new Set<string>()
  if (runtime === 'python') {
    for (const m of limpo.matchAll(/^[^\S\n]*(?:from[^\S\n]+([\w.]+)[^\S\n]+import|import[^\S\n]+([\w.,][^\n]*))/gm)) {
      const alvo = m[1] ?? m[2] ?? ''
      for (const parte of alvo.split(',')) {
        const nome = parte.trim().split(/\s+as\s+/)[0].split('.')[0]
        if (nome) achados.add(nome)
      }
    }
  } else {
    for (const m of limpo.matchAll(/(?:^|\s)import\s+(?:[\w*{},\s]+from\s+)?["']([^"']+)["']/g)) achados.add(m[1])
    for (const m of limpo.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/g)) achados.add(m[1])
  }
  return [...achados].sort()
}

export function scanSource(fonte: string, runtime: SandboxRuntime): ScanResult {
  const sha256 = createHash('sha256').update(fonte).digest('hex')
  const limpo = stripLiterals(fonte)
  const linhas = limpo.split('\n')
  const findings: ScanFinding[] = []

  for (const regra of REGRAS) {
    if (!regra.runtimes.includes(runtime)) continue
    linhas.forEach((linha, idx) => {
      if (regra.padrao.test(linha)) {
        findings.push({ rule: regra.rule, line: idx + 1, message: regra.message, severity: regra.severity ?? 'block' })
      }
    })
  }

  // O import que não está na allowlist é bloqueio: "sem pacote arbitrário" só vale se a
  // lista for fechada, e não se ela for uma recomendação.
  const imports = extractImports(fonte, runtime)
  const permitidos = ALLOWED_IMPORTS[runtime]
  for (const imp of imports) {
    if (!permitidos.includes(imp)) {
      findings.push({ rule: 'import_not_allowed', line: 0, message: `"${imp}" não está na lista permitida deste runtime`, severity: 'block' })
    }
  }

  return { ok: !findings.some((f) => f.severity === 'block'), findings, sha256, imports, scanner: SCANNER }
}
