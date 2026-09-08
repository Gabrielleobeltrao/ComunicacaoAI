import { useEffect } from 'react'
import { useLocation } from 'react-router'
import paginasPublicas from '../lib/paginasPublicas.json'

// O TÍTULO e a DESCRIÇÃO enquanto se navega.
//
// O HTML servido já vem com os metadados da rota — quem escreve são o build e a mesma
// lista que este arquivo lê (`paginasPublicas.json`). Isto aqui cobre o outro caminho: a
// navegação dentro do app não recarrega a página, então sem este efeito o título ficaria
// congelado no da primeira rota aberta. O que a aba mostra e o que a pessoa está vendo
// deixariam de bater, e o histórico do navegador viraria uma lista de entradas iguais.
//
// Sem biblioteca de `head`: são duas propriedades do documento, e uma dependência para
// escrevê-las custaria mais do que elas.

const { site, paginas } = paginasPublicas as {
  site: { nome: string; descricaoPadrao: string }
  paginas: { rota: string; titulo: string; descricao: string }[]
}

export function MetaDaPagina() {
  const { pathname } = useLocation()

  useEffect(() => {
    const publica = paginas.find((p) => p.rota === pathname)
    // Fora das públicas, o nome do produto: as telas do escritório exigem sessão e não
    // são para serem encontradas — anunciar o título de cada uma seria descrever por fora
    // o que só faz sentido por dentro.
    document.title = publica?.titulo ?? site.nome
    const descricao = publica?.descricao ?? site.descricaoPadrao
    let tag = document.querySelector('meta[name="description"]')
    if (!tag) {
      tag = document.createElement('meta')
      tag.setAttribute('name', 'description')
      document.head.appendChild(tag)
    }
    tag.setAttribute('content', descricao)
  }, [pathname])

  return null
}
