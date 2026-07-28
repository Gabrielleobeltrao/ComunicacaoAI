import { AppLayout } from '../components/AppLayout'
import { WidgetManager } from '../components/WidgetManager'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'

export function Widgets() {
  const { widgets, widgetsLoading, loadWidgets, agents, agentsLoading, teams } = useAgentsAndWidgets()

  return (
    <AppLayout current="/widgets" title="Widgets">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-2 font-medium">Widget de chat</h2>
        <p className="mb-4 text-sm text-slate-400">
          Crie um widget, escolha qual agente ou equipe vai atendê-lo e cole o script abaixo no site do
          seu cliente.
        </p>
        <WidgetManager
          widgets={widgets}
          loading={widgetsLoading}
          agents={agents}
          agentsLoading={agentsLoading}
          teams={teams}
          onChange={loadWidgets}
        />
      </section>
    </AppLayout>
  )
}
