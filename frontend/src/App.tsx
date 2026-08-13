import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { ProtectedRoute } from './components/ProtectedRoute'
import { featureFlags } from './featureFlags'
import { BuildingProvider } from './contexts/BuildingContext'
import { AutomationDetailRedirect, BuildingToDashboard, DashboardHome, LegacyModuleRedirect } from './pages/redirects'
import { FloorView } from './pages/FloorView'
import { Automations } from './pages/Automations'
import { AutomationEditor } from './pages/AutomationEditor'
import { Runs } from './pages/Runs'
import { AgentDetail } from './pages/AgentDetail'
import { Agents } from './pages/Agents'
import { Chats } from './pages/Chats'
import { Dashboard } from './pages/Dashboard'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Settings } from './pages/Settings'
import { SectorDetail } from './pages/SectorDetail'
import { Setores } from './pages/Setores'
import { Widget } from './pages/Widget'
import { Widgets } from './pages/Widgets'

// Navigation V2 is gated by aiBuilding: when ON, floor-scoped canonical routes +
// legacy redirects replace the flat routes; when OFF, the original app is byte-
// for-byte unchanged (no BuildingProvider, no redirects).
const P = ({ children }: { children: ReactNode }) => <ProtectedRoute>{children}</ProtectedRoute>

function App() {
  const v2 = featureFlags.aiBuilding

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
          {/* Canonical floor-scoped routes */}
          <Route path="/floors/:floorId" element={<P><FloorView /></P>} />
          <Route path="/floors/:floorId/automations" element={<P><Automations /></P>} />
          <Route path="/floors/:floorId/automations/:id" element={<P><AutomationEditor /></P>} />
          <Route path="/floors/:floorId/agents" element={<P><Agents /></P>} />
          <Route path="/floors/:floorId/agents/:agentId" element={<P><AgentDetail /></P>} />
          <Route path="/floors/:floorId/agents/:agentId/:section" element={<P><AgentDetail /></P>} />
          <Route path="/floors/:floorId/sectors" element={<P><Setores /></P>} />
          <Route path="/floors/:floorId/sectors/:sectorId" element={<P><SectorDetail /></P>} />
          <Route path="/floors/:floorId/sectors/:sectorId/:section" element={<P><SectorDetail /></P>} />
          <Route path="/floors/:floorId/runs" element={<P><Runs /></P>} />

          {/* Legacy → canonical redirects (bookmarks keep working) */}
          <Route path="/building" element={<BuildingToDashboard />} />
          <Route path="/automations" element={<P><LegacyModuleRedirect module="automations" /></P>} />
          <Route path="/automations/:id" element={<P><AutomationDetailRedirect /></P>} />
          <Route path="/runs" element={<P><LegacyModuleRedirect module="runs" /></P>} />
          <Route path="/agents" element={<P><LegacyModuleRedirect module="agents" /></P>} />
          <Route path="/agents/:agentId" element={<P><AgentDetail /></P>} />
          <Route path="/agents/:agentId/:section" element={<P><AgentDetail /></P>} />
          <Route path="/setores" element={<P><LegacyModuleRedirect module="sectors" /></P>} />
          <Route path="/setores/:sectorId" element={<P><SectorDetail /></P>} />
          <Route path="/setores/:sectorId/:section" element={<P><SectorDetail /></P>} />
        </>
      ) : (
        <>
          {/* Original flat routes (nav V1) */}
          {featureFlags.aiAutomations && (
            <>
              <Route path="/automations" element={<P><Automations /></P>} />
              <Route path="/automations/:id" element={<P><AutomationEditor /></P>} />
              <Route path="/runs" element={<P><Runs /></P>} />
            </>
          )}
          <Route path="/agents" element={<P><Agents /></P>} />
          <Route path="/agents/:agentId" element={<P><AgentDetail /></P>} />
          <Route path="/agents/:agentId/:section" element={<P><AgentDetail /></P>} />
          <Route path="/setores" element={<P><Setores /></P>} />
          <Route path="/setores/:sectorId" element={<P><SectorDetail /></P>} />
          <Route path="/setores/:sectorId/:section" element={<P><SectorDetail /></P>} />
        </>
      )}

      {/* Global areas (both modes) */}
      <Route path="/widgets" element={<P><Widgets /></P>} />
      <Route path="/chats" element={<P><Chats /></P>} />
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
