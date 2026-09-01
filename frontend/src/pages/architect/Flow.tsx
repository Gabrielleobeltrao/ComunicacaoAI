import { Badge, Card, Icon } from '../../ui'
import type { Blueprint } from '../../lib/architect'

// COMO A OPERAÇÃO VAI FUNCIONAR — o desenho, e não a lista.
//
// A lista de itens responde "o que vai ser criado". Ela não responde a pergunta que
// decide se a proposta presta: quem aciona quem. Um andar com três agentes soltos e um
// andar com três agentes num setor coordenado produzem listas quase iguais e operações
// completamente diferentes — e a diferença só aparece quando alguém desenha.

const PERFIL: Record<string, string> = {
  manager: 'coordena',
  secretary: 'organiza e encaminha',
  researcher: 'busca informação',
  analyst: 'analisa',
  operator: 'executa ações',
  communicator: 'fala com a pessoa',
  monitor: 'vigia e avisa',
  custom: 'personalizado',
}

const MODO: Record<string, string> = {
  orchestrated: 'o coordenador decide quem responde',
  pipeline: 'as etapas acontecem em ordem fixa',
  organization: 'só agrupa — ninguém coordena',
}

const linha = { fontSize: 12.5, color: 'var(--text-muted)' } as const

export function Flow({ blueprint }: { blueprint: Blueprint | null | undefined }) {
  if (!blueprint) return null
  const agentes = blueprint.agents ?? []
  const setores = blueprint.sectors ?? []
  const rotinas = blueprint.routines ?? []
  const emSetor = new Set(setores.flatMap((s) => s.memberAgentKeys ?? []))
  const nomeDe = (key: string) => agentes.find((a) => a.key === key)?.name ?? key

  const Pessoa = ({ chave, coordenador }: { chave: string; coordenador?: boolean }) => {
    const a = agentes.find((x) => x.key === chave)
    if (!a) return null
    return (
      <div className="flex flex-wrap items-baseline gap-x-2" data-testid={`architect-flow-agent-${chave}`}>
        <Icon name={coordenador ? 'git-branch' : 'user'} size={13} color="var(--text-faint)" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</span>
        {a.preset && <span style={linha}>· {PERFIL[a.preset] ?? a.preset}</span>}
        {coordenador && <Badge tone="brand">coordena</Badge>}
        {a.role && <span style={{ ...linha, width: '100%', paddingLeft: 19 }}>{a.role}</span>}
      </div>
    )
  }

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="architect-flow">
        <div>
          <strong style={{ fontSize: 13 }}>Como vai funcionar</strong>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quem recebe, quem aciona quem, e o que roda sozinho.</p>
        </div>

        {(blueprint.floors ?? []).map((andar) => {
          const doAndar = agentes.filter((a) => a.floorKey === andar.key)
          const setoresDoAndar = setores.filter((s) => (s as { floorKey?: string }).floorKey === andar.key || !(s as { floorKey?: string }).floorKey)
          const soltos = doAndar.filter((a) => !emSetor.has(a.key))
          return (
            <div key={andar.key} className="flex flex-col gap-2" data-testid={`architect-flow-floor-${andar.key}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Icon name="building-2" size={14} color="var(--text-faint)" />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{andar.name}</span>
                <span style={linha}>andar</span>
              </div>

              {setoresDoAndar.map((setor) => (
                <div
                  key={setor.key}
                  className="flex flex-col gap-1.5"
                  style={{ marginLeft: 8, paddingLeft: 12, borderLeft: '2px solid var(--border-subtle)' }}
                  data-testid={`architect-flow-sector-${setor.key}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon name="users" size={13} color="var(--text-faint)" />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{setor.name}</span>
                    <span style={linha}>{MODO[setor.mode] ?? setor.mode}</span>
                  </div>
                  {setor.coordinatorAgentKey && <Pessoa chave={setor.coordinatorAgentKey} coordenador />}
                  {(setor.memberAgentKeys ?? [])
                    .filter((k) => k !== setor.coordinatorAgentKey)
                    .map((k) => (
                      <div key={k} style={{ marginLeft: 12 }}>
                        {/* A seta é a informação: é ela que diz que um aciona o outro. */}
                        <span style={{ ...linha, marginRight: 4 }}>↳ aciona</span>
                        <Pessoa chave={k} />
                      </div>
                    ))}
                </div>
              ))}

              {soltos.length > 0 && (
                <div className="flex flex-col gap-1.5" style={{ marginLeft: 8, paddingLeft: 12, borderLeft: '2px dashed var(--border-subtle)' }}>
                  {/* Fora de setor não é erro — mas é uma escolha, e ela precisa ser vista. */}
                  <span style={linha}>{setores.length > 0 ? 'Fora de setor (acionado à mão):' : 'Agentes:'}</span>
                  {soltos.map((a) => (
                    <Pessoa key={a.key} chave={a.key} />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {rotinas.length > 0 && (
          <div className="flex flex-col gap-1" data-testid="architect-flow-routines">
            <span style={{ ...linha, fontWeight: 600 }}>Roda sozinho</span>
            {rotinas.map((r) => (
              <span key={r.key} style={linha}>
                <Icon name="clock" size={12} color="var(--text-faint)" /> {r.name} — por {nomeDe(r.ownerAgentKey)}
              </span>
            ))}
          </div>
        )}

        {(blueprint.appRequirements ?? []).length + (blueprint.knowledgeRequirements ?? []).length > 0 && (
          <div className="flex flex-col gap-1" data-testid="architect-flow-needs">
            <span style={{ ...linha, fontWeight: 600 }}>Precisa de você</span>
            {(blueprint.appRequirements ?? []).map((a) => (
              <span key={a.key} style={linha}>
                <Icon name="plug" size={12} color="var(--text-faint)" /> conectar {a.appKey}
              </span>
            ))}
            {(blueprint.knowledgeRequirements ?? [])
              .filter((k) => !k.content?.trim())
              .map((k) => (
                <span key={k.key} style={linha}>
                  <Icon name="book-open" size={12} color="var(--text-faint)" /> enviar “{k.title}”
                </span>
              ))}
          </div>
        )}
      </div>
    </Card>
  )
}
