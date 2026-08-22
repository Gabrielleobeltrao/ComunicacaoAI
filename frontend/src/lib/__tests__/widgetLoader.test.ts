// O script que o cliente cola no site dele.
//
// Ele vive em DUAS origens ao mesmo tempo, e confundir as duas era o defeito: o arquivo é
// servido pelo FRONTEND (o chat abre num iframe de lá), mas a configuração e as mensagens
// vêm do BACKEND, que é outro domínio em produção.
//
// Antes tudo usava a origem do script. Em desenvolvimento funcionava — o Vite faz proxy
// de /api —, e em produção o nginx do frontend não faz: o loader recebia o index.html no
// lugar do JSON e o widget não montava. Nenhum erro no site do cliente, nada no ar.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const FONTE = readFileSync(resolve(__dirname, '../../widget-loader.js'), 'utf8')

/**
 * O mínimo de navegador que o loader usa.
 *
 * Escrito à mão em vez de trazer um jsdom só para este arquivo: são seis coisas
 * (`currentScript`, `createElement`, `body`, `addEventListener`, `URL`, `fetch`), e uma
 * dependência nova para testar vinte linhas é mais peso do que informação.
 */
function janelaFalsa(opts: { scriptOrigin: string; dataApiUrl?: string; semChave?: boolean }) {
  const criados: { tag: string; props: Record<string, unknown> }[] = []
  const atributos: Record<string, string> = {
    ...(opts.semChave ? {} : { 'data-widget-key': 'chave-publica' }),
    ...(opts.dataApiUrl ? { 'data-api-url': opts.dataApiUrl } : {}),
  }
  const elemento = (tag: string) => {
    const props: Record<string, unknown> = {
      style: { cssText: '' },
      appendChild: () => undefined,
      addEventListener: () => undefined,
      setAttribute: () => undefined,
    }
    criados.push({ tag, props })
    return props
  }
  return {
    criados,
    document: {
      currentScript: { src: `${opts.scriptOrigin}/widget-loader.js`, getAttribute: (n: string) => atributos[n] ?? null },
      createElement: elemento,
      body: { appendChild: () => undefined },
      addEventListener: () => undefined,
    },
  }
}

/** Roda o loader REAL, com o marcador trocado como o build faz. */
function carregar(opts: { scriptOrigin: string; apiOrigin: string; dataApiUrl?: string; semChave?: boolean }) {
  const chamadas: string[] = []
  const { document: doc, criados } = janelaFalsa(opts)
  const fetchFalso = (url: string) => {
    chamadas.push(url)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ position: 'right', primaryColor: '#000' }) })
  }
  const codigo = FONTE.replaceAll('__API_ORIGIN__', opts.apiOrigin)
  new Function('document', 'fetch', 'console', 'URL', codigo)(doc, fetchFalso, { error: () => undefined }, URL)
  return { chamadas, criados }
}

describe('widget-loader', () => {
  it('busca a configuração no BACKEND, não na origem do script', () => {
    const { chamadas } = carregar({ scriptOrigin: 'https://app.exemplo.test', apiOrigin: 'https://api.exemplo.test' })
    expect(chamadas[0]).toBe('https://api.exemplo.test/api/public/widgets/chave-publica')
    // Era isto que quebrava: o frontend não serve /api, e devolvia o index.html.
    expect(chamadas[0]).not.toContain('app.exemplo.test')
  })

  it('o iframe continua saindo do FRONTEND — é de lá que o chat é servido', async () => {
    const { criados } = carregar({ scriptOrigin: 'https://app.exemplo.test', apiOrigin: 'https://api.exemplo.test' })
    // A montagem acontece depois de duas voltas de promessa (fetch → json → build).
    await new Promise((r) => setTimeout(r, 5))
    const iframe = criados.find((c) => c.tag === 'iframe')
    expect(criados.map((c) => c.tag), 'o widget precisa criar botão e iframe').toContain('iframe')
    expect(iframe?.props.src).toBe('https://app.exemplo.test/widget/chave-publica')
  })

  it('o snippet ANTIGO continua funcionando, sem o cliente trocar uma linha', () => {
    // Sem `data-api-url`: cai no valor do build, que é o que conserta as instalações
    // que já existem por aí.
    const { chamadas } = carregar({ scriptOrigin: 'https://app.exemplo.test', apiOrigin: 'https://api.exemplo.test' })
    expect(chamadas[0]).toContain('https://api.exemplo.test')
  })

  it('`data-api-url` sobrepõe o valor do build', () => {
    const { chamadas } = carregar({
      scriptOrigin: 'https://app.exemplo.test',
      apiOrigin: 'https://api.exemplo.test',
      dataApiUrl: 'https://outro.exemplo.test/',
    })
    // E a barra final não vira duas.
    expect(chamadas[0]).toBe('https://outro.exemplo.test/api/public/widgets/chave-publica')
  })

  it('sem valor de build, usa a origem do script — é o que faz o desenvolvimento funcionar', () => {
    const { chamadas } = carregar({ scriptOrigin: 'http://localhost:5173', apiOrigin: '' })
    expect(chamadas[0]).toBe('http://localhost:5173/api/public/widgets/chave-publica')
  })

  it('sem a chave, não faz requisição nenhuma', () => {
    const { chamadas } = carregar({ scriptOrigin: 'https://app.exemplo.test', apiOrigin: 'https://api.exemplo.test', semChave: true })
    expect(chamadas).toEqual([])
  })

  it('o marcador existe no fonte — sem ele o build não injeta nada', () => {
    // O plugin do Vite falha o build se isto sumir; o teste diz por quê.
    expect(FONTE).toContain('__API_ORIGIN__')
  })
})
