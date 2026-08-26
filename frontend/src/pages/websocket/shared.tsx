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
  { key: 'live', label: 'Dado ao vivo', path: '/apps/websocket/live' },
  { key: 'logs', label: 'Logs', path: '/apps/websocket/logs' },
]

/**
 * Grade que vira UMA coluna no celular.
 *
 * As grades desta tela eram `1fr 1fr` fixo: em 320 px, dois campos de endereço lado a
 * lado ficam com 140 px cada, e o conteúdo é cortado. `auto-fit` com largura mínima
 * resolve sem media query e sem JavaScript — a coluna quebra quando não cabe.
 */
export const GRADE: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }

/** A mesma ideia para as linhas com botão no fim (filtro, cabeçalho, mapeamento). */
export const LINHA: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-end' }

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
  // Descarte esperado é cinza; o que exige ação é vermelho. "Sem assinatura" fica no
  // meio: não é erro, mas é quase sempre configuração faltando.
  filtered: 'var(--text-faint)',
  duplicate: 'var(--text-faint)',
  ignored: 'var(--mango-600)',
  invalid: 'var(--coral-600, #d92d20)',
  failed: 'var(--coral-600, #d92d20)',
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

/**
 * Há quanto tempo, em palavras curtas.
 *
 * "Conectado" sozinho não distingue uma conexão estável de uma que reconectou agora
 * mesmo — e é essa a diferença que interessa a quem está olhando por que o dado sumiu.
 */
export function duracao(desde: string): string {
  const ms = Date.now() - new Date(desde).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'há pouco'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'há menos de um minuto'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`
}
