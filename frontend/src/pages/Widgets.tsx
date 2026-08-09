import { useState } from 'react'
import { AppLayout } from '../components/AppLayout'
import { WhatsAppManager } from '../components/WhatsAppManager'
import { WidgetManager } from '../components/WidgetManager'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'

type Channel = 'web' | 'whatsapp'

const TABS: { key: Channel; label: string }[] = [
  { key: 'web', label: 'Widget do site' },
  { key: 'whatsapp', label: 'WhatsApp' },
]

// The "Canais" page: the surfaces where an agent or sector acts. Each tab is a
// channel — the embeddable web widget and connected WhatsApp numbers.
export function Widgets() {
  const [tab, setTab] = useState<Channel>('web')
  const { widgets, widgetsLoading, loadWidgets, agents, agentsLoading, sectors } = useAgentsAndWidgets()

  return (
    <AppLayout current="/widgets" title="Canais">
      <div className="space-y-6">
        <p className="max-w-2xl text-sm text-(--text-muted)">
          Onde seus agentes e setores atendem — no site (widget de chat) e no WhatsApp.
        </p>

        <div className="flex gap-1 border-b border-(--border-subtle)">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                tab === t.key
                  ? 'border-white text-(--text-heading)'
                  : 'border-transparent text-(--text-muted) hover:text-(--text-body)'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'web' ? (
          <section className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-6">
            <h2 className="mb-2 font-medium">Widget de chat</h2>
            <p className="mb-4 text-sm text-(--text-muted)">
              Crie um widget, escolha qual agente ou setor vai atendê-lo e cole o script abaixo no site
              do seu cliente.
            </p>
            <WidgetManager
              widgets={widgets}
              loading={widgetsLoading}
              agents={agents}
              agentsLoading={agentsLoading}
              sectors={sectors}
              onChange={loadWidgets}
            />
          </section>
        ) : (
          <WhatsAppManager agents={agents} sectors={sectors} />
        )}
      </div>
    </AppLayout>
  )
}
