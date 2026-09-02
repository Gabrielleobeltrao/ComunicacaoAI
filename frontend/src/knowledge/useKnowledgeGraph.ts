import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../lib/knowledge'
import type { KnowledgeGraph } from '../lib/knowledge'

// O carregamento do mapa — com os quatro estados separados.
//
// Carregando, vazio, erro e carregado precisam ser distinguíveis: um erro de API
// desenhado como grafo vazio faz a pessoa concluir que não há conhecimento nenhum e sair
// para criar o que já existe.

export interface GraphFilters {
  q?: string
  status?: string
  source?: string
  viewAs?: string | null
  limit?: number
}

export function useKnowledgeGraph(floorId: string | undefined, filtros: GraphFilters) {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const chave = JSON.stringify({ floorId, ...filtros })

  const carregar = useCallback(async () => {
    if (!floorId) return
    setLoading(true)
    setError(null)
    try {
      setGraph(await api.getGraph({ floorId, ...filtros }))
    } catch (e) {
      // O grafo anterior FICA na tela: apagá-lo por causa de uma falha de rede é a mesma
      // mentira de mostrar vazio.
      setError((e as Error).message || 'não foi possível carregar o mapa')
    } finally {
      setLoading(false)
    }
    // `chave` é a dependência real: um objeto de filtros novo a cada render recarregaria
    // o mapa para sempre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  useEffect(() => {
    void carregar()
  }, [carregar])

  /** As posições arrastadas, guardadas com atraso: um `mousemove` por request é abuso. */
  const pendentes = useRef<Map<string, { x: number; y: number }>>(new Map())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moveNode = useCallback(
    (nodeId: string, x: number, y: number) => {
      setGraph((g) => (g ? { ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, position: { x, y } } : n)) } : g))
      pendentes.current.set(nodeId, { x, y })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const lote = [...pendentes.current.entries()].map(([id, p]) => ({ nodeId: id, ...p }))
        pendentes.current.clear()
        if (lote.length && graph?.viewKey) void api.saveLayout(graph.viewKey, lote).catch(() => undefined)
      }, 600)
    },
    [graph?.viewKey],
  )

  const organizar = useCallback(async () => {
    if (!graph?.viewKey) return
    await api.clearLayout(graph.viewKey)
    await carregar()
  }, [graph?.viewKey, carregar])

  return { graph, loading, error, recarregar: carregar, moveNode, organizar }
}
