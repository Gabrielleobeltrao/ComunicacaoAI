import { useState } from 'react'
import { AppLayout } from '../components/AppLayout'
import { SectorManager } from '../components/SectorManager'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import { useParams } from 'react-router'
import { Button } from '../ui'

export function Setores() {
  const { floorId } = useParams()
  const { agents, agentsLoading, loadAgents, sectors, sectorsLoading, loadSectors } = useAgentsAndWidgets(floorId)
  const [creating, setCreating] = useState(false)

  return (
    <AppLayout
      current="/setores"
      title="Setores"
      subtitle="Agentes que atendem juntos"
      // A ação principal da página fica na linha do título, não solta acima da lista.
      actions={
        <Button icon="plus" disabled={agentsLoading} onClick={() => setCreating(true)}>
          Nova equipe
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SectorManager
          sectors={sectors}
          loading={sectorsLoading}
          agents={agents}
          agentsLoading={agentsLoading}
          floorId={floorId}
          onChange={loadSectors}
          onAgentsChanged={loadAgents}
          creating={creating}
          onCreatingChange={setCreating}
        />
      </div>
    </AppLayout>
  )
}
