import { useSyncExternalStore } from 'react'

/**
 * O dedo está na tela?
 *
 * `pointer: coarse` e não largura: um tablet largo com dedo precisa do mesmo tratamento
 * que um telefone, e uma janela estreita de desktop com mouse não precisa de nenhum. É a
 * mesma condição que o sistema de design usa para crescer os alvos (`.ds-hit`), então
 * quem decide por aqui decide junto com o CSS, e não contra ele.
 *
 * `useSyncExternalStore` porque o valor muda sem recarregar: quem liga um mouse num
 * tablet troca de ponteiro no meio da sessão.
 */
// O prefixo `use` é contrato do React — o resto do nome segue o idioma do repositório.
export function usePonteiroGrosso() {
  return useSyncExternalStore(
    (avisar) => {
      const consulta = window.matchMedia('(pointer: coarse)')
      consulta.addEventListener('change', avisar)
      return () => consulta.removeEventListener('change', avisar)
    },
    () => window.matchMedia('(pointer: coarse)').matches,
    // No servidor não há ponteiro; o desktop é o palpite que não muda o HTML entregue.
    () => false,
  )
}
