import { AppLayout } from '../../components/AppLayout'
import { EmptyState, Tag } from '../../ui'
import type { WsMessageStatus } from '../../lib/websocketApp'

/**
 * O que as quatro páginas do App têm em comum.
 *
 * Elas moram sob o mesmo layout e falam do mesmo assunto — separar o cabeçalho aqui
 * evita quatro cópias que divergem na primeira mudança.
 */

const ABAS = [
  { key: 'overview', label: 'Visão geral', path: '/apps/websocket/overview' },
  { key: 'messages', label: 'Mensagens', path: '/apps/websocket/messages' },
  { key: 'subscriptions', label: 'Assinaturas', path: '/apps/websocket/subscriptions' },
  { key: 'logs', label: 'Logs', path: '/apps/websocket/logs' },
]

export function WsPage({ current, title, subtitle, children }: { current: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <AppLayout current={current} title={title} subtitle={subtitle}>
      {/* As abas repetem a navegação do sidebar de propósito: no celular o sidebar não
          está à vista, e sem elas só dá para trocar de página voltando ao menu. */}
      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }} data-testid="ws-tabs">
        {ABAS.map((aba) => (
          <a
            key={aba.key}
            href={aba.path}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              fontSize: 13,
              textDecoration: 'none',
              background: current === aba.path ? 'var(--intent-brand)' : 'var(--surface-sunken)',
              color: current === aba.path ? '#fff' : 'var(--text-muted)',
            }}
            data-testid={`ws-tab-${aba.key}`}
          >
            {aba.label}
          </a>
        ))}
      </nav>
      {children}
    </AppLayout>
  )
}

export const SemConexao = () => (
  <EmptyState
    icon="radio"
    title="Nenhuma conexão configurada"
    body="Conecte o WebSocket Genérico em Apps e informe o endereço do serviço para começar a receber."
  />
)

/** Verde só para o que virou dado. O resto é informação de descarte, não de erro. */
const COR: Record<WsMessageStatus, string> = {
  accepted: 'var(--intent-brand)',
  filtered: 'var(--text-faint)',
  duplicate: 'var(--text-faint)',
  invalid: 'var(--coral-600, #d92d20)',
  rate_limited: 'var(--mango-600)',
  too_large: 'var(--mango-600)',
}

export const StatusTag = ({ status, label }: { status: WsMessageStatus; label: string }) => <Tag color={COR[status]}>{label}</Tag>

export const quando = (iso: string | null): string => {
  if (!iso) return '—'
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutos < 1) return 'agora há pouco'
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.round(minutos / 60)
  return horas < 24 ? `há ${horas} h` : new Date(iso).toLocaleDateString('pt-BR')
}
