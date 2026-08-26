/**
 * Riscar a credencial CONHECIDA de qualquer texto que vá ser guardado.
 *
 * Há serviço que ecoa a mensagem de autenticação de volta e há serviço que devolve o
 * token dentro da mensagem de erro. Nos dois casos a chave chega pelo socket, como
 * conteúdo — e daí para o trecho que a tela mostra, para o payload do evento e para o
 * dado ao vivo é um passo.
 *
 * Só valores com algum tamanho entram: riscar `paper` ou `usd` estragaria mensagem
 * legítima, e um "segredo" de três letras não é segredo.
 */
export const MASCARA = '***'

export function mascarar(texto: string, segredos: readonly string[]): string {
  let fora = String(texto ?? '')
  for (const segredo of segredos) {
    if (typeof segredo === 'string' && segredo.length >= 8) fora = fora.split(segredo).join(MASCARA)
  }
  return fora
}

/** Os valores de uma credencial que valem a pena riscar. */
export const segredosDe = (credencial: Record<string, string> | null | undefined): string[] =>
  Object.values(credencial ?? {}).filter((v) => typeof v === 'string' && v.length >= 8)
