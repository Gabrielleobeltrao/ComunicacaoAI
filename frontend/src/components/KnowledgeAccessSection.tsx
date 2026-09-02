import { useEffect, useState } from 'react'
import { Badge, Card } from '../ui'
import * as api from '../lib/knowledge'
import type { KnowledgeAccess, SectorAccessMode } from '../lib/knowledge'
import { API_URL } from '../lib/api'
import type { SectorSummary } from '../lib/types'

/** Os setores da conta, para o modo "escolhidos". A recusa vira lista vazia. */
const listSectors = (): Promise<SectorSummary[]> =>
  fetch(`${API_URL}/api/sectors`, { credentials: 'include' }).then((r) => (r.ok ? (r.json() as Promise<SectorSummary[]>) : []))

// "ACESSO AO CONHECIMENTO" — o que este agente pode ler, em português.
//
// A política existia na API e não tinha por onde ser usada: quem quisesse ligar a base
// do andar para um agente precisaria chamar a API à mão. Aqui ela vira uma decisão de
// tela, com o efeito dito na hora — e com a diferença entre "o dono escolheu isto" e "é
// o padrão do sistema" visível, porque dizer "configurado" sobre um default faria a
// pessoa acreditar que escolheu o que nunca escolheu.

const MODOS: { value: SectorAccessMode; label: string; hint: string }[] = [
  { value: 'execution_context', label: 'Só quando responde pelo setor', hint: 'o comportamento padrão: a base do setor entra quando a conversa começou nele' },
  { value: 'home_sector', label: 'Os setores de que ele participa', hint: 'a associação real dele, sempre' },
  { value: 'selected', label: 'Setores escolhidos', hint: 'só os que você marcar aqui' },
  { value: 'none', label: 'Nenhum setor', hint: 'ele lê apenas o que estiver marcado acima' },
]

export function KnowledgeAccessSection({ agentId }: { agentId: string }) {
  const [politica, setPolitica] = useState<KnowledgeAccess | null>(null)
  const [setores, setSetores] = useState<SectorSummary[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true
    Promise.all([api.getKnowledgeAccess(agentId), listSectors().catch(() => [] as SectorSummary[])])
      .then(([p, s]) => {
        if (!vivo) return
        setPolitica(p)
        setSetores(s)
      })
      .catch((e) => vivo && setErro((e as Error).message))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [agentId])

  if (carregando) return null
  if (!politica) return null

  const salvar = async (proxima: KnowledgeAccess) => {
    setSalvando(true)
    setErro(null)
    try {
      setPolitica(
        await api.setKnowledgeAccess(agentId, {
          own: proxima.own,
          building: proxima.building,
          floor: proxima.floor,
          sectorMode: proxima.sectorMode,
          selectedSectorIds: proxima.selectedSectorIds,
        }),
      )
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const alternar = (campo: 'own' | 'building' | 'floor') => salvar({ ...politica, [campo]: !politica[campo] })

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="knowledge-access">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>Acesso ao conhecimento</strong>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>O que este agente pode ler quando alguém pergunta alguma coisa a ele.</p>
          </div>
          {!politica.configured && (
            <Badge tone="warning" data-testid="knowledge-access-default">
              usando o padrão
            </Badge>
          )}
        </div>

        {(
          [
            ['own', 'A base dele', 'os documentos que pertencem a este agente'],
            ['floor', 'A base do andar', 'o que vale para todo mundo que trabalha neste andar'],
            ['building', 'A base do prédio', 'o que vale para a empresa inteira'],
          ] as const
        ).map(([campo, titulo, explicacao]) => (
          <label key={campo} className="flex items-start gap-2" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={politica[campo]}
              disabled={salvando}
              onChange={() => alternar(campo)}
              data-testid={`knowledge-access-${campo}`}
              style={{ marginTop: 3, width: 18, height: 18 }}
            />
            <span>
              <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{titulo}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{explicacao}</span>
            </span>
          </label>
        ))}

        <div className="flex flex-col gap-1">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Conhecimento de setor</span>
          {MODOS.map((m) => (
            <label key={m.value} className="flex items-start gap-2" style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name={`sector-mode-${agentId}`}
                checked={politica.sectorMode === m.value}
                disabled={salvando}
                onChange={() => salvar({ ...politica, sectorMode: m.value, selectedSectorIds: m.value === 'selected' ? politica.selectedSectorIds : [] })}
                data-testid={`knowledge-access-mode-${m.value}`}
                style={{ marginTop: 3, width: 18, height: 18 }}
              />
              <span>
                <span style={{ fontSize: 13, display: 'block' }}>{m.label}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{m.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {politica.sectorMode === 'selected' && (
          <div className="flex flex-col gap-1" data-testid="knowledge-access-sectors">
            {setores.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>Nenhum setor nesta conta ainda.</span>}
            {setores.map((s) => {
              const marcado = politica.selectedSectorIds.includes(s._id)
              return (
                <label key={s._id} className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={marcado}
                    disabled={salvando}
                    onChange={() =>
                      salvar({
                        ...politica,
                        selectedSectorIds: marcado ? politica.selectedSectorIds.filter((id) => id !== s._id) : [...politica.selectedSectorIds, s._id],
                      })
                    }
                    style={{ width: 18, height: 18 }}
                  />
                  {s.name}
                </label>
              )
            })}
          </div>
        )}

        {erro && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger)' }} data-testid="knowledge-access-error">
            {erro}
          </p>
        )}
      </div>
    </Card>
  )
}

/** Só para a tela poder oferecer a lista sem duplicar tipos. */
export type { KnowledgeAccess }
