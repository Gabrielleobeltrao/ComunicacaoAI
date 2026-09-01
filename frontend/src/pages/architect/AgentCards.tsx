import { Badge } from '../../ui'
import type { ArchitectPreview, Blueprint } from '../../lib/architect'

// A FICHA de um agente — a resposta para "quem é este e o que ele faz".
//
// A lista de itens diz "Agente novo: Marina". Isso não deixa ninguém aprovar nada: não
// diz o que ela entrega, quando é acionada, o que ela NÃO faz, com que ferramenta, nem
// por que ela é um agente separado. Todos esses campos existiam no plano e morriam no
// JSON, dentro de "Avançado".
//
// O que não é declarado aparece como não declarado. Preencher com um padrão bonito
// esconderia justamente o que precisa ser corrigido antes de aplicar.

const PERFIL: Record<string, string> = {
  manager: 'Coordena',
  secretary: 'Organiza e encaminha',
  researcher: 'Busca informação',
  analyst: 'Analisa',
  operator: 'Executa ações',
  communicator: 'Fala com a pessoa',
  monitor: 'Vigia e avisa',
  custom: 'Personalizado',
}

const EXECUTOR: Record<string, string> = {
  llm: 'interpreta e responde (IA)',
  function: 'roda uma função — resultado igual toda vez',
  tool: 'executa uma ação em outro sistema',
}

const ACIONAMENTO: Record<string, string> = {
  mention: 'quando alguém fala com ele',
  scheduled: 'na hora marcada',
  event: 'quando um evento acontece',
  delegated: 'quando o coordenador aciona',
}

const rotulo = { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: 'var(--text-faint)' }
const naoDeclarado = <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>não declarado</span>

function Campo({ label, children, testid }: { label: string; children: React.ReactNode; testid?: string }) {
  return (
    <div className="flex flex-col" data-testid={testid}>
      <span style={rotulo}>{label}</span>
      <span style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

export function AgentFicha({ agentKey, blueprint, preview }: { agentKey: string; blueprint: Blueprint | null | undefined; preview: ArchitectPreview | null }) {
  const agentes = blueprint?.agents ?? []
  const agente = agentes.find((x) => x.key === agentKey)
  if (!agente) return null

  const setores = blueprint?.sectors ?? []
  const nomeDe = (k?: string | null) => agentes.find((a) => a.key === k)?.name ?? k ?? '—'

  const ferramentas = (blueprint?.appRequirements ?? []).filter((r) => (r.agentKeys ?? []).includes(agentKey))
  const bases = (blueprint?.knowledgeRequirements ?? []).filter((k) => k.scope === 'agent' && k.targetKey === agentKey)
  const rotinas = (blueprint?.routines ?? []).filter((r) => r.ownerAgentKey === agentKey)
  const meuSetor = setores.find((s) => (s.memberAgentKeys ?? []).includes(agentKey))
  const coordena = setores.find((s) => s.coordinatorAgentKey === agentKey)
  const porque = (preview?.critique?.mergeSplit ?? []).find((m) => m.agentKey === agentKey)
  const problemas = (preview?.critique?.findings ?? []).filter((f) => f.agentKey === agentKey)
  const alcanca =
    agente.delegationPolicy === 'floor'
      ? 'qualquer agente do andar'
      : agente.delegationPolicy === 'selected'
        ? (agente.callableAgentKeys ?? []).map(nomeDe).join(', ') || 'ninguém ainda'
        : ''

  return (
    <div className="flex flex-col gap-2" style={{ marginTop: 6 }} data-testid={`architect-agent-card-${agentKey}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{PERFIL[agente.preset ?? 'custom'] ?? agente.preset}</Badge>
        {coordena && <Badge tone="brand">coordena {coordena.name}</Badge>}
        {/* Um problema do agente aparece NO agente. Numa lista à parte, ele vira um
            aviso que ninguém liga a ninguém. */}
        {problemas.length > 0 && (
          <Badge tone={problemas.some((p) => p.severity === 'error') ? 'danger' : 'warning'} data-testid={`architect-agent-problems-${agentKey}`}>
            {problemas.length === 1 ? '1 ponto a resolver' : `${problemas.length} pontos a resolver`}
          </Badge>
        )}
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Campo label="Entrega" testid={`architect-agent-objective-${agentKey}`}>{agente.objective || naoDeclarado}</Campo>
        <Campo label="Acionado quando">{agente.role || naoDeclarado}</Campo>
        <Campo label="O que NÃO faz" testid={`architect-agent-limits-${agentKey}`}>{agente.constraints || naoDeclarado}</Campo>
        <Campo label="Como executa" testid={`architect-agent-executor-${agentKey}`}>
          {EXECUTOR[agente.executorKind ?? 'llm']}
          {agente.functionName ? ` (${agente.functionName})` : ''}
        </Campo>
        <Campo label="Recebe → devolve">{agente.inputContract || agente.outputContract ? `${agente.inputContract || '—'} → ${agente.outputContract || '—'}` : naoDeclarado}</Campo>
        <Campo label="Ferramentas" testid={`architect-agent-tools-${agentKey}`}>{ferramentas.length > 0 ? ferramentas.map((f) => f.appKey).join(', ') : 'nenhuma'}</Campo>
        <Campo label="Acionamento" testid={`architect-agent-activation-${agentKey}`}>
          {[
            (agente.activationModes ?? []).map((m) => ACIONAMENTO[m] ?? m).join(', '),
            rotinas.length > 0 && `rotina: ${rotinas.map((r) => r.name).join(', ')}`,
            meuSetor && !coordena && `acionado pelo coordenador de ${meuSetor.name}`,
          ]
            .filter(Boolean)
            .join(' · ') || naoDeclarado}
        </Campo>
        {alcanca && <Campo label="Pode acionar">{alcanca}</Campo>}
        <Campo label="Sai da mão dele" testid={`architect-agent-handoff-${agentKey}`}>
          {agente.handoffEnabled ? 'passa para uma pessoa quando não resolve' : 'não passa para ninguém'}
        </Campo>
        {bases.length > 0 && <Campo label="Precisa saber">{bases.map((b) => `${b.title}${b.state === 'missing' ? ' (pendente)' : ''}`).join(', ')}</Campo>}
      </div>

      {/* Por que ele é um agente SEPARADO, e não parte de outro. É a pergunta que
          decide se a operação tem gente demais. */}
      {(porque || agente.rationale) && (
        <Campo label="Por que separado" testid={`architect-agent-rationale-${agentKey}`}>{porque?.rationale || agente.rationale}</Campo>
      )}

      {agente.layerReason && (
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }} data-testid={`architect-agent-layer-${agentKey}`}>
          Entra no recorte porque {agente.layerReason}
        </span>
      )}

      {problemas.map((p, n) => (
        <p key={`${p.code}-${n}`} style={{ fontSize: 12.5, color: p.severity === 'error' ? 'var(--intent-danger)' : 'var(--text-muted)' }}>
          {p.message} <span style={{ color: 'var(--text-faint)' }}>— {p.fix}</span>
        </p>
      ))}
    </div>
  )
}
