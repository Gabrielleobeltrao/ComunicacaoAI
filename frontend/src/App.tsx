import { Suspense, lazy } from 'react'
import type { ReactNode } from 'react'
import { APP_SURFACE_ROUTES } from './components/appSurfaceRegistry'
import { LegacyChannelRedirect } from './pages/redirects'
import { Navigate, Route, Routes } from 'react-router'
import { ProtectedRoute } from './components/ProtectedRoute'
import { featureFlags } from './featureFlags'
import { BuildingProvider } from './contexts/BuildingContext'
import { ArchitectAssistantProvider } from './components/ArchitectAssistant'
import { ArchitectLegacyRedirect, CommunityRedirect, DashboardHome, FloorModuleRedirect, LegacyModuleRedirect } from './pages/redirects'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Widget } from './pages/Widget'

/**
 * As páginas AUTENTICADAS chegam sob demanda; as públicas, no primeiro paint.
 *
 * Tudo num pacote só dava 1,4 MB para quem abre a tela de login — e a maior parte disso é
 * tela que essa pessoa talvez nunca veja. A Central de monitoramento sozinha tem 2 mil linhas.
 *
 * O corte é por AUTENTICAÇÃO, e não por tamanho: `/`, `/login`, `/register` e `/widget` são o
 * primeiro contato, e um `Suspense` neles trocaria a página inicial por um vazio piscando. O
 * resto só existe depois do login, quando já há um pacote carregado e a espera é de uma
 * navegação — não da primeira impressão.
 *
 * `lazy` pede `default`; estas páginas exportam por nome, e é isso que o `.then` resolve.
 */
const sobDemanda = <T extends Record<string, unknown>, K extends keyof T>(carregar: () => Promise<T>, nome: K) =>
  lazy(() => carregar().then((m) => ({ default: m[nome] as React.ComponentType })))

const Apps = sobDemanda(() => import('./pages/Apps'), 'Apps')
const Building = sobDemanda(() => import('./pages/Building'), 'Building')
const ArchitectProjects = sobDemanda(() => import('./pages/architect/Projects'), 'ArchitectProjects')
const ArchitectProject = sobDemanda(() => import('./pages/architect/Project'), 'ArchitectProject')
const DataRecorders = sobDemanda(() => import('./pages/dataHistory/Recorders'), 'DataRecorders')
const RecorderForm = sobDemanda(() => import('./pages/dataHistory/RecorderForm'), 'RecorderForm')
const RecorderDetail = sobDemanda(() => import('./pages/dataHistory/RecorderDetail'), 'RecorderDetail')
const FloorView = sobDemanda(() => import('./pages/FloorView'), 'FloorView')
const Resources = sobDemanda(() => import('./pages/Resources'), 'Resources')
const Databases = sobDemanda(() => import('./pages/Databases'), 'Databases')
const Monitors = sobDemanda(() => import('./pages/Monitors'), 'Monitors')
const MonitoringCenter = sobDemanda(() => import('./pages/MonitoringCenter'), 'MonitoringCenter')
const Activity = sobDemanda(() => import('./pages/Activity'), 'Activity')
const AgentDetail = sobDemanda(() => import('./pages/AgentDetail'), 'AgentDetail')
const Agents = sobDemanda(() => import('./pages/Agents'), 'Agents')
const Dashboard = sobDemanda(() => import('./pages/Dashboard'), 'Dashboard')
const Executions = sobDemanda(() => import('./pages/Executions'), 'Executions')
const Logs = sobDemanda(() => import('./pages/Logs'), 'Logs')
const Memories = lazy(() => import('./pages/Memories'))
const Settings = sobDemanda(() => import('./pages/Settings'), 'Settings')
const SectorDetail = sobDemanda(() => import('./pages/SectorDetail'), 'SectorDetail')
const Setores = sobDemanda(() => import('./pages/Setores'), 'Setores')

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

  /**
   * UM `Suspense` para todas as rotas, e não um por página.
   *
   * O que ele mostra é um vazio de propósito: a troca dura o tempo de baixar um pedaço, e um
   * "carregando" que aparece e some em 80 ms é mais ruído que informação. O que não pode é a
   * página anterior sumir sem nada no lugar — por isso a área mantém a altura da janela.
   */
  const routes = (
    <Suspense fallback={<div style={{ minHeight: '100vh' }} aria-busy="true" data-testid="rota-carregando" />}>
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
          <Route path="/databases" element={<P><Databases /></P>} />
          <Route path="/monitors" element={<P><Monitors /></P>} />
          <Route path="/monitoring" element={<P><MonitoringCenter /></P>} />
          <Route path="/activity" element={<P><Activity /></P>} />
          <Route path="/community" element={<CommunityRedirect />} />
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
      <Route path="/architect/new" element={<ArchitectLegacyRedirect />} />
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
    </Suspense>
  )

  /**
   * O Arquiteto fica ACIMA das rotas — uma instância só, para o app inteiro.
   *
   * Dentro de uma página ele seria remontado a cada navegação, e a conversa (e o rascunho)
   * morreriam junto. É essa a diferença entre um chat global e um chat por tela.
   */
  return v2 ? (
    <BuildingProvider>
      <ArchitectAssistantProvider>{routes}</ArchitectAssistantProvider>
    </BuildingProvider>
  ) : (
    routes
  )
}

export default App
