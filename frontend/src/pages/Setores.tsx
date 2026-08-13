import { AppLayout } from '../components/AppLayout'
import { SectorManager } from '../components/SectorManager'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import { useParams } from 'react-router'

export function Setores() {
  const { floorId } = useParams()
  const { agents, agentsLoading, sectors, sectorsLoading, loadSectors } = useAgentsAndWidgets(floorId)

  return (
    <AppLayout current="/setores" title="Setores" subtitle="Agentes que atendem juntos">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 680 }}>
          Junte vários agentes especialistas num setor. No modo <strong>adaptativo</strong>, um
          orquestrador consulta os que fazem sentido em cada mensagem. No modo <strong>fluxo</strong>, o
          atendimento passa por etapas em sequência. Nos dois casos, o visitante conversa com um assistente
          único. Vincule o setor a um canal na página "Canais".
        </p>
        <SectorManager
          sectors={sectors}
          loading={sectorsLoading}
          agents={agents}
          agentsLoading={agentsLoading}
          floorId={floorId}
          onChange={loadSectors}
        />
      </div>
    </AppLayout>
  )
}
