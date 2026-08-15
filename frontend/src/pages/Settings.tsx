import { useCallback, useEffect, useState } from 'react'
import { LOCALE_LABEL, LOCALES, useI18n } from '../i18n'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiKeysPanel, MonthlyCapField } from '../components/ApiKeySettings'
import { AppLayout } from '../components/AppLayout'
import { API_URL } from '../lib/api'
import { signOut, useSession } from '../lib/auth-client'
import type { DashboardStats } from '../lib/types'

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-(--text-muted)">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function formatDate(value?: string | Date | null) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function SummaryCard({ to, label, value }: { to: string; label: string; value: number }) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4 transition hover:border-(--border-strong)"
    >
      <p className="text-2xl font-semibold">{value.toLocaleString('pt-BR')}</p>
      <p className="mt-1 text-sm text-(--text-muted)">{label}</p>
    </Link>
  )
}

function UsageBlock({ stats }: { stats: DashboardStats }) {
  const cap = stats.monthlyTokenCap
  const used = stats.tokensThisMonth
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
  const near = cap > 0 && pct >= 80

  return (
    <div className="space-y-3 rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-(--text-muted)">Tokens gastos no mês</p>
        <p className="text-sm">
          <span className="font-semibold">{used.toLocaleString('pt-BR')}</span>
          {cap > 0 ? (
            <span className="text-(--text-muted)"> / {cap.toLocaleString('pt-BR')}</span>
          ) : (
            <span className="text-(--text-faint)"> · sem teto</span>
          )}
        </p>
      </div>

      {cap > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-(--surface-sunken)">
          <div
            className={`h-full rounded-full transition-all ${near ? 'bg-amber-400' : 'bg-emerald-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <p className="text-xs text-(--text-faint)">
        {stats.tokensThisWeek.toLocaleString('pt-BR')} tokens nesta semana
        {cap > 0 && near && ' · você está perto do teto mensal'}
      </p>
    </div>
  )
}

export function Settings() {
  const { data: session } = useSession()
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [sectorCount, setSectorCount] = useState<number | null>(null)

  const loadStats = useCallback(async () => {
    const [statsRes, teamsRes] = await Promise.all([
      fetch(`${API_URL}/api/stats`, { credentials: 'include' }),
      fetch(`${API_URL}/api/sectors`, { credentials: 'include' }),
    ])
    if (statsRes.ok) setStats(await statsRes.json())
    if (teamsRes.ok) {
      const sectors = await teamsRes.json()
      setSectorCount(Array.isArray(sectors) ? sectors.length : 0)
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const { locale, setLocale, t } = useI18n()
  const memberSince = formatDate(session?.user.createdAt)

  return (
    <AppLayout current="/settings" title="Configurações">
      <div className="max-w-3xl space-y-10">
        <Section title={t('common.language')}>
          <div className="flex flex-wrap gap-2 rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4" data-testid="locale-switcher">
            {LOCALES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLocale(code)}
                aria-pressed={locale === code}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: locale === code ? 'var(--intent-brand)' : 'var(--border-strong)',
                  background: locale === code ? 'var(--surface-sunken)' : 'transparent',
                  fontWeight: locale === code ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {LOCALE_LABEL[code]}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Conta">
          <div className="space-y-3 rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-(--text-faint)">E-mail</p>
              <p className="text-sm">{session?.user.email ?? '—'}</p>
            </div>
            {memberSince && (
              <div className="border-t border-(--border-subtle) pt-3">
                <p className="text-xs uppercase tracking-wide text-(--text-faint)">Membro desde</p>
                <p className="text-sm">{memberSince}</p>
              </div>
            )}
            <div className="border-t border-(--border-subtle) pt-3">
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-lg border border-(--border-strong) px-4 py-2 text-sm transition hover:bg-(--surface-sunken)"
              >
                Sair da conta
              </button>
            </div>
          </div>
        </Section>

        <Section
          title="Uso do mês"
          description="Consumo de tokens dos seus agentes. Ajuste o teto para pausar as respostas automáticas ao atingir o limite."
        >
          {stats ? <UsageBlock stats={stats} /> : <p className="text-sm text-(--text-muted)">Carregando...</p>}
          {stats && <MonthlyCapField initialCap={stats.monthlyTokenCap} onSaved={loadStats} />}
        </Section>

        <Section title="Resumo da conta">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard to="/agents" label="Agentes" value={stats?.agents ?? 0} />
            <SummaryCard to="/setores" label="Setores" value={sectorCount ?? 0} />
            <SummaryCard to="/widgets" label="Widgets" value={stats?.widgets ?? 0} />
          </div>
        </Section>

        <Section title="Logs e auditoria" description="Tudo o que foi executado e tudo o que foi alterado nesta conta, com quem fez e quando.">
          <Link
            to="/settings/logs"
            className="inline-flex items-center gap-2 rounded-xl border border-(--border-subtle) bg-(--surface-card) px-4 py-3 text-sm transition hover:border-(--border-strong)"
            data-testid="settings-logs-link"
          >
            Abrir logs e auditoria
          </Link>
        </Section>

        <Section title="Chaves de API">
          <ApiKeysPanel />
        </Section>

        <Section
          title="Apps e integrações"
          description="Conectar contas externas, ver o que cada App acessa e definir o que cada agente pode usar."
        >
          <Link
            to="/apps"
            className="inline-flex items-center gap-2 rounded-xl border border-(--border-subtle) bg-(--surface-card) px-4 py-3 text-sm transition hover:border-(--border-strong)"
            data-testid="settings-apps-link"
          >
            Abrir Apps
          </Link>
        </Section>
      </div>
    </AppLayout>
  )
}
