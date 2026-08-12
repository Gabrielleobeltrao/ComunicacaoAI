import { Navigate, Route, Routes } from 'react-router'
import { ProtectedRoute } from './components/ProtectedRoute'
import { featureFlags } from './featureFlags'
import { Building } from './pages/Building'
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

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/widget/:publicKey" element={<Widget />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      {featureFlags.aiBuilding && (
        <>
          <Route
            path="/building"
            element={
              <ProtectedRoute>
                <Building />
              </ProtectedRoute>
            }
          />
          <Route
            path="/floors/:floorId"
            element={
              <ProtectedRoute>
                <FloorView />
              </ProtectedRoute>
            }
          />
        </>
      )}
      {featureFlags.aiAutomations && (
        <>
          <Route
            path="/automations"
            element={
              <ProtectedRoute>
                <Automations />
              </ProtectedRoute>
            }
          />
          <Route
            path="/automations/:id"
            element={
              <ProtectedRoute>
                <AutomationEditor />
              </ProtectedRoute>
            }
          />
          <Route
            path="/runs"
            element={
              <ProtectedRoute>
                <Runs />
              </ProtectedRoute>
            }
          />
        </>
      )}
      <Route
        path="/agents"
        element={
          <ProtectedRoute>
            <Agents />
          </ProtectedRoute>
        }
      />
      <Route
        path="/agents/:agentId"
        element={
          <ProtectedRoute>
            <AgentDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/agents/:agentId/:section"
        element={
          <ProtectedRoute>
            <AgentDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/setores"
        element={
          <ProtectedRoute>
            <Setores />
          </ProtectedRoute>
        }
      />
      <Route
        path="/setores/:sectorId"
        element={
          <ProtectedRoute>
            <SectorDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/setores/:sectorId/:section"
        element={
          <ProtectedRoute>
            <SectorDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/widgets"
        element={
          <ProtectedRoute>
            <Widgets />
          </ProtectedRoute>
        }
      />
      <Route
        path="/chats"
        element={
          <ProtectedRoute>
            <Chats />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      {/* WhatsApp lives inside the Canais page now; keep the old link working. */}
      <Route path="/whatsapp" element={<Navigate to="/widgets" replace />} />
      {/* Equipes was renamed to Setores; keep old bookmarks working. */}
      <Route path="/teams" element={<Navigate to="/setores" replace />} />
      <Route path="/teams/*" element={<Navigate to="/setores" replace />} />
      {/* Any unknown path falls back instead of rendering a blank screen. */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
