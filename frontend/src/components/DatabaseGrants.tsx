import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card } from '../ui'
import { API_URL } from '../lib/api'
import * as api from '../lib/databases'
import type { DatabaseGrant } from '../lib/databases'

// QUEM PODE CONSULTAR ESTE DATABASE.
//
// O ponto desta tela é o IMPACTO antes de salvar. Um grant para um setor não vale para
// "o setor": vale para cada agente que está nele agora e para quem entrar depois. Quem
// concede precisa ver os nomes antes de confirmar — senão a decisão é tomada sobre uma
// palavra ("Análise") e descoberta sobre pessoas.
//
// `deny` aparece como escolha explícita porque ele VENCE qualquer allow. Uma exceção que
// não pode ser dita é uma exceção que vira remoção de acesso legítimo.

const CAPACIDADES = [
  { key: 'discover', label: 'Ver que existe' },
  { key: 'query', label: 'Consultar' },
  { key: 'insert', label: 'Acrescentar' },
  { key: 'update', label: 'Alterar' },
  { key: 'delete', label: 'Apagar' },
]

const SUBJECT_LABEL: Record<string, string> = { building: 'Prédio', floor: 'Andar', sector: 'Setor', agent: 'Agente' }

interface Sujeito {
  subjectType: 'sector' | 'agent'
  subjectId: string
  name: string
}

export function DatabaseGrants({ databaseId }: { databaseId: string }) {
  const [grants, setGrants] = useState<DatabaseGrant[] | null>(null)
  const [sujeitos, setSujeitos] = useState<Sujeito[]>([])
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [impacto, setImpacto] = useState<{ accessibleBy: { agentId: string; name: string; origin: string }[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [novo, setNovo] = useState<{ subject: string; capabilities: string[]; effect: 'allow' | 'deny' } | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const [g, i] = await Promise.all([api.listDatabaseGrants(databaseId), api.getDatabaseImpact(databaseId).catch(() => null)])
      setGrants(g.items)
      setImpacto(i)
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [databaseId])

  useEffect(() => {
    void carregar()
  }, [carregar])

  useEffect(() => {
    let vivo = true
    Promise.all([
      fetch(`${API_URL}/api/agents`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_URL}/api/sectors`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
    ]).then(([agentes, setores]: [{ _id: string; name: string }[], { _id: string; name: string }[]]) => {
      if (!vivo) return
      const lista: Sujeito[] = [
        ...setores.map((s) => ({ subjectType: 'sector' as const, subjectId: s._id, name: s.name })),
        ...agentes.map((a) => ({ subjectType: 'agent' as const, subjectId: a._id, name: a.name })),
      ]
      setSujeitos(lista)
      setNomes(Object.fromEntries(lista.map((s) => [s.subjectId, s.name])))
    })
    return () => {
      vivo = false
    }
  }, [])

  const salvar = async () => {
    if (!novo?.subject) return
    const [subjectType, subjectId] = novo.subject.split(':')
    setErro(null)
    try {
      await api.putDatabaseGrant(databaseId, { subjectType, subjectId, capabilities: novo.capabilities, effect: novo.effect })
      setNovo(null)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  const remover = async (grantId: string) => {
    setErro(null)
    try {
      await api.deleteDatabaseGrant(databaseId, grantId)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  const escolhido = novo?.subject ? sujeitos.find((s) => `${s.subjectType}:${s.subjectId}` === novo.subject) : null

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="database-grants">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 13 }}>Quem pode usar</strong>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Conceder a um setor vale para quem está nele agora e para quem entrar depois.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setNovo(novo ? null : { subject: '', capabilities: ['discover', 'query'], effect: 'allow' })} data-testid="grant-new">
            {novo ? 'Cancelar' : 'Conceder acesso'}
          </Button>
        </div>

        {erro && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger)' }} data-testid="grants-error">
            {erro}
          </p>
        )}

        {novo && (
          <div className="flex flex-col gap-2" style={{ padding: 10, borderRadius: 10, background: 'var(--surface-sunken)' }} data-testid="grant-form">
            <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Para quem
              <select
                value={novo.subject}
                onChange={(e) => setNovo({ ...novo, subject: e.target.value })}
                data-testid="grant-subject"
                style={{ minHeight: 40, padding: '0 10px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', fontSize: 13 }}
              >
                <option value="">Escolha…</option>
                {sujeitos.map((s) => (
                  <option key={`${s.subjectType}:${s.subjectId}`} value={`${s.subjectType}:${s.subjectId}`}>
                    {SUBJECT_LABEL[s.subjectType]}: {s.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-2">
              {CAPACIDADES.map((c) => (
                <label key={c.key} className="flex items-center gap-1" style={{ fontSize: 12.5, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={novo.capabilities.includes(c.key)}
                    onChange={() =>
                      setNovo({
                        ...novo,
                        capabilities: novo.capabilities.includes(c.key) ? novo.capabilities.filter((x) => x !== c.key) : [...novo.capabilities, c.key],
                      })
                    }
                    data-testid={`grant-cap-${c.key}`}
                    style={{ width: 16, height: 16 }}
                  />
                  {c.label}
                </label>
              ))}
            </div>

            <label className="flex items-center gap-2" style={{ fontSize: 12.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={novo.effect === 'deny'}
                onChange={() => setNovo({ ...novo, effect: novo.effect === 'deny' ? 'allow' : 'deny' })}
                data-testid="grant-deny"
                style={{ width: 16, height: 16 }}
              />
              Negar em vez de conceder (uma negação vence qualquer permissão herdada)
            </label>

            {/* O IMPACTO antes de salvar: um setor é gente, e a tela mostra quem. */}
            {escolhido?.subjectType === 'sector' && (
              <p style={{ fontSize: 12.5, color: 'var(--intent-warning)' }} data-testid="grant-impact">
                Este acesso vale para todos os agentes do setor “{escolhido.name}” — inclusive os que entrarem depois.
              </p>
            )}

            <div>
              <Button onClick={salvar} disabled={!novo.subject || novo.capabilities.length === 0} data-testid="grant-save">
                Salvar
              </Button>
            </div>
          </div>
        )}

        {grants && grants.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="grants-empty">
            Ninguém tem acesso ainda. Sem grant, nenhum agente consulta este database.
          </p>
        )}

        {grants?.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-2" data-testid={`grant-${g.id}`}>
            <Badge tone={g.effect === 'deny' ? 'danger' : 'success'}>{g.effect === 'deny' ? 'Negado' : 'Permitido'}</Badge>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {SUBJECT_LABEL[g.subjectType]}: {nomes[g.subjectId] ?? g.subjectId}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>{g.capabilities.join(' · ')}</span>
            <Button variant="secondary" onClick={() => remover(g.id)} data-testid={`grant-remove-${g.id}`}>
              Remover
            </Button>
          </div>
        ))}

        {/* Quem PODE consultar de verdade, depois de toda a precedência. */}
        {impacto && impacto.accessibleBy.length > 0 && (
          <div className="flex flex-col gap-1" data-testid="grants-effective">
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
              Consegue consultar hoje
            </span>
            {impacto.accessibleBy.map((a) => (
              <span key={a.agentId} style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {a.name} <span style={{ color: 'var(--text-faint)' }}>({a.origin === 'direct' ? 'direto' : a.origin === 'sector' ? 'pelo setor' : a.origin === 'floor' ? 'pelo andar' : 'pelo prédio'})</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
