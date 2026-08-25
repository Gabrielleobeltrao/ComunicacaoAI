import { useEffect, useState } from 'react'
import { activePolicy, describeRules, savePolicy } from '../lib/tradingPolicies'
import type { PolicyRules } from '../lib/tradingPolicies'
import { Button, Card, Field, Icon, Input } from '../ui'

/**
 * SEGURANÇA de uma conexão que opera: o que nunca deve acontecer.
 *
 * Quatro perguntas na frente, o resto recolhido. A escolha não é de espaço — é de
 * atenção: um formulário com doze limites é um formulário que ninguém preenche, e uma
 * política vazia é a única que não protege nada.
 *
 * Nada aqui é conferido aqui. O servidor reavalia tudo imediatamente antes de a ordem
 * sair, porque é o único lugar que não dá para contornar.
 */

const numero = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const paraNumero = (v: string): number | null => {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

export function TradingPolicyPanel({ installationId, agentId = null }: { installationId: string; agentId?: string | null }) {
  const [rules, setRules] = useState<PolicyRules>({})
  const [version, setVersion] = useState<number | null>(null)
  const [avancado, setAvancado] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)

  useEffect(() => {
    let vivo = true
    activePolicy(installationId, agentId)
      .then((p) => {
        if (!vivo) return
        setRules(p?.rules ?? {})
        setVersion(p?.version ?? null)
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [installationId, agentId])

  const set = (patch: Partial<PolicyRules>) => {
    setRules((prev) => ({ ...prev, ...patch }))
    setSalvo(false)
  }

  const salvar = async () => {
    setSalvando(true)
    setErro(null)
    try {
      const p = await savePolicy(installationId, agentId, rules)
      setVersion(p.version)
      setSalvo(true)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const resumo = describeRules(rules)

  return (
    <Card padding="12px 14px" style={{ display: 'grid', gap: 10 }} data-testid="policy-panel">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
        data-testid="policy-toggle"
        aria-expanded={aberto}
      >
        <Icon name={aberto ? 'chevron-up' : 'chevron-down'} size={14} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-heading)' }}>Segurança</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
          {resumo.length ? `${resumo.length} limite(s)` : 'sem limites configurados'}
          {version ? ` · versão ${version}` : ''}
        </span>
      </button>

      {!aberto && resumo.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="policy-summary">
          {resumo.map((linha) => (
            <li key={linha}>{linha}</li>
          ))}
        </ul>
      ) : null}

      {aberto ? (
        <div style={{ display: 'grid', gap: 10 }} data-testid="policy-form">
          <Field label="Valor máximo por operação" hint="Vazio = sem limite.">
            <Input
              value={numero(rules.maxOrderValue)}
              onChange={(e) => set({ maxOrderValue: paraNumero(e.target.value) })}
              placeholder="1000"
              data-testid="policy-max-value"
            />
          </Field>
          <Field label="Quantidade máxima por operação">
            <Input value={numero(rules.maxQuantity)} onChange={(e) => set({ maxQuantity: paraNumero(e.target.value) })} placeholder="100" data-testid="policy-max-qty" />
          </Field>
          <Field label="Operações por dia">
            <Input
              value={numero(rules.maxOrdersPerDay)}
              onChange={(e) => set({ maxOrdersPerDay: paraNumero(e.target.value) })}
              placeholder="10"
              data-testid="policy-max-orders"
            />
          </Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'start', fontSize: 13 }}>
            <input type="checkbox" checked={rules.requireStopLoss === true} onChange={(e) => set({ requireStopLoss: e.target.checked })} data-testid="policy-require-stop" />
            <span>
              Exigir stop-loss em toda ordem
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>Uma ordem sem stop é uma perda sem fundo.</span>
            </span>
          </label>

          <button
            type="button"
            onClick={() => setAvancado((v) => !v)}
            style={{ justifySelf: 'start', background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            data-testid="policy-advanced-toggle"
          >
            <Icon name={avancado ? 'chevron-up' : 'chevron-down'} size={13} />
            Avançado
          </button>

          {avancado ? (
            <div style={{ display: 'grid', gap: 10, paddingLeft: 10, borderLeft: '2px solid var(--border-subtle)' }} data-testid="policy-advanced">
              <Field label="Percentual máximo da carteira (%)">
                <Input
                  value={numero(rules.maxPortfolioPercent)}
                  onChange={(e) => set({ maxPortfolioPercent: paraNumero(e.target.value) })}
                  placeholder="10"
                  data-testid="policy-max-percent"
                />
              </Field>
              <Field label="Perda máxima no dia" hint="Atingida, nenhuma ordem nova sai.">
                <Input value={numero(rules.maxDailyLoss)} onChange={(e) => set({ maxDailyLoss: paraNumero(e.target.value) })} placeholder="500" data-testid="policy-max-loss" />
              </Field>
              <Field label="Ativos permitidos" hint="Separados por vírgula. Vazio aceita qualquer ativo.">
                <Input
                  value={(rules.symbolAllowlist ?? []).join(', ')}
                  onChange={(e) =>
                    set({
                      symbolAllowlist: e.target.value
                        .split(',')
                        .map((s) => s.trim().toUpperCase())
                        .filter(Boolean),
                    })
                  }
                  placeholder="AAPL, MSFT"
                  data-testid="policy-allowlist"
                />
              </Field>
              {(
                [
                  ['requireTakeProfit', 'Exigir take-profit em toda ordem'],
                  ['blockDuplicatePosition', 'Não abrir posição em ativo que já tem posição'],
                  ['blockShort', 'Não vender o que não tem (bloquear short)'],
                  ['blockOptions', 'Não operar opções'],
                ] as const
              ).map(([campo, texto]) => (
                <label key={campo} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={rules[campo] === true} onChange={(e) => set({ [campo]: e.target.checked })} data-testid={`policy-${campo}`} />
                  <span>{texto}</span>
                </label>
              ))}

              <Field label="Janela de negociação" hint="Fora dela, nenhuma ordem sai. O fuso é obrigatório.">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 6 }}>
                  <Input
                    value={rules.tradingHours?.start ?? ''}
                    onChange={(e) =>
                      set({ tradingHours: { timezone: rules.tradingHours?.timezone ?? 'America/Sao_Paulo', start: e.target.value, end: rules.tradingHours?.end ?? '' } })
                    }
                    placeholder="10:00"
                    data-testid="policy-hours-start"
                  />
                  <Input
                    value={rules.tradingHours?.end ?? ''}
                    onChange={(e) =>
                      set({ tradingHours: { timezone: rules.tradingHours?.timezone ?? 'America/Sao_Paulo', start: rules.tradingHours?.start ?? '', end: e.target.value } })
                    }
                    placeholder="17:00"
                    data-testid="policy-hours-end"
                  />
                  <Input
                    value={rules.tradingHours?.timezone ?? ''}
                    onChange={(e) => set({ tradingHours: { start: rules.tradingHours?.start ?? '', end: rules.tradingHours?.end ?? '', timezone: e.target.value } })}
                    placeholder="America/Sao_Paulo"
                    data-testid="policy-hours-tz"
                  />
                </div>
              </Field>
              <button
                type="button"
                onClick={() => set({ tradingHours: null })}
                style={{ justifySelf: 'start', background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}
                data-testid="policy-hours-clear"
              >
                Sem janela de horário
              </button>
            </div>
          ) : null}

          {erro ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--coral-600, #d92d20)' }}>{erro}</p> : null}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button size="sm" onClick={() => void salvar()} disabled={salvando} data-testid="policy-save">
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
            {/* Salvar cria uma versão nova; a anterior fica no histórico. */}
            {salvo ? <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Salvo como versão {version}.</span> : null}
          </div>
        </div>
      ) : null}
    </Card>
  )
}
