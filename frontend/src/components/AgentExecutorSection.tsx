import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { listExecutorCatalog, listInstallations } from '../lib/apps'
import type { CatalogAction, CatalogFunction, AppInstallation } from '../lib/apps'
import type { ExecutorKind, ResponseMode } from '../lib/types'

// COMO este agente executa — a pergunta que muda todo o resto do formulário.
//
// Antes, todo agente era uma chamada a um modelo, e o formulário perguntava a mesma coisa
// a todos: provedor, temperatura, instruções. Para um agente que só soma uma coluna ou
// chama um endpoint, nada disso significa nada — e um campo que não significa nada não
// fica inofensivo na tela: ele é preenchido, e depois alguém passa uma tarde entendendo
// por que a temperatura não mudou o resultado de uma função determinística.
//
// Então é uma escolha só, no começo, e o formulário passa a fazer as perguntas do tipo
// escolhido. Não confundir com `preset` (o PAPEL: quem pesquisa, quem analisa) nem com
// `executionMode` das rotinas (com que frequência roda). Aqui é quem faz o trabalho.

const TIPOS: { kind: ExecutorKind; titulo: string; resumo: string }[] = [
  { kind: 'llm', titulo: 'IA / LLM', resumo: 'Um modelo lê o pedido e responde. É como todo agente sempre funcionou.' },
  { kind: 'function', titulo: 'Função do sistema', resumo: 'Um cálculo determinístico do servidor. Mesma entrada, mesma saída, sem custo de modelo.' },
  { kind: 'tool', titulo: 'App / Ferramenta', resumo: 'Uma ação de um App conectado. O agente executa; ele não conversa sobre isso.' },
  {
    kind: 'formula',
    titulo: 'Fórmula',
    resumo: 'Um cálculo que você escreve. Contas, condições e texto — sem custo de modelo.',
  },
]

const MODOS: { modo: ResponseMode; titulo: string; quando: string }[] = [
  { modo: 'structured', titulo: 'Dados estruturados', quando: 'Quando outra etapa ou um sistema consome o resultado.' },
  { modo: 'text', titulo: 'Texto', quando: 'Quando uma pessoa lê a resposta.' },
  { modo: 'structured_and_text', titulo: 'Dados + texto', quando: 'Quando os dois acontecem: um sistema consome e alguém lê.' },
]

export interface ExecutorDraft {
  kind: ExecutorKind
  /** A fórmula, quando o tipo é `formula`. É ela que declara o contrato do agente. */
  expression: string
  functionName: string
  functionVersion: string
  appKey: string
  actionKey: string
  responseMode: ResponseMode
  /** Os parâmetros que o dono fixou. Só os campos que a função declara. */
  config: Record<string, unknown>
}

/** O que impede de salvar. Vazio = coerente. */
export function executorProblems(d: ExecutorDraft): string[] {
  const problemas: string[] = []
  if (d.kind === 'function' && !d.functionName) problemas.push('Escolha a função que este agente executa.')
  if (d.kind === 'tool' && !(d.appKey && d.actionKey)) problemas.push('Escolha o App e a ação que este agente executa.')
  if (d.kind === 'formula' && !d.expression.trim()) problemas.push('Escreva a fórmula que este agente calcula.')
  return problemas
}

/**
 * Os modos que ESTE executor consegue cumprir.
 *
 * Uma função produz dado; prosa é trabalho de modelo. Uma ferramenta só promete dado
 * quando a ação declara o formato da resposta. Oferecer o modo impossível é deixar o dono
 * escolher uma promessa que o servidor vai corrigir por baixo — e a tela passa a mostrar
 * uma coisa enquanto o agente faz outra.
 */
export function modesFor(kind: ExecutorKind, temSchemaDeSaida: boolean): ResponseMode[] {
  // Uma fórmula calcula: ela produz dado, e prosa é trabalho de modelo — igual à função.
  if (kind === 'function' || kind === 'formula') return ['structured']
  if (kind === 'tool') return temSchemaDeSaida ? ['structured', 'text', 'structured_and_text'] : ['text']
  return ['structured', 'text', 'structured_and_text']
}

/**
 * Os campos que a FÓRMULA lê e não define — a entrada dela.
 *
 * Uma leitura de superfície, só para a tela: o servidor faz a análise de verdade ao gravar
 * e é ele quem grava o contrato. Mostrar aqui é dizer antes o que vai valer, em vez de
 * deixar o dono descobrir depois de salvar.
 */
export function camposDaFormula(fonte: string): string[] {
  const definidos = new Set<string>()
  const lidos = new Set<string>()
  for (const linha of fonte.split('\n')) {
    const texto = linha.trim()
    if (!texto || texto.startsWith('#')) continue
    const igual = texto.indexOf('=')
    if (igual <= 0 || ['<', '>', '='].includes(texto[igual - 1]) || texto[igual + 1] === '=') continue
    const nome = texto.slice(0, igual).trim()
    for (const m of texto.slice(igual + 1).matchAll(/[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*/g)) {
      const t = m[0]
      // Uma palavra seguida de `(` é chamada de função, não campo.
      const depois = texto.slice(igual + 1 + (m.index ?? 0) + t.length).trimStart()
      if (depois.startsWith('(')) continue
      if (['e', 'ou', 'nao', 'verdadeiro', 'falso'].includes(t.toLowerCase())) continue
      if (!definidos.has(t)) lidos.add(t)
    }
    definidos.add(nome)
  }
  return [...lidos].sort()
}

/** Os campos que o formulário de parâmetros desenha. Nada além do que o schema declara. */
export function configFields(schema: Record<string, unknown> | null | undefined): {
  name: string
  type: string
  description: string
  minimum?: number
  maximum?: number
}[] {
  const props = (schema as { properties?: Record<string, unknown> } | null)?.properties
  if (!props || typeof props !== 'object' || Array.isArray(props)) return []
  return Object.entries(props as Record<string, unknown>).map(([name, def]) => {
    const d = (def ?? {}) as { type?: unknown; description?: unknown; minimum?: unknown; maximum?: unknown }
    return {
      name,
      type: typeof d.type === 'string' ? d.type : 'string',
      description: typeof d.description === 'string' ? d.description : '',
      ...(typeof d.minimum === 'number' ? { minimum: d.minimum } : {}),
      ...(typeof d.maximum === 'number' ? { maximum: d.maximum } : {}),
    }
  })
}

export function AgentExecutorSection({
  draft,
  onChange,
  disabled,
  onContractDerived,
}: {
  draft: ExecutorDraft
  onChange: (d: ExecutorDraft) => void
  disabled?: boolean
  /**
   * Os schemas que a escolha IMPLICA.
   *
   * Quem escolhe uma função não deveria precisar copiar o contrato dela à mão: o servidor
   * já sabe qual é, e vai sobrescrever o que for enviado. Preencher aqui é mostrar antes o
   * que vai valer, em vez de deixar o dono descobrir depois de salvar.
   */
  onContractDerived?: (c: { inputJsonSchema: Record<string, unknown> | null; outputJsonSchema: Record<string, unknown> | null }) => void
}) {
  const [funcoes, setFuncoes] = useState<CatalogFunction[]>([])
  const [acoes, setAcoes] = useState<CatalogAction[]>([])
  const [instalacoes, setInstalacoes] = useState<AppInstallation[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    let vivo = true
    Promise.all([listExecutorCatalog(), listInstallations().catch(() => [] as AppInstallation[])])
      .then(([catalogo, inst]) => {
        if (!vivo) return
        setFuncoes(catalogo.functions)
        setAcoes(catalogo.actions)
        setInstalacoes(inst)
      })
      .catch(() => vivo && setErro('Não foi possível carregar o catálogo.'))
    return () => {
      vivo = false
    }
  }, [])

  // CONECTADO é o que decide o que aparece: uma ação de um App que ninguém conectou não é
  // uma opção, é uma promessa que falharia na primeira execução.
  const conectados = useMemo(
    // `connected` e só ele: uma instalação com erro, revogada ou precisando de reautenticação
    // não executa nada, e oferecê-la seria empurrar a falha para o primeiro uso.
    () => new Set(instalacoes.filter((i) => i.status === 'connected').map((i) => i.appKey)),
    [instalacoes],
  )
  const filtro = busca.trim().toLowerCase()
  const funcoesVisiveis = useMemo(
    () =>
      funcoes.filter(
        (f) =>
          !filtro ||
          f.functionName.toLowerCase().includes(filtro) ||
          f.description.toLowerCase().includes(filtro) ||
          f.capabilities.some((c) => c.toLowerCase().includes(filtro)),
      ),
    [funcoes, filtro],
  )
  const escolhida = funcoes.find((f) => f.functionName === draft.functionName) ?? null
  const appsComAcao = useMemo(() => [...new Map(acoes.map((a) => [a.appKey, a])).values()], [acoes])
  const acoesDoApp = acoes.filter((a) => a.appKey === draft.appKey)
  const acaoEscolhida = acoesDoApp.find((a) => a.actionKey === draft.actionKey) ?? null

  const set = (parcial: Partial<ExecutorDraft>) => onChange({ ...draft, ...parcial })

  // O que este executor CONSEGUE devolver — não o que alguém gostaria.
  const temSchemaDeSaida = draft.kind === 'function' || draft.kind === 'formula' ? true : Boolean(acaoEscolhida?.outputSchema)
  const modosPossiveis = modesFor(draft.kind, temSchemaDeSaida)
  const parametros = configFields(escolhida?.configSchema)
  const entradasDaFormula = draft.kind === 'formula' ? camposDaFormula(draft.expression) : []

  // O modo escolhido deixou de ser possível (trocou de tipo, trocou de ação): corrige na
  // hora, em vez de deixar a tela mostrando uma promessa que o servidor vai desfazer.
  useEffect(() => {
    if (!modosPossiveis.includes(draft.responseMode)) onChange({ ...draft, responseMode: modosPossiveis[0] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.kind, draft.responseMode, temSchemaDeSaida])

  /**
   * O RESUMO, em uma linha.
   *
   * Quem abre a tela quer saber três coisas: quem executa, se a entrada está definida e o
   * que sai. Elas estavam espalhadas por três blocos e dois níveis de detalhe — e a
   * pergunta "está pronto?" só tinha resposta lendo tudo.
   */
  const pendencias = executorProblems(draft)
  const resumo = [
    `Executa por: ${draft.kind === 'function' ? 'Função' : draft.kind === 'tool' ? 'App' : 'IA'}`,
    draft.kind === 'llm'
      ? 'Entrada: texto'
      : draft.kind === 'formula'
        ? // A fórmula declara o próprio contrato: os campos que ela lê SÃO a entrada.
          entradasDaFormula.length > 0
          ? `Entrada: ${entradasDaFormula.join(', ')}`
          : 'Entrada não definida'
        : (draft.kind === 'function' ? escolhida?.inputSchema : acaoEscolhida?.inputSchema)
          ? 'Entrada válida'
          : 'Entrada não definida',
    `Saída: ${draft.responseMode === 'text' ? 'Texto' : draft.responseMode === 'structured' ? 'Dados' : 'Dados + texto'}`,
  ]

  return (
    <div className="space-y-4" data-testid="executor-section">
      <p className="pb-1 text-xs text-(--text-muted)" data-testid="executor-summary">
        {resumo.join(' · ')}
        {pendencias.length > 0 && (
          <span style={{ color: 'var(--status-blocked)' }} data-testid="executor-summary-pending">
            {' '}
            · {pendencias[0]}
          </span>
        )}
      </p>
      <fieldset disabled={disabled} className="space-y-2">
        {/* Sem legenda: o bloco que contém isto já se chama "Como este agente executa", e
            a pergunta repetida logo abaixo do título era a mesma frase duas vezes. */}
        <div className="grid gap-2 sm:grid-cols-3">
          {TIPOS.map((t) => (
            <label
              key={t.kind}
              // O testid vai no RÓTULO: o input é `sr-only` (existe para teclado e leitor de
              // tela) e quem usa o mouse clica no cartão, que é o alvo de verdade.
              data-testid={`executor-kind-${t.kind}`}
              className={`cursor-pointer rounded-lg border p-3 text-left ${
                draft.kind === t.kind ? 'border-(--border-focus)' : 'border-(--border-subtle)'
              }`}
            >
              <input
                type="radio"
                name="executor-kind"
                value={t.kind}
                checked={draft.kind === t.kind}
                onChange={() => set({ kind: t.kind })}
                className="sr-only"
                data-testid={`executor-kind-${t.kind}-input`}
              />
              <span className="block text-sm font-medium">{t.titulo}</span>
              <span className="mt-1 block text-xs text-(--text-faint)">{t.resumo}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {erro && (
        <p className="text-xs" style={{ color: 'var(--status-blocked)' }} data-testid="executor-catalog-error">
          {erro}
        </p>
      )}

      {draft.kind === 'function' && (
        <div className="space-y-2 rounded-lg border border-(--border-subtle) p-3" data-testid="function-picker">
          <label className="block text-sm text-(--text-muted)" htmlFor="function-search">
            Função do sistema
          </label>
          {/*
            Uma LISTA, e nunca uma caixa de texto livre.
            O que executa é código deste servidor; o agente guarda o nome. Um campo onde se
            cola um trecho seria a porta de execução arbitrária que o resto do sistema
            existe para fechar.
          */}
          <input
            id="function-search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar por nome, descrição ou capacidade"
            className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
            data-testid="function-search"
          />
          <ul className="max-h-56 space-y-1 overflow-y-auto" data-testid="function-list">
            {funcoesVisiveis.length === 0 && <li className="p-2 text-xs text-(--text-faint)">Nenhuma função encontrada.</li>}
            {funcoesVisiveis.map((f) => (
              <li key={f.functionName}>
                <button
                  type="button"
                  onClick={() => {
                    set({ functionName: f.functionName, functionVersion: f.version })
                    onContractDerived?.({ inputJsonSchema: f.inputSchema, outputJsonSchema: f.outputSchema })
                  }}
                  aria-pressed={draft.functionName === f.functionName}
                  className={`w-full rounded-md border p-2 text-left ${
                    draft.functionName === f.functionName ? 'border-(--border-focus)' : 'border-transparent hover:border-(--border-subtle)'
                  }`}
                  data-testid={`function-option-${f.functionName}`}
                >
                  <span className="block font-mono text-xs">{f.functionName}</span>
                  <span className="block text-xs text-(--text-faint)">{f.description}</span>
                </button>
              </li>
            ))}
          </ul>
          {escolhida && parametros.length > 0 && (
            <div className="space-y-2 rounded-md border border-(--border-subtle) p-2" data-testid="function-config">
              <p className="text-xs text-(--text-muted)">Parâmetros desta função</p>
              {/*
                Um formulário GERADO do schema, e não um editor JSON livre.
                Livre, o dono digita o que quiser, o handler recebe o que vier, e nada diz
                quais campos existem. E um campo livre é onde uma credencial acaba parando.
              */}
              {parametros.map((campo) => (
                <div key={campo.name}>
                  <label className="mb-1 block text-xs text-(--text-muted)" htmlFor={`config-${campo.name}`}>
                    {campo.description || campo.name}
                  </label>
                  {campo.type === 'boolean' ? (
                    <input
                      id={`config-${campo.name}`}
                      type="checkbox"
                      checked={Boolean(draft.config[campo.name])}
                      onChange={(e) => set({ config: { ...draft.config, [campo.name]: e.target.checked } })}
                      data-testid={`function-config-${campo.name}`}
                    />
                  ) : (
                    <input
                      id={`config-${campo.name}`}
                      type={campo.type === 'string' ? 'text' : 'number'}
                      value={String(draft.config[campo.name] ?? '')}
                      min={campo.minimum}
                      max={campo.maximum}
                      onChange={(e) => {
                        const bruto = e.target.value
                        const valor = campo.type === 'string' ? bruto : bruto === '' ? undefined : Number(bruto)
                        const proximo = { ...draft.config }
                        if (valor === undefined || valor === '') delete proximo[campo.name]
                        else proximo[campo.name] = valor
                        set({ config: proximo })
                      }}
                      className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                      data-testid={`function-config-${campo.name}`}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          {escolhida && (
            <div className="rounded-md border border-(--border-subtle) p-2 text-xs text-(--text-muted)" data-testid="function-detail">
              <p>
                <span className="font-mono">{escolhida.functionName}</span> · versão {escolhida.version}
              </p>
              {escolhida.capabilities.length > 0 && <p className="mt-1">Capacidades: {escolhida.capabilities.join(', ')}</p>}
              <p className="mt-1">Recebe: {campos(escolhida.inputSchema) || '—'}</p>
              <p>Devolve: {campos(escolhida.outputSchema) || '—'}</p>
            </div>
          )}
        </div>
      )}

      {draft.kind === 'formula' && (
        <div className="space-y-2 rounded-lg border border-(--border-subtle) p-3" data-testid="formula-editor">
          <label className="block text-sm text-(--text-muted)" htmlFor="formula-expression">
            A fórmula
          </label>
          {/*
            Uma FÓRMULA, e não JavaScript.
            A diferença não é de sintaxe: esta linguagem não tem rede, disco nem acesso ao
            processo, e não tem laço — então toda fórmula termina. JavaScript aqui seria o
            código de um cliente rodando no mesmo servidor que guarda os dados de todos os
            outros.
          */}
          <textarea
            id="formula-expression"
            value={draft.expression}
            onChange={(e) => set({ expression: e.target.value })}
            rows={6}
            spellCheck={false}
            placeholder={'margem = arred((receita - custo) / receita * 100, 2)\nfaixa  = se(margem >= 30, "alta", "baixa")'}
            className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 font-mono text-xs outline-none focus:border-(--border-focus)"
            data-testid="formula-expression"
          />
          <p className="text-xs text-(--text-faint)">
            Uma linha por resultado, no formato <span className="font-mono">nome = expressão</span>. Os campos que ela lê e não define viram a
            entrada do agente; os nomes definidos viram a saída.
          </p>
          {entradasDaFormula.length > 0 && (
            <p className="text-xs text-(--text-muted)" data-testid="formula-inputs">
              Recebe: <span className="font-mono">{entradasDaFormula.join(', ')}</span>
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-(--text-muted)">O que dá para escrever</summary>
            <div className="mt-2 space-y-1 text-xs text-(--text-faint)">
              <p>
                <span className="font-mono">+ - * / %</span> · comparações <span className="font-mono">= &lt;&gt; &lt; &lt;= &gt; &gt;=</span> ·{' '}
                <span className="font-mono">e ou nao</span>
              </p>
              <p className="font-mono">se · min · max · soma · media · arred · abs · teto · piso</p>
              <p className="font-mono">texto · numero · maiusc · minusc · concat · substituir · contem</p>
              <p className="font-mono">tamanho · primeiro · ultimo</p>
              <p>
                Não há como abrir rede, ler arquivo ou fazer laço — essas operações não existem na linguagem. Para isso, use uma Ferramenta
                personalizada, que roda no seu servidor.
              </p>
            </div>
          </details>
        </div>
      )}

      {draft.kind === 'tool' && (
        <div className="space-y-2 rounded-lg border border-(--border-subtle) p-3" data-testid="tool-picker">
          <label className="block text-sm text-(--text-muted)" htmlFor="tool-app">
            App conectado
          </label>
          <select
            id="tool-app"
            value={draft.appKey}
            onChange={(e) => set({ appKey: e.target.value, actionKey: '' })}
            className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
            data-testid="tool-app"
          >
            <option value="">Escolha um App</option>
            {appsComAcao
              .filter((a) => conectados.has(a.appKey))
              .map((a) => (
                <option key={a.appKey} value={a.appKey}>
                  {a.appName}
                </option>
              ))}
          </select>
          {/*
            Nenhum App conectado não é um formulário vazio: é um caminho. Sem isto, quem
            escolhe "App / Ferramenta" fica olhando uma lista sem opção e sem saber o que
            fazer a respeito.
          */}
          {appsComAcao.filter((a) => conectados.has(a.appKey)).length === 0 && (
            <p className="text-xs text-(--text-muted)" data-testid="tool-none-connected">
              Nenhum App conectado nesta conta.{' '}
              <Link to="/apps" className="underline">
                Conectar um App
              </Link>
            </p>
          )}
          {draft.appKey && (
            <>
              <label className="block text-sm text-(--text-muted)" htmlFor="tool-action">
                Ação
              </label>
              <select
                id="tool-action"
                value={draft.actionKey}
                onChange={(e) => {
                  set({ actionKey: e.target.value })
                  const acao = acoesDoApp.find((a) => a.actionKey === e.target.value)
                  // A ação declara o que RECEBE. O que ela devolve é o corpo de um
                  // terceiro, e o manifesto quase nunca sabe a forma dele.
                  onContractDerived?.({ inputJsonSchema: acao?.inputSchema ?? null, outputJsonSchema: null })
                }}
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                data-testid="tool-action"
              >
                <option value="">Escolha a ação</option>
                {acoesDoApp.map((a) => (
                  <option key={a.actionKey} value={a.actionKey}>
                    {a.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {acaoEscolhida && (
            <div className="rounded-md border border-(--border-subtle) p-2 text-xs text-(--text-muted)" data-testid="tool-detail">
              <p>
                {acaoEscolhida.appName} · {acaoEscolhida.name}
              </p>
              <p className="mt-1">{acaoEscolhida.description}</p>
              <p className="mt-1">Recebe: {campos(acaoEscolhida.inputSchema) || '—'}</p>
              <p>Devolve: {campos(acaoEscolhida.outputSchema) || '—'}</p>
              {/*
                O aviso só quando ele é VERDADE. Mostrá-lo com o schema presente ensinava o
                contrário do que o sistema faz, e quem lesse acreditaria.
              */}
              {!acaoEscolhida.outputSchema && (
                <p className="mt-1 text-(--text-faint)" data-testid="tool-no-output-contract">
                  Esta ação não declara o formato da resposta: a saída fica como texto até que o App declare um.
                </p>
              )}
              {/* A credencial vive na conexão, cifrada. Ela não passa por esta tela. */}
              <p className="mt-1 text-(--text-faint)">A credencial fica na conexão do App e não aparece aqui.</p>
            </div>
          )}
        </div>
      )}

      <fieldset disabled={disabled} className="space-y-2">
        {/* A seção já diz "quem faz o trabalho — e o que ele devolve". Aqui basta o
            rótulo; repetir a frase seria a mesma ideia em duas redações. */}
        <legend className="mb-1 text-sm text-(--text-muted)">O que ele devolve</legend>
        {modosPossiveis.length === 1 && (
          <p className="text-xs text-(--text-faint)" data-testid="response-mode-forced">
            {draft.kind === 'function'
              ? 'Isto calcula e produz dados. Para uma resposta escrita, encadeie um agente de IA que apresente o resultado.'
              : 'Esta ação não declara o formato da resposta, então a saída fica como texto.'}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          {MODOS.filter((m) => modosPossiveis.includes(m.modo)).map((m) => (
            <label
              key={m.modo}
              data-testid={`response-mode-${m.modo}`}
              className={`cursor-pointer rounded-lg border p-3 text-left ${
                draft.responseMode === m.modo ? 'border-(--border-focus)' : 'border-(--border-subtle)'
              }`}
            >
              <input
                type="radio"
                name="response-mode"
                value={m.modo}
                checked={draft.responseMode === m.modo}
                onChange={() => set({ responseMode: m.modo })}
                className="sr-only"
                data-testid={`response-mode-${m.modo}-input`}
              />
              <span className="block text-sm font-medium">{m.titulo}</span>
              <span className="mt-1 block text-xs text-(--text-faint)">{m.quando}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}

/** Os nomes dos campos de um schema, com `*` no obrigatório. Nomes, nunca valores. */
function campos(schema: Record<string, unknown> | null | undefined): string {
  const props = schema?.properties
  if (!props || typeof props !== 'object' || Array.isArray(props)) return ''
  const required = new Set(Array.isArray(schema?.required) ? (schema!.required as string[]) : [])
  return Object.keys(props as object)
    .map((c) => (required.has(c) ? `${c}*` : c))
    .join(', ')
}
