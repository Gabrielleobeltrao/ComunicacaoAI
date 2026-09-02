import type { ReactNode } from 'react'
import { Apps } from './pages/Apps'
import { APP_SURFACE_ROUTES } from './components/appSurfaceRegistry'
import { LegacyChannelRedirect } from './pages/redirects'
import { Navigate, Route, Routes } from 'react-router'
import { ProtectedRoute } from './components/ProtectedRoute'
import { featureFlags } from './featureFlags'
import { BuildingProvider } from './contexts/BuildingContext'
import { DashboardHome, FloorModuleRedirect, LegacyModuleRedirect } from './pages/redirects'
import { Building } from './pages/Building'
import { ArchitectProjects } from './pages/architect/Projects'
import { DataRecorders } from './pages/dataHistory/Recorders'
import { RecorderForm } from './pages/dataHistory/RecorderForm'
import { RecorderDetail } from './pages/dataHistory/RecorderDetail'
import { ArchitectProject } from './pages/architect/Project'
import { FloorView } from './pages/FloorView'
import { Resources } from './pages/Resources'
import { AgentDetail } from './pages/AgentDetail'
import { Agents } from './pages/Agents'
import { Dashboard } from './pages/Dashboard'
import { Executions } from './pages/Executions'
import { Logs } from './pages/Logs'
import Memories from './pages/Memories'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Settings } from './pages/Settings'
import { SectorDetail } from './pages/SectorDetail'
import { Setores } from './pages/Setores'
import { Widget } from './pages/Widget'

// Navigation V2 is gated by aiBuilding: when ON, floor-scoped canonical routes +
// legacy redirects replace the flat routes; when OFF, the original app is byte-
// for-byte unchanged (no BuildingProvider, no redirects).
const P = ({ children }: { children: ReactNode }) => <ProtectedRoute>{children}</ProtectedRoute>

function App() {
  const v2 = featureFlags.aiBuilding

  // App pages come from the compiled registry, so a route only exists when a real
  // component backs it. The page itself still checks the installation.
  const appSurfaceRoutes = APP_SURFACE_ROUTES.map((route) => (
    <Route key={route.path} path={route.path} element={<P>{route.element()}</P>} />
  ))

  const routes = (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/widget/:publicKey" element={<Widget />} />

      {/* Home. In V2 the building overview is merged into the floor home, so
          /dashboard resolves to the active floor (or the building landing when
          there is no floor yet). */}
      <Route path="/dashboard" element={<P>{v2 ? <DashboardHome /> : <Dashboard />}</P>} />

      {v2 ? (
        <>
          {/* Apps are owner-scoped, not floor-scoped: one catalogue for the whole
              account, connected once and granted per agent. /tools keeps working
              and lands on the Personalizados tab, favourites intact. */}
          <Route path="/apps" element={<P><Apps /></P>} />
          <Route path="/tools" element={<Navigate to="/apps?tab=custom" replace />} />
          {appSurfaceRoutes}
          {/* The Central de execuções covers the WHOLE building (it filters by
              floor, it is not scoped to one), so it lives at the top level. */}
          <Route path="/executions" element={<P><Executions /></P>} />
          {/* Logs e auditoria lives under Configurações: it is account-wide. */}
          <Route path="/settings/logs" element={<P><Logs /></P>} />
          {/* A memória é do prédio inteiro, não de um andar: fica ao lado dos logs. */}
          <Route path="/memories" element={<P><Memories /></P>} />
          {/* Canonical floor-scoped routes */}
          <Route path="/resources" element={<P><Resources /></P>} />
          <Route path="/floors/:floorId" element={<P><FloorView /></P>} />
          <Route path="/floors/:floorId/agents" element={<P><Agents /></P>} />
          <Route path="/floors/:floorId/agents/:agentId" element={<P><AgentDetail /></P>} />
          <Route path="/floors/:floorId/agents/:agentId/:section" element={<P><AgentDetail /></P>} />
          <Route path="/floors/:floorId/sectors" element={<P><Setores /></P>} />
          <Route path="/floors/:floorId/sectors/:sectorId" element={<P><SectorDetail /></P>} />
          <Route path="/floors/:floorId/sectors/:sectorId/:section" element={<P><SectorDetail /></P>} />

          {/* Retired automation surfaces → agents on the same floor (Rotinas live
              inside each agent now). Bookmarks keep working. */}
          <Route path="/floors/:floorId/automations" element={<P><FloorModuleRedirect to="agents" /></P>} />
          <Route path="/floors/:floorId/automations/:id" element={<P><FloorModuleRedirect to="agents" /></P>} />
          <Route path="/floors/:floorId/runs" element={<P><FloorModuleRedirect to="agents" /></P>} />

          {/* Legacy → canonical redirects (bookmarks keep working) */}
          {/* A página do prédio: lista os andares e é o ÚNICO lugar que cria um.
              Ela redirecionava para o dashboard, e com isso "Criar andar" virava um
              beco sem saída — uma conta nova, que não tem andar nenhum, não
              conseguia criar o primeiro pela interface. */}
          <Route path="/building" element={<P><Building /></P>} />
          <Route path="/automations" element={<P><LegacyModuleRedirect module="agents" /></P>} />
          <Route path="/automations/:id" element={<P><LegacyModuleRedirect module="agents" /></P>} />
          <Route path="/runs" element={<P><LegacyModuleRedirect module="agents" /></P>} />
          <Route path="/agents" element={<P><LegacyModuleRedirect module="agents" /></P>} />
          <Route path="/agents/:agentId" element={<P><AgentDetail /></P>} />
          <Route path="/agents/:agentId/:section" element={<P><AgentDetail /></P>} />
          <Route path="/setores" element={<P><LegacyModuleRedirect module="sectors" /></P>} />
          <Route path="/setores/:sectorId" element={<P><SectorDetail /></P>} />
          <Route path="/setores/:sectorId/:section" element={<P><SectorDetail /></P>} />
        </>
      ) : (
        <>
          {/* Original flat routes (nav V1). Automation is retired as a surface —
              old links land on agents. */}
          <Route path="/automations" element={<Navigate to="/agents" replace />} />
          <Route path="/automations/:id" element={<Navigate to="/agents" replace />} />
          <Route path="/runs" element={<Navigate to="/agents" replace />} />
          <Route path="/agents" element={<P><Agents /></P>} />
          <Route path="/agents/:agentId" element={<P><AgentDetail /></P>} />
          <Route path="/agents/:agentId/:section" element={<P><AgentDetail /></P>} />
          <Route path="/apps" element={<P><Apps /></P>} />
          <Route path="/tools" element={<Navigate to="/apps?tab=custom" replace />} />
          {appSurfaceRoutes}
          {/* Same canonical addresses with the pivot flag off, so no link dies. */}
          <Route path="/executions" element={<P><Executions /></P>} />
          <Route path="/settings/logs" element={<P><Logs /></P>} />
          <Route path="/memories" element={<P><Memories /></P>} />
          <Route path="/setores" element={<P><Setores /></P>} />
          <Route path="/setores/:sectorId" element={<P><SectorDetail /></P>} />
          <Route path="/setores/:sectorId/:section" element={<P><SectorDetail /></P>} />
        </>
      )}

      {/* Históricos: a camada genérica de registro e agregação. É do PRÉDIO, como o
          Arquiteto — o que ela guarda vem de qualquer fonte da conta, e não de um
          andar. Existe nos dois modos de navegação. */}
      <Route path="/historicos" element={<P><DataRecorders /></P>} />
      <Route path="/historicos/novo" element={<P><RecorderForm /></P>} />
      <Route path="/historicos/:recorderId" element={<P><RecorderDetail /></P>} />

      {/* Montar operação é do PRÉDIO, não de um andar: ela pode criar ou reutilizar
          vários. Por isso mora aqui, ao lado das outras áreas globais, e existe nos
          dois modos de navegação. */}
      <Route path="/architect" element={<P><ArchitectProjects /></P>} />
      <Route path="/architect/new" element={<Navigate to="/architect" replace />} />
      <Route path="/architect/:projectId" element={<P><ArchitectProject /></P>} />

      {/* Global areas (both modes). /widgets and /chats predate the App pages and
          keep working: they land on the canonical App route with the query intact. */}
      <Route path="/widgets" element={<P><LegacyChannelRedirect to="/apps/web-chat/widgets" whatsappTo="/apps/whatsapp/channels" /></P>} />
      <Route path="/chats" element={<P><LegacyChannelRedirect to="/apps/web-chat/conversations" whatsappTo="/apps/whatsapp/conversations" /></P>} />
      <Route path="/settings" element={<P><Settings /></P>} />
      <Route path="/whatsapp" element={<Navigate to="/widgets" replace />} />
      <Route path="/teams" element={<Navigate to="/setores" replace />} />
      <Route path="/teams/*" element={<Navigate to="/setores" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )

  return v2 ? <BuildingProvider>{routes}</BuildingProvider> : routes
}

export default App
