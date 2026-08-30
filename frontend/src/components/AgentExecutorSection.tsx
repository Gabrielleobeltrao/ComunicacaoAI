import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { listExecutorCatalog, listInstallations } from '../lib/apps'
import type { CatalogAction, CatalogFunction, AppInstallation } from '../lib/apps'
import type { ExecutorKind, ResponseMode } from '../lib/types'
import { Icon } from '../ui'

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

/**
 * Um exemplo de chamada, DERIVADO do schema da própria função.
 *
 * Escrever um exemplo à mão para cada função seria melhor de ler e pior de manter: são
 * quase trinta, e no dia em que um schema mudasse o exemplo passaria a ensinar o
 * errado — que é pior do que não ter exemplo. Derivando, ele nunca desatualiza.
 *
 * A descrição de cada campo costuma trazer um "Ex.: BTCUSDT"; quando traz, é ele que
 * aparece. É de graça e é o valor que quem escreveu o schema achou representativo.
 */
function exemploDe(schema: unknown): string | null {
  const s = (schema ?? {}) as { properties?: Record<string, unknown>; required?: unknown }
  const props = s.properties
  if (!props || typeof props !== 'object') return null
  const obrigatorios = Array.isArray(s.required) ? (s.required as string[]) : []
  // Os obrigatórios primeiro; sem eles, os primeiros declarados. Um exemplo com dez
  // campos não é exemplo, é despejo.
  const nomes = (obrigatorios.length ? obrigatorios : Object.keys(props)).slice(0, 4)
  const corpo: Record<string, unknown> = {}
  for (const nome of nomes) {
    const def = (props[nome] ?? {}) as { type?: string; enum?: unknown[]; description?: string; items?: unknown }
    corpo[nome] = valorDeExemplo(def)
  }
  return Object.keys(corpo).length ? JSON.stringify(corpo, null, 2) : null
}

function valorDeExemplo(def: { type?: string; enum?: unknown[]; description?: string; items?: unknown }): unknown {
  if (Array.isArray(def.enum) && def.enum.length) return def.enum[0]
  // "Ex.: BTCUSDT" na descrição é o exemplo que o autor do schema já escolheu.
  const daDescricao = /Ex\.?:\s*([^.\n]{1,40})/i.exec(def.description ?? '')
  if (daDescricao && def.type !== 'number' && def.type !== 'integer') return daDescricao[1].trim().replace(/^["']|["']$/g, '')
  if (def.type === 'number' || def.type === 'integer') return 10
  if (def.type === 'boolean') return true
  if (def.type === 'array') return [valorDeExemplo((def.items ?? {}) as { type?: string })]
  if (def.type === 'object') return {}
  return 'valor'
}

/** O prefixo antes do ponto: `lista.agrupar` → `lista`. É como as funções já se agrupam. */
const familiaDe = (nome: string): string => (nome.includes('.') ? nome.split('.')[0] : 'geral')

const FAMILIA_LABEL: Record<string, string> = {
  lista: 'Listas e tabelas',
  json: 'Objetos e campos',
  texto: 'Texto',
  dados: 'Conferência de dados',
  math: 'Cálculo',
  financeiro: 'Financeiro',
  data: 'Datas',
  br: 'Documentos brasileiros',
  regra: 'Regras e faixas',
  liveData: 'Dado ao vivo',
  data_history: 'Histórico',
  realtime_data: 'Tempo real do agente',
  geral: 'Outras',
}

const TIPOS: { kind: ExecutorKind; titulo: string; resumo: string }[] = [
  { kind: 'llm', titulo: 'IA / LLM', resumo: 'Um modelo lê o pedido e responde. É como todo agente sempre funcionou.' },
  { kind: 'function', titulo: 'Função do sistema', resumo: 'Um cálculo determinístico do servidor. Mesma entrada, mesma saída, sem custo de modelo.' },
  { kind: 'tool', titulo: 'App / Ferramenta', resumo: 'Uma ação de um App conectado. O agente executa; ele não conversa sobre isso.' },
]

const MODOS: { modo: ResponseMode; titulo: string; quando: string }[] = [
  { modo: 'structured', titulo: 'Dados estruturados', quando: 'Quando outra etapa ou um sistema consome o resultado.' },
  { modo: 'text', titulo: 'Texto', quando: 'Quando uma pessoa lê a resposta.' },
  { modo: 'structured_and_text', titulo: 'Dados + texto', quando: 'Quando os dois acontecem: um sistema consome e alguém lê.' },
]

export interface ExecutorDraft {
  kind: ExecutorKind
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
  if (kind === 'function') return ['structured']
  if (kind === 'tool') return temSchemaDeSaida ? ['structured', 'text', 'structured_and_text'] : ['text']
  return ['structured', 'text', 'structured_and_text']
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
  /**
   * O filtro por FAMÍLIA, ao lado da busca.
   *
   * Buscar serve para quem já sabe o nome ou uma palavra da descrição. Filtrar serve
   * para o caso oposto — "o que existe para mexer em lista?" —, que é a pergunta de
   * quem está montando o agente pela primeira vez. As duas coisas somam: o filtro
   * estreita o conjunto, a busca procura dentro dele.
   */
  const [familias, setFamilias] = useState<Set<string>>(new Set())
  const [filtroAberto, setFiltroAberto] = useState(false)

  /**
   * As famílias possíveis vêm da lista INTEIRA, não da filtrada.
   *
   * Derivá-las do que está visível faria a opção sumir no instante em que fosse
   * escolhida — e aí não haveria como desmarcá-la.
   */
  const familiasDisponiveis = useMemo(() => [...new Set(funcoes.map((f) => familiaDe(f.functionName)))], [funcoes])

  const alternarFamilia = (familia: string) =>
    setFamilias((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(familia)) proximo.delete(familia)
      else proximo.add(familia)
      return proximo
    })
  const funcoesVisiveis = useMemo(
    () =>
      funcoes.filter(
        (f) =>
          // Nenhuma família escolhida quer dizer TODAS — é o que "sem filtro" significa.
          (familias.size === 0 || familias.has(familiaDe(f.functionName))) &&
          (!filtro ||
            f.functionName.toLowerCase().includes(filtro) ||
            f.description.toLowerCase().includes(filtro) ||
            f.capabilities.some((c) => c.toLowerCase().includes(filtro))),
      ),
    [funcoes, filtro, familias],
  )

  /**
   * As visíveis, agrupadas por família e na ordem em que as famílias aparecem.
   *
   * Ordem de aparição, e não alfabética: a lista já chega ordenada por nome do servidor,
   * então "cálculo" antes de "datas" é o que a pessoa vê nas duas telas. Reordenar aqui
   * criaria uma segunda ordem para a mesma coisa.
   */
  const porFamilia = useMemo(() => {
    const mapa = new Map<string, CatalogFunction[]>()
    for (const f of funcoesVisiveis) {
      const familia = familiaDe(f.functionName)
      const atual = mapa.get(familia)
      if (atual) atual.push(f)
      else mapa.set(familia, [f])
    }
    return [...mapa.entries()]
  }, [funcoesVisiveis])
  const escolhida = funcoes.find((f) => f.functionName === draft.functionName) ?? null
  const appsComAcao = useMemo(() => [...new Map(acoes.map((a) => [a.appKey, a])).values()], [acoes])
  const acoesDoApp = acoes.filter((a) => a.appKey === draft.appKey)
  const acaoEscolhida = acoesDoApp.find((a) => a.actionKey === draft.actionKey) ?? null

  const set = (parcial: Partial<ExecutorDraft>) => onChange({ ...draft, ...parcial })

  // O que este executor CONSEGUE devolver — não o que alguém gostaria.
  const temSchemaDeSaida = draft.kind === 'function' ? true : Boolean(acaoEscolhida?.outputSchema)
  const modosPossiveis = modesFor(draft.kind, temSchemaDeSaida)
  const parametros = configFields(escolhida?.configSchema)

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
          <div className="flex items-center gap-2">
            <input
              id="function-search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Procurar por nome, descrição ou capacidade"
              className="min-w-0 flex-1 rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              data-testid="function-search"
            />
            <button
              type="button"
              onClick={() => setFiltroAberto((v) => !v)}
              aria-expanded={filtroAberto}
              aria-label={familias.size ? `Filtrar por tipo (${familias.size} ativo(s))` : 'Filtrar por tipo'}
              title="Filtrar por tipo"
              className={`ds-hit flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-2 text-xs ${
                familias.size ? 'border-(--border-focus) text-(--intent-brand)' : 'border-(--border-strong) text-(--text-muted)'
              }`}
              data-testid="function-filter"
            >
              <Icon name="list-filter" size={16} />
              {/* O número no botão: com o painel fechado, é a única pista de que há
                  filtro ativo — e sem ela a lista parece incompleta sem motivo. */}
              {familias.size > 0 && <span className="font-semibold">{familias.size}</span>}
            </button>
          </div>

          {filtroAberto && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-(--border-subtle) p-2" data-testid="function-filter-panel">
              {familiasDisponiveis.map((familia) => {
                const ativa = familias.has(familia)
                return (
                  <button
                    key={familia}
                    type="button"
                    onClick={() => alternarFamilia(familia)}
                    aria-pressed={ativa}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      ativa ? 'border-(--border-focus) bg-(--surface-sunken) font-semibold' : 'border-(--border-subtle) text-(--text-muted)'
                    }`}
                    data-testid={`function-filter-${familia}`}
                  >
                    {FAMILIA_LABEL[familia] ?? familia}
                  </button>
                )
              })}
              {familias.size > 0 && (
                <button
                  type="button"
                  onClick={() => setFamilias(new Set())}
                  className="ml-auto rounded-full px-2 py-1 text-xs text-(--text-muted) underline"
                  data-testid="function-filter-clear"
                >
                  Limpar
                </button>
              )}
            </div>
          )}
          {/* Agrupadas por família: com quase trinta funções, uma lista corrida obriga a
              ler todas para achar a que serve. O prefixo já dizia o grupo — só não
              estava sendo usado. */}
          <div className="max-h-96 space-y-3 overflow-y-auto" data-testid="function-list">
            {funcoesVisiveis.length === 0 && <p className="p-2 text-xs text-(--text-faint)">Nenhuma função encontrada.</p>}
            {porFamilia.map(([familia, doGrupo]) => (
              <div key={familia} className="space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-(--text-faint)">{FAMILIA_LABEL[familia] ?? familia}</p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {doGrupo.map((f) => {
                    const escolhidaAqui = draft.functionName === f.functionName
                    const exemplo = exemploDe(f.inputSchema)
                    return (
                      <button
                        key={f.functionName}
                        type="button"
                        onClick={() => {
                          set({ functionName: f.functionName, functionVersion: f.version })
                          onContractDerived?.({ inputJsonSchema: f.inputSchema, outputJsonSchema: f.outputSchema })
                        }}
                        aria-pressed={escolhidaAqui}
                        className={`flex h-full flex-col gap-1 rounded-lg border p-2.5 text-left transition ${
                          escolhidaAqui ? 'border-(--border-focus) bg-(--surface-sunken)' : 'border-(--border-subtle) hover:border-(--border-strong)'
                        }`}
                        data-testid={`function-option-${f.functionName}`}
                      >
                        <span className="font-mono text-xs font-semibold">{f.functionName}</span>
                        <span className="text-xs text-(--text-muted)">{f.description}</span>
                        {f.capabilities?.length > 0 && (
                          <span className="flex flex-wrap gap-1">
                            {f.capabilities.slice(0, 3).map((c) => (
                              <span key={c} className="rounded-full bg-(--surface-sunken) px-1.5 py-0.5 text-[10px] text-(--text-faint)">
                                {c}
                              </span>
                            ))}
                          </span>
                        )}
                        {/* O exemplo só aparece no card ESCOLHIDO: em todos, vinte e sete
                            blocos de JSON viram parede de texto e ninguém lê nenhum. */}
                        {escolhidaAqui && exemplo && (
                          <pre
                            className="mt-0.5 overflow-x-auto rounded bg-(--surface-sunken) p-1.5 text-[10.5px] leading-tight"
                            data-testid={`function-example-${f.functionName}`}
                          >
                            {exemplo}
                          </pre>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
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
              ? 'Uma função produz dados. Para uma resposta escrita, encadeie um agente de IA que apresente o resultado.'
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
