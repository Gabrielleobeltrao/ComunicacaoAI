import { useCallback, useEffect, useState } from 'react'
import { API_URL } from './api'
import type { AgentSummary, SectorSummary, WidgetSummary } from './types'

export function useAgentsAndWidgets() {
  const [widgets, setWidgets] = useState<WidgetSummary[]>([])
  const [widgetsLoading, setWidgetsLoading] = useState(true)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [sectors, setSectors] = useState<SectorSummary[]>([])
  const [sectorsLoading, setSectorsLoading] = useState(true)

  const loadWidgets = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/widgets`, { credentials: 'include' })
    if (res.ok) setWidgets(await res.json())
    setWidgetsLoading(false)
  }, [])

  const loadAgents = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/agents`, { credentials: 'include' })
    if (res.ok) setAgents(await res.json())
    setAgentsLoading(false)
  }, [])

  const loadSectors = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/sectors`, { credentials: 'include' })
    if (res.ok) setSectors(await res.json())
    setSectorsLoading(false)
  }, [])

  useEffect(() => {
    loadWidgets()
    loadAgents()
    loadSectors()
  }, [loadWidgets, loadAgents, loadSectors])

  return {
    widgets,
    widgetsLoading,
    loadWidgets,
    agents,
    agentsLoading,
    loadAgents,
    sectors,
    sectorsLoading,
    loadSectors,
  }
}
