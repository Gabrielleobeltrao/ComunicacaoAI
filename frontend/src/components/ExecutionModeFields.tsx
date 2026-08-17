import { useEffect, useMemo, useState } from 'react'
import type { AgentAppAction, AppActionPlan, ExecutionMode, MemoryPlan, MemoryScope, MemoryStrategy, StepCondition } from '../lib/agentRoutines'
import { listAgentAppActions } from '../lib/agentRoutines'
import { listMemoryScopes, type MemoryScopeSummary } from '../lib/memories'
import { Field, Input, Select } from '../ui'

// Como o gatilho processa o que chega — e quanto isso custa.
//
// A escolha mais cara do formulário está aqui, e por isso o custo vem escrito no
// próprio rótulo em vez de estar na documentação: quem lê "0 tokens de LLM" decide
// com a informação na frente.
//
// Os campos incompatíveis com o modo escolhido não ficam desabilitados, ficam FORA
// da tela. Um campo cinza convida a perguntar o que ele faz; um campo ausente não
// levanta a questão.

export const MODE_OPTIONS: { value: ExecutionMode; label: string; hint: string }[] = [
  { value: 'collect_only', label: 'Somente coletar — 0 tokens de LLM', hint: 'Recebe, valida e guarda. Encerra sem IA.' },
  { value: 'deterministic', label: 'Executar ações — 0 tokens de LLM', hint: 'Guarda e entrega, seguindo regras. Nenhum modelo é chamado.' },
  { value: 'ai', label: 'Processar com IA — consome tokens', hint: 'O agente lê cada evento. É o comportamento de sempre.' },
  { value: 'hybrid', label: 'Híbrido — IA só quando a condição bater', hint: 'Processa sem IA e chama o agente apenas quando a condição for verdadeira.' },
  { value: 'automatic', label: 'Automático por regras — IA somente quando necessário', hint: 'Igual ao híbrido, com a regra escolhida da lista.' },
]

const STRATEGY_OPTIONS: { value: MemoryStrategy; label: string }[] = [
  { value: 'append', label: 'Acrescentar — guarda um registro por evento (histórico)' },
  { value: 'upsert', label: 'Atualizar — mistura os campos novos no registro da mesma chave' },
  { value: 'replace', label: 'Substituir — troca o conteúdo do registro da mesma chave' },
]

const OPERATOR_OPTIONS: { value: StepCondition['operator']; label: string }[] = [
  { value: 'exists', label: 'existe' },
  { value: 'absent', label: 'não veio' },
  { value: 'equals', label: 'é igual a' },
  { value: 'not_equals', label: 'é diferente de' },
  { value: 'contains', label: 'contém' },
  { value: 'gt', label: 'é maior que' },
  { value: 'lt', label: 'é menor que' },
  { value: 'matches', label: 'casa com a expressão' },
]

const TTL_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: 'Guardar para sempre' },
  { value: '86400', label: 'Apagar depois de 1 dia' },
  { value: '604800', label: 'Apagar depois de 7 dias' },
  { value: '2592000', label: 'Apagar depois de 30 dias' },
  { value: '31536000', label: 'Apagar depois de 1 ano' },
]

export const emptyMemoryPlan = (): MemoryPlan => ({ enabled: false, scope: 'agent', strategy: 'append', key: 'evento' })
export const emptyAppActionPlan = (): AppActionPlan => ({ enabled: false, appKey: '', actionKey: '' })

// A frase de conferência. A mesma lógica existe no servidor (`describeFlow`); esta
// é a versão que aparece ANTES de salvar, que é quando ela ainda evita o erro.
export function describeFlow(
  mode: ExecutionMode,
  memory: MemoryPlan,
  condition: StepCondition | null,
  destino?: string | null,
  action?: AppActionPlan | null,
  actionLabel?: string | null,
): string {
  const partes = ['Webhook', 'validar']
  if (action?.enabled) partes.push(actionLabel ?? `executar ${action.actionKey}`)
  if (memory.enabled) {
    const onde = destino ?? { agent: 'do agente', sector: 'do setor', floor: 'do andar', building: 'do prédio' }[memory.scope]
    partes.push(`salvar na memória ${onde}`)
  }
  const comIA = mode === 'ai' || ((mode === 'hybrid' || mode === 'automatic') && !!condition)
  if (comIA && mode !== 'ai') partes.push('chamar a IA quando a condição bater')
  else if (comIA) partes.push('processar com IA')
  partes.push(comIA ? 'encerrar' : 'encerrar sem IA')
  return partes.join(' → ')
}

export interface ExecutionModeValue {
  executionMode: ExecutionMode
  memory: MemoryPlan
  aiCondition: StepCondition | null
  action?: AppActionPlan
}

export function ExecutionModeFields({
  value,
  onChange,
  idPrefix = '',
  agentId,
}: {
  value: ExecutionModeValue
  onChange: (v: ExecutionModeValue) => void
  idPrefix?: string
  // Sem o agente não há como saber quais Apps ele pode usar — e a seção de ação não
  // aparece, em vez de oferecer o catálogo inteiro.
  agentId?: string
}) {
  const [scopes, setScopes] = useState<MemoryScopeSummary[]>([])
  const [acoes, setAcoes] = useState<AgentAppAction[]>([])
  const [avancado, setAvancado] = useState(false)
  const t = (id: string) => `${idPrefix}${id}`

  useEffect(() => {
    // A lista de destinos vem do servidor já filtrada pela conta: a interface nunca
    // monta um destino que o dono não tenha.
    listMemoryScopes()
      .then(setScopes)
      .catch(() => setScopes([]))
  }, [])

  useEffect(() => {
    if (!agentId) return
    // Só App conectado e ação concedida. Oferecer o catálogo inteiro levaria o dono a
    // montar um fluxo que falha na primeira execução — e a recusa chegaria horas depois,
    // no histórico.
    listAgentAppActions(agentId)
      .then(setAcoes)
      .catch(() => setAcoes([]))
  }, [agentId])

  const { executionMode, memory, aiCondition } = value
  const action = value.action ?? emptyAppActionPlan()
  const acaoAtual = acoes.find((a) => a.appKey === action.appKey && a.actionKey === action.actionKey)
  const set = (patch: Partial<ExecutionModeValue>) => onChange({ ...value, ...patch })
  const setMemory = (patch: Partial<MemoryPlan>) => set({ memory: { ...memory, ...patch } })

  const doEscopo = useMemo(() => scopes.filter((s) => s.scope === memory.scope), [scopes, memory.scope])
  const destinoAtual = useMemo(() => {
    const id = memory.scope === 'agent' ? memory.agentId : memory.scope === 'sector' ? memory.sectorId : memory.scope === 'floor' ? memory.floorId : memory.buildingId
    return doEscopo.find((s) => s.scopeKey === `${memory.scope}:${id}`)?.label ?? null
  }, [doEscopo, memory])

  // Trocar o escopo zera o id anterior: um id de setor guardado num campo de andar
  // não aponta para lugar nenhum.
  const trocarEscopo = (scope: MemoryScope) =>
    setMemory({ scope, agentId: null, sectorId: null, floorId: null, buildingId: null })

  const escolherDestino = (scopeKey: string) => {
    const id = scopeKey.split(':')[1] ?? null
    setMemory({
      agentId: memory.scope === 'agent' ? id : null,
      sectorId: memory.scope === 'sector' ? id : null,
      floorId: memory.scope === 'floor' ? id : null,
      buildingId: memory.scope === 'building' ? id : null,
    })
  }

  const usaCondicao = executionMode === 'hybrid' || executionMode === 'automatic'

  return (
    <div style={{ display: 'grid', gap: 12 }} data-testid={t('execution-mode-fields')}>
      <Field label="Modo de execução" hint={MODE_OPTIONS.find((m) => m.value === executionMode)?.hint}>
        <Select
          value={executionMode}
          onChange={(e) => set({ executionMode: e.target.value as ExecutionMode })}
          data-testid={t('execution-mode')}
          aria-label="Modo de execução"
          options={MODE_OPTIONS.map((m) => ({ value: m.value, label: m.label }))}
        />
      </Field>

      {/* --- executar uma ação de App ------------------------------------------- */}
      {agentId && acoes.length > 0 ? (
        <Field
          label="Executar uma ação?"
          hint="Roda a ação direto, pelo mesmo caminho que o agente usaria — sem passar por modelo. 0 tokens de LLM."
        >
          <Select
            value={action.enabled ? `${action.appKey}:${action.actionKey}` : ''}
            onChange={(e) => {
              const escolha = e.target.value
              if (!escolha) return set({ action: emptyAppActionPlan() })
              const [appKey, actionKey] = escolha.split(':')
              set({ action: { enabled: true, appKey, actionKey, args: action.args } })
            }}
            data-testid={t('app-action')}
            aria-label="Executar uma ação"
            options={[
              { value: '', label: 'Não executar ação' },
              ...acoes.map((a) => ({ value: `${a.appKey}:${a.actionKey}`, label: `${a.appName} · ${a.actionName} — 0 tokens de LLM` })),
            ]}
          />
        </Field>
      ) : null}

      {action.enabled && acaoAtual && !acaoAtual.autonomous ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--status-blocked)' }} data-testid={t('app-action-warning')}>
          Esta ação altera dados e ainda não está autorizada para uso autônomo. Autorize nas permissões do agente, senão ela será recusada em
          cada execução.
        </p>
      ) : null}

      {/* --- salvar informação ------------------------------------------------- */}
      <Field label="Salvar informação?" hint="Guardar o que chegou, sem passar por modelo nenhum.">
        <Select
          value={memory.enabled ? 'sim' : 'nao'}
          onChange={(e) => setMemory({ enabled: e.target.value === 'sim' })}
          data-testid={t('memory-enabled')}
          aria-label="Salvar informação"
          options={[
            { value: 'nao', label: 'Não guardar' },
            { value: 'sim', label: 'Sim, guardar na memória' },
          ]}
        />
      </Field>

      {memory.enabled ? (
        <div style={{ display: 'grid', gap: 12 }} data-testid={t('memory-config')}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Destino da memória">
              <Select
                value={memory.scope}
                onChange={(e) => trocarEscopo(e.target.value as MemoryScope)}
                data-testid={t('memory-scope')}
                aria-label="Destino da memória"
                options={[
                  { value: 'agent', label: 'Memória do agente' },
                  { value: 'sector', label: 'Memória do setor' },
                  { value: 'floor', label: 'Memória do andar' },
                  { value: 'building', label: 'Memória do prédio' },
                ]}
              />
            </Field>
            {memory.scope === 'agent' ? null : (
              <Field label="Qual" hint={doEscopo.length === 0 ? 'Nenhum disponível nesta conta.' : undefined}>
                <Select
                  value={destinoAtual ? `${memory.scope}:${memory.sectorId ?? memory.floorId ?? memory.buildingId}` : ''}
                  onChange={(e) => escolherDestino(e.target.value)}
                  data-testid={t('memory-target')}
                  aria-label="Qual destino"
                  options={[{ value: '', label: 'Escolha…' }, ...doEscopo.map((s) => ({ value: s.scopeKey, label: s.label }))]}
                />
              </Field>
            )}
          </div>

          <Field label="Estratégia de gravação" hint={STRATEGY_OPTIONS.find((s) => s.value === memory.strategy)?.label}>
            <Select
              value={memory.strategy}
              onChange={(e) => setMemory({ strategy: e.target.value as MemoryStrategy })}
              data-testid={t('memory-strategy')}
              aria-label="Estratégia de gravação"
              options={STRATEGY_OPTIONS}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Chave do registro" hint="Aceita {{campo}} do próprio evento. Ex.: pedido-{{pedido.id}}">
              <Input value={memory.key} onChange={(e) => setMemory({ key: e.target.value })} data-testid={t('memory-key')} />
            </Field>
            <Field label="Marca de não repetir (opcional)" hint="O que torna este evento único. Um reenvio com a mesma marca não vira outro registro.">
              <Input
                value={memory.dedupeKey ?? ''}
                onChange={(e) => setMemory({ dedupeKey: e.target.value || null })}
                placeholder="{{pedido.id}}"
                data-testid={t('memory-dedupe')}
              />
            </Field>
          </div>

          <button
            type="button"
            onClick={() => setAvancado((v) => !v)}
            className="ds-hit"
            style={{ justifySelf: 'start', background: 'none', border: 0, padding: 0, color: 'var(--intent-brand)', fontSize: 13, cursor: 'pointer' }}
            data-testid={t('memory-advanced-toggle')}
          >
            {avancado ? 'Ocultar avançado' : 'Configurações avançadas'}
          </button>

          {avancado ? (
            <div style={{ display: 'grid', gap: 12 }} data-testid={t('memory-advanced')}>
              <Field label="Mapeamento dos campos (opcional)" hint="Um por linha, no formato destino = origem. Vazio guarda o evento inteiro.">
                <Input
                  value={Object.entries(memory.fieldMap ?? {})
                    .map(([d, o]) => `${d} = ${o}`)
                    .join('\n')}
                  onChange={(e) => {
                    const mapa: Record<string, string> = {}
                    for (const linha of e.target.value.split('\n')) {
                      const [d, ...resto] = linha.split('=')
                      const origem = resto.join('=').trim()
                      if (d?.trim() && origem) mapa[d.trim()] = origem
                    }
                    setMemory({ fieldMap: Object.keys(mapa).length ? mapa : undefined })
                  }}
                  placeholder="total = pedido.valor"
                  data-testid={t('memory-fieldmap')}
                />
              </Field>
              <Field label="Retenção">
                <Select
                  value={String(memory.ttlSeconds ?? 0)}
                  onChange={(e) => setMemory({ ttlSeconds: Number(e.target.value) || null })}
                  data-testid={t('memory-ttl')}
                  aria-label="Retenção"
                  options={TTL_OPTIONS}
                />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* --- quando chamar a IA -------------------------------------------------- */}
      {usaCondicao ? (
        <div style={{ display: 'grid', gap: 12 }} data-testid={t('ai-condition-config')}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid={t('ai-condition-note')}>
            Sem uma condição preenchida, a IA não é chamada em nenhum evento — o gatilho processa e encerra.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 12 }}>
            <Field label="Campo do evento">
              <Input
                value={aiCondition?.path ?? ''}
                onChange={(e) =>
                  set({
                    aiCondition: e.target.value
                      ? { source: 'input', path: e.target.value, operator: aiCondition?.operator ?? 'exists', value: aiCondition?.value }
                      : null,
                  })
                }
                placeholder="cliente.plano"
                data-testid={t('ai-condition-path')}
              />
            </Field>
            <Field label="Comparação">
              <Select
                value={aiCondition?.operator ?? 'exists'}
                onChange={(e) =>
                  set({
                    aiCondition: {
                      source: 'input',
                      path: aiCondition?.path ?? '',
                      operator: e.target.value as StepCondition['operator'],
                      value: aiCondition?.value,
                    },
                  })
                }
                data-testid={t('ai-condition-operator')}
                aria-label="Comparação"
                options={OPERATOR_OPTIONS}
              />
            </Field>
            <Field label="Valor">
              <Input
                value={typeof aiCondition?.value === 'string' ? aiCondition.value : (aiCondition?.value ?? '') === '' ? '' : String(aiCondition?.value)}
                onChange={(e) =>
                  set({
                    aiCondition: {
                      source: 'input',
                      path: aiCondition?.path ?? '',
                      operator: aiCondition?.operator ?? 'exists',
                      value: e.target.value,
                    },
                  })
                }
                data-testid={t('ai-condition-value')}
              />
            </Field>
          </div>
        </div>
      ) : null}

      {/* --- o resumo, que é o que evita o erro caro ----------------------------- */}
      <div
        style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}
        data-testid={t('flow-summary')}
      >
        <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>O que vai acontecer</p>
        <p style={{ margin: 0, fontSize: 13 }}>
          {describeFlow(executionMode, memory, aiCondition, destinoAtual, action, acaoAtual ? `executar ${acaoAtual.actionName}` : null)}
        </p>
      </div>
    </div>
  )
}
