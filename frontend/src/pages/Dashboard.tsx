import { Link } from 'react-router'
import { AppLayout } from '../components/AppLayout'

const SECTIONS = [
  {
    to: '/agents',
    title: 'Agentes',
    description: 'Crie e configure os agentes de IA: objetivo, provedor/modelo e base de conhecimento.',
  },
  {
    to: '/widgets',
    title: 'Widgets',
    description: 'Crie widgets de chat, personalize a aparência e vincule cada um a um agente.',
  },
  {
    to: '/chats',
    title: 'Chats',
    description: 'Veja e responda as conversas dos visitantes em tempo real.',
  },
]

export function Dashboard() {
  return (
    <AppLayout current="/dashboard" title="Dashboard">
      <div className="grid gap-6 md:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className="rounded-xl border border-slate-800 bg-slate-900 p-6 transition hover:border-slate-600"
          >
            <h2 className="mb-2 font-medium">{section.title}</h2>
            <p className="text-sm text-slate-400">{section.description}</p>
          </Link>
        ))}
      </div>
    </AppLayout>
  )
}
