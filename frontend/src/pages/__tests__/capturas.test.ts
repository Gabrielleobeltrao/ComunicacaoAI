// AS MEDIDAS declaradas para cada captura, contra o arquivo de verdade.
//
// `width`/`height` num `<img>` não desenham nada: dão ao navegador a proporção para
// reservar o espaço antes de a imagem chegar. Erradas, a página salta quando cada uma
// carrega — e as três traziam o mesmo `1280x820` copiado, sendo que duas não são disso.
//
// Ninguém percebe isso lendo o código: o número está certo no dia em que foi escrito e
// fica errado no dia em que a captura é regravada com outro recorte. Por isso o caso
// abre o PNG e lê o cabeçalho.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CAPTURAS } from '../Home'

/** Largura e altura do IHDR — os 8 bytes logo depois da assinatura e do tamanho do bloco. */
function medidasDoPng(caminho: string) {
  const bytes = readFileSync(caminho)
  expect(bytes.subarray(1, 4).toString('latin1'), `${caminho} não é PNG`).toBe('PNG')
  return { largura: bytes.readUInt32BE(16), altura: bytes.readUInt32BE(20) }
}

describe('capturas da landing', () => {
  it('toda captura declara a medida do arquivo que ela é', () => {
    expect(CAPTURAS.length).toBeGreaterThan(0)
    for (const c of CAPTURAS) {
      const real = medidasDoPng(new URL(`../../../public${c.arquivo}`, import.meta.url).pathname)
      expect({ arquivo: c.arquivo, ...real }).toEqual({ arquivo: c.arquivo, largura: c.largura, altura: c.altura })
    }
  })

  it('toda captura tem texto alternativo que descreve a tela', () => {
    // `alt` vazio numa imagem que carrega o argumento da página é a página inteira
    // sumindo para quem usa leitor de tela.
    for (const c of CAPTURAS) expect(c.alt.length, `${c.arquivo} sem alt`).toBeGreaterThan(30)
  })
})
