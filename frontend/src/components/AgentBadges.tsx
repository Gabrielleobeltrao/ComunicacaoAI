import { GUARDRAIL_LABELS, MEMORY_LABELS } from '../lib/agentLabels'
import type { AgentSummary } from '../lib/types'
import { Badge } from '../ui'

const EXECUTOR_LABEL = { function: 'Função', tool: 'App' } as const
const MODE_LABEL = { structured: 'Dados', structured_and_text: 'Dados + texto' } as const

// Quick config facts about an agent, shown on its cards (list, sector members,
// agent page header).
export function AgentBadges({ agent }: { agent: AgentSummary }) {
  const contrato = agent.contract
  const tipo = contrato?.executorKind ?? 'llm'
  // O contrato tem duas metades e elas significam coisas diferentes: "aceita campos" e
  // "promete campos". Um selo só, dizendo qual das duas existe, é o que cabe num card —
  // o detalhe está no formulário, e repeti-lo aqui viraria ruído em toda listagem.
  const contratoStatus =
    contrato?.inputJsonSchema && contrato?.outputJsonSchema
      ? 'Contrato completo'
      : contrato?.inputJsonSchema
        ? 'Contrato de entrada'
        : contrato?.outputJsonSchema
          ? 'Contrato de saída'
          : null

  return (
    <div className="flex flex-wrap gap-1.5">
      {/*
        Provedor e modelo só valem para quem é executado por um modelo. Numa função
        determinística eles não são só irrelevantes: são falsos — nenhum provedor é
        chamado, e o selo faria alguém procurar a conta de tokens que não existe.
      */}
      {tipo === 'llm' ? (
        <>
          <Badge tone="neutral">{agent.provider === 'openai' ? 'OpenAI' : 'Anthropic'}</Badge>
          {agent.model && <Badge tone="neutral">{agent.model}</Badge>}
        </>
      ) : (
        <Badge tone="creative">{EXECUTOR_LABEL[tipo]}</Badge>
      )}
      {contrato && contrato.responseMode !== 'text' && <Badge tone="success">{MODE_LABEL[contrato.responseMode]}</Badge>}
      {contratoStatus && <Badge tone="neutral">{contratoStatus}</Badge>}
      {tipo === 'llm' && agent.memoryType !== 'none' && <Badge tone="brand">{MEMORY_LABELS[agent.memoryType]}</Badge>}
      {agent.guardrailMode !== 'none' && <Badge tone="warning">{GUARDRAIL_LABELS[agent.guardrailMode]}</Badge>}
      {agent.handoffEnabled && <Badge tone="creative">Handoff</Badge>}
      {agent.identityEnabled && <Badge tone="neutral">Identificação</Badge>}
      {agent.structuredOutputEnabled && !contrato && <Badge tone="success">Dados estruturados</Badge>}
    </div>
  )
}
