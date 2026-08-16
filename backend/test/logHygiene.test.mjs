// O que NUNCA pode ir para um log.
//
// Um log é lido por gente que não tem — e não deveria ter — acesso ao conteúdo dos
// clientes. Credencial, prompt, resposta da LLM, corpo cru de provedor e URL privada
// do dono ficam fora. O que fica é: o que falhou, onde, e com qual status.
//
// Este teste lê a fonte. Ele falha quando alguém passa uma dessas coisas para
// console.*, mesmo com a melhor das intenções de depuração.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname

function sources(dir = SRC, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sources(full, acc)
    else if (entry.endsWith('.ts')) acc.push(full)
  }
  return acc
}

// Uma chamada de console.* com seus argumentos, ignorando comentários.
function logCalls(src) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...clean.matchAll(/console\.(log|error|warn|info|debug)\(([^\n]*)/g)].map((m) => m[2])
}

const files = sources().filter((f) => !f.includes('/scripts/'))

test('nenhum log recebe corpo cru de resposta de provedor', () => {
  for (const file of files) {
    for (const call of logCalls(readFileSync(file, 'utf8'))) {
      assert.ok(
        !/res(ponse)?\.text\(\)|await\s+\w*res\w*\.json\(\)/.test(call),
        `${file}: log com corpo cru de provedor — use o status.\n  ${call.trim()}`,
      )
    }
  }
})

test('nenhum log recebe uma URL inteira', () => {
  for (const file of files) {
    for (const call of logCalls(readFileSync(file, 'utf8'))) {
      // `${url}` interpolado num log é o padrão que vaza token em query/path.
      assert.ok(
        !/\$\{\s*\w*[uU]rl\w*\s*\}/.test(call),
        `${file}: log com URL inteira — a URL do dono costuma carregar token. Use só o host.\n  ${call.trim()}`,
      )
    }
  }
})

test('nenhum log recebe prompt, mensagem ou saída da LLM', () => {
  const forbidden = /\b(prompt|systemPrompt|objective|completion|answer|replyText|messageText|instructions)\b/
  for (const file of files) {
    for (const call of logCalls(readFileSync(file, 'utf8'))) {
      assert.ok(!forbidden.test(call), `${file}: log com conteúdo de execução.\n  ${call.trim()}`)
    }
  }
})

test('nenhum log recebe credencial', () => {
  const forbidden = /\b(apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|clientSecret|client_secret|encryptedConfig|password|decrypt\()/
  for (const file of files) {
    for (const call of logCalls(readFileSync(file, 'utf8'))) {
      assert.ok(!forbidden.test(call), `${file}: log com credencial.\n  ${call.trim()}`)
    }
  }
})
