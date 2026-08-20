import type { RunConfig, ToolChoice, ReasoningEffort } from '../lib/runConfig'
import { capabilitiesFor, REASONING_EFFORTS, TOOL_CHOICES } from '../lib/runConfig'

// Dois blocos: quem o agente é, e como o modelo é chamado.
//
// Eles ficam separados porque respondem a perguntas diferentes. "Definição" é sobre o
// trabalho — o dono escreve, lê e revisa. "Modelo e execução" é sobre a máquina, e quase
// ninguém precisa tocar: por isso todo campo ali começa em "Padrão do sistema", e é o
// vazio que preserva o comportamento de um agente criado antes desta tela.
//
// A matriz de capacidades manda no que aparece. Oferecer `temperature` num modelo de
// raciocínio produziria um 400 do provedor numa execução que o dono configurou pela
// própria interface — o erro mais frustrante que existe, porque a tela prometeu.

export interface AgentDefinitionValue {
  role: string
  instructions: string
  constraints: string
}

const HELP = {
  role: 'Quem este agente é. Ex.: "Analista de suporte técnico do plano empresarial".',
  goal: 'O que ele busca em cada trabalho. É o objetivo que você já configurou.',
  instructions: 'Como fazer: passos, tom, o que checar antes de responder.',
  constraints: 'O que ele NUNCA deve fazer. Um por linha.',
} as const

const campo =
  'w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)'
const rotulo = 'mb-1 block text-sm text-(--text-muted)'
const rotulo2 = rotulo
const ajuda = 'mt-1 text-xs text-(--text-faint)'


export function AgentDefinitionFields({
  value,
  onChange,
  presetLabel,
}: {
  value: AgentDefinitionValue
  onChange: (v: AgentDefinitionValue) => void
  // O molde de onde o agente saiu. Mostrado como origem, não como estado atual: o
  // preset é escolhido uma vez, e a função muda com o uso.
  presetLabel?: string | null
}) {
  const set = (patch: Partial<AgentDefinitionValue>) => onChange({ ...value, ...patch })

  return (
    <div className="grid gap-4" data-testid="agent-definition-fields">
      {presetLabel ? (
        <p className={ajuda} data-testid="agent-preset-origin">
          {/* O tipo é escolhido UMA vez, na contratação, e não muda depois.
              
              Trocá-lo depois mudava o que o agente podia fazer — base, sites,
              ferramentas — sem tocar em nada do que estava escrito nele. O resultado era
              um agente com a definição de pesquisador e o comportamento de coordenador,
              e nada na tela ligava uma coisa à outra. Quem quer outro tipo contrata
              outro agente; a definição abaixo continua toda editável. */}
          Criado a partir do modelo <strong>{presetLabel}</strong>. O tipo não muda depois da contratação — o que este agente faz,
          você escreve abaixo.
        </p>
      ) : null}

      <div>
        <label className={rotulo}>Função</label>
        <input value={value.role} onChange={(e) => set({ role: e.target.value })} className={campo} data-testid="agent-role" />
        <p className={ajuda}>{HELP.role}</p>
      </div>

      <div>
        <label className={rotulo}>Instruções</label>
        <textarea
          rows={4}
          value={value.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
          className={campo}
          data-testid="agent-instructions"
        />
        <p className={ajuda}>{HELP.instructions}</p>
      </div>

      <div>
        <label className={rotulo}>Limites</label>
        <textarea
          rows={3}
          value={value.constraints}
          onChange={(e) => set({ constraints: e.target.value })}
          className={campo}
          data-testid="agent-constraints"
        />
        <p className={ajuda}>{HELP.constraints}</p>
      </div>
    </div>
  )
}

/**
 * Um booleano de TRÊS estados: padrão, ligado, desligado.
 *
 * Uma caixa de seleção só tem dois, e o terceiro é justamente o que importa aqui.
 * "Desmarcada" teria de significar ao mesmo tempo "não escolhi" e "escolhi que não" — e
 * a diferença é real: quem desligou o cache de propósito não pode vê-lo religado por uma
 * mudança de padrão do sistema.
 *
 * Por isso `false` vira a string `'nao'` e volta como `false`, nunca como ausência.
 */
function TriEstado({
  rotulo,
  ajudaTexto,
  valor,
  onChange,
  testId,
}: {
  rotulo: string
  ajudaTexto: string
  valor: boolean | undefined
  onChange: (v: boolean | undefined) => void
  testId: string
}) {
  return (
    <div>
      <label className={rotulo2}>{rotulo}</label>
      <select
        value={valor === undefined ? '' : valor ? 'sim' : 'nao'}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'sim')}
        className={campo}
        data-testid={testId}
        aria-label={rotulo}
      >
        <option value="">Padrão do sistema</option>
        <option value="sim">Ativado</option>
        <option value="nao">Desativado</option>
      </select>
      <p className={ajuda}>{ajudaTexto}</p>
    </div>
  )
}

const TOOL_CHOICE_LABEL: Record<ToolChoice, string> = {
  auto: 'O agente decide quando usar',
  none: 'Nunca usar ferramentas',
  required: 'Sempre usar ao menos uma',
}

const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  low: 'Baixo — mais rápido e barato',
  medium: 'Médio',
  high: 'Alto — pensa mais, custa mais',
}

export function AgentRunConfigFields({
  value,
  onChange,
  provider,
  model,
}: {
  value: RunConfig
  onChange: (v: RunConfig) => void
  provider: string | null
  model: string | null
}) {
  // A MESMA matriz do servidor. Se ela divergir, a tela oferece o que o adapter recusa.
  const caps = capabilitiesFor(provider, model)
  const set = (patch: Partial<RunConfig>) => onChange({ ...value, ...patch })

  // Campo vazio = "Padrão do sistema". É o vazio, e não um número escolhido por nós, que
  // preserva o comportamento de todo agente que já existe.
  const numero = (v: number | undefined): string => (v === undefined ? '' : String(v))
  const lerNumero = (texto: string): number | undefined => {
    const t = texto.trim()
    if (!t) return undefined
    const n = Number(t)
    return Number.isFinite(n) ? n : undefined
  }

  return (
    <div className="grid gap-4" data-testid="agent-run-config-fields">
      <p className={ajuda}>
        Tudo aqui é opcional. Em branco significa <strong>padrão do sistema</strong> — e é assim que o agente se comporta hoje.
      </p>

      {caps.temperature ? (
        <div>
          <label className={rotulo}>Criatividade (temperature)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            placeholder="Padrão do sistema"
            value={numero(value.temperature)}
            onChange={(e) => set({ temperature: lerNumero(e.target.value) })}
            className={campo}
            data-testid="run-temperature"
          />
          <p className={ajuda}>0 é sempre igual; 2 é o mais variado. Fora dessa faixa o servidor aperta para o limite.</p>
        </div>
      ) : null}

      {caps.reasoningEffort ? (
        <div>
          <label className={rotulo}>Esforço de raciocínio</label>
          <select
            value={value.reasoningEffort ?? ''}
            onChange={(e) => set({ reasoningEffort: (e.target.value || undefined) as ReasoningEffort | undefined })}
            className={campo}
            data-testid="run-reasoning-effort"
          >
            <option value="">Padrão do sistema</option>
            {REASONING_EFFORTS.map((k) => (
              <option key={k} value={k}>
                {EFFORT_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {caps.maxOutputTokens ? (
        <div>
          <label className={rotulo}>Tamanho máximo da resposta (tokens)</label>
          <input
            type="number"
            min="64"
            placeholder="Padrão do sistema"
            value={numero(value.maxOutputTokens)}
            onChange={(e) => set({ maxOutputTokens: lerNumero(e.target.value) })}
            className={campo}
            data-testid="run-max-output-tokens"
          />
          <p className={ajuda}>Limita o provedor. O limite de caracteres da resposta continua valendo como segunda trava.</p>
        </div>
      ) : null}

      {caps.toolChoice ? (
        <div>
          <label className={rotulo}>Uso de ferramentas</label>
          <select
            value={value.toolChoice ?? ''}
            onChange={(e) => set({ toolChoice: (e.target.value || undefined) as ToolChoice | undefined })}
            className={campo}
            data-testid="run-tool-choice"
          >
            <option value="">Padrão do sistema</option>
            {TOOL_CHOICES.map((k) => (
              <option key={k} value={k}>
                {TOOL_CHOICE_LABEL[k]}
              </option>
            ))}
          </select>
          <p className={ajuda}>Isto não amplia permissão: o agente continua alcançando apenas o que foi concedido a ele.</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={rotulo}>Tempo máximo (ms)</label>
          <input
            type="number"
            min="5000"
            placeholder="Padrão do sistema"
            value={numero(value.timeoutMs)}
            onChange={(e) => set({ timeoutMs: lerNumero(e.target.value) })}
            className={campo}
            data-testid="run-timeout"
          />
        </div>
        <div>
          <label className={rotulo}>Tentativas em caso de falha</label>
          <input
            type="number"
            min="0"
            max="3"
            placeholder="Padrão do sistema"
            value={numero(value.retries)}
            onChange={(e) => set({ retries: lerNumero(e.target.value) })}
            className={campo}
            data-testid="run-retries"
          />
          <p className={ajuda}>Só vale para falha passageira, e nunca depois de já haver resposta.</p>
        </div>
      </div>

      {caps.parallelTools ? (
        <TriEstado
          rotulo="Chamar ferramentas em paralelo"
          ajudaTexto="Vale só quando todas as ferramentas disponíveis são de leitura. Se houver uma que altera dados, a ordem é mantida."
          valor={value.parallelTools}
          onChange={(v) => set({ parallelTools: v })}
          testId="run-parallel-tools"
        />
      ) : null}

      {caps.cache ? (
        <TriEstado
          rotulo="Reaproveitar prompt em cache"
          ajudaTexto="Reduz custo quando o começo do prompt repete entre execuções."
          valor={value.cache}
          onChange={(v) => set({ cache: v })}
          testId="run-cache"
        />
      ) : null}

      {caps.stream ? (
        <TriEstado
          rotulo="Mostrar a resposta sendo escrita"
          ajudaTexto="Só em conversa. Automação grava o resultado, então lá isto não se aplica."
          valor={value.stream}
          onChange={(v) => set({ stream: v })}
          testId="run-stream"
        />
      ) : null}
    </div>
  )
}
