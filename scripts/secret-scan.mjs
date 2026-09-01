#!/usr/bin/env node
// Varredura de segredo no que ESTÁ VERSIONADO.
//
// Não substitui um serviço dedicado: procura o que tem forma reconhecível — prefixos
// anunciados pelos próprios provedores, chave privada e JWT — nos arquivos rastreados
// pelo git. É de propósito o mesmo conjunto de padrões que `architect/secrets.ts` usa
// para mascarar entrada de usuário: se um formato vale a pena mascarar na conversa,
// vale a pena impedir que ele entre no repositório.
//
// Sem dependência e sem rede: roda igual na máquina de quem desenvolve e no CI.
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const PADROES = [
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, 'chave Anthropic'],
  [/\bsk-[A-Za-z0-9_-]{32,}/g, 'chave OpenAI'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, 'token GitHub'],
  [/\bxox[abposr]-[A-Za-z0-9-]{20,}/g, 'token Slack'],
  [/\b[sr]k_live_[A-Za-z0-9]{16,}/g, 'chave Stripe de produção'],
  [/\bAIza[A-Za-z0-9_-]{35}/g, 'chave Google'],
  [/\bAKIA[A-Z0-9]{16}\b/g, 'chave AWS'],
  [/\bBSA[A-Za-z0-9_-]{20,}/g, 'chave Brave Search'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, 'chave privada'],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, 'JWT'],
]

// O que é ruído conhecido: o próprio scanner e o módulo que DEFINE os padrões.
// Ignorar por CAMINHO, e nunca por padrão — desligar um padrão desligaria a busca
// inteira daquele formato, em todo lugar.
const IGNORAR = [
  /^scripts\/secret-scan\.mjs$/,
  /^backend\/src\/architect\/secrets\.ts$/,
  /^package-lock\.json$/,
]

/**
 * Um valor que se ANUNCIA como falso.
 *
 * A alternativa seria não varrer os testes — e é justamente lá que uma credencial de
 * verdade tem mais chance de ser colada "só para ver se funciona". Aqui os arquivos
 * continuam sendo lidos; o que passa é o valor que qualquer um reconhece como fixture:
 * o alfabeto em sequência, o `EXAMPLE` da própria AWS, a palavra "teste".
 *
 * Um segredo real não se parece com nada disto.
 */
const ehObviamenteFalso = (valor) =>
  /abcdefghij|0123456789|EXAMPLE|nao-e-real|naoeumsegredo|de-teste|-teste-|fake|dummy|xxxxxxxx|aaaaaaaa/i.test(valor)

const arquivos = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((f) => !IGNORAR.some((r) => r.test(f)))

const achados = []
for (const arquivo of arquivos) {
  let tamanho
  try {
    tamanho = statSync(arquivo).size
  } catch {
    continue
  }
  if (tamanho > 2_000_000) continue // binário/artefato: não é onde segredo em texto mora
  let texto
  try {
    texto = readFileSync(arquivo, 'utf8')
  } catch {
    continue
  }
  for (const [padrao, rotulo] of PADROES) {
    for (const m of texto.matchAll(padrao)) {
      if (ehObviamenteFalso(m[0])) continue
      const linha = texto.slice(0, m.index).split('\n').length
      // O VALOR não é impresso: um relatório que ecoa o segredo o copia para o log do CI,
      // que é público. O que se diz é onde procurar.
      achados.push(`${arquivo}:${linha}: possível ${rotulo}`)
    }
  }
}

if (achados.length > 0) {
  console.error('Segredo em potencial no que está versionado:')
  for (const a of achados) console.error(`  ${a}`)
  console.error('\nSe for falso positivo, acrescente o CAMINHO à lista IGNORAR de scripts/secret-scan.mjs.')
  process.exit(1)
}
console.log(`secret-scan: ${arquivos.length} arquivos, nada encontrado`)
