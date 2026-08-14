import { AppLayout } from '../components/AppLayout'
import { SectorManager } from '../components/SectorManager'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import { useParams } from 'react-router'

export function Setores() {
  const { floorId } = useParams()
  const { agents, agentsLoading, loadAgents, sectors, sectorsLoading, loadSectors } = useAgentsAndWidgets(floorId)

  return (
    <AppLayout current="/setores" title="Setores" subtitle="Agentes que atendem juntos">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 680 }}>
          Um setor é uma equipe de agentes. Ele pode <strong>só organizar</strong> quem fica junto no mapa,
          ter <strong>um gerente que coordena</strong> o time, ou <strong>executar em etapas</strong>, uma
          depois da outra. Para atender no site, vincule o setor a um canal na página “Canais”.
        </p>
        <SectorManager
          sectors={sectors}
          loading={sectorsLoading}
          agents={agents}
          agentsLoading={agentsLoading}
          floorId={floorId}
          onChange={loadSectors}
          onAgentsChanged={loadAgents}
        />
      </div>
    </AppLayout>
  )
}
