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
}

/** O que impede de salvar. Vazio = coerente. */
export function executorProblems(d: ExecutorDraft): string[] {
  const problemas: string[] = []
  if (d.kind === 'function' && !d.functionName) problemas.push('Escolha a função que este agente executa.')
  if (d.kind === 'tool' && !(d.appKey && d.actionKey)) problemas.push('Escolha o App e a ação que este agente executa.')
  return problemas
}

export function AgentExecutorSection({
  draft,
  onChange,
  disabled,
}: {
  draft: ExecutorDraft
  onChange: (d: ExecutorDraft) => void
  disabled?: boolean
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

  return (
    <div className="space-y-4" data-testid="executor-section">
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="mb-1 text-sm text-(--text-muted)">Como este agente executa?</legend>
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
                  onClick={() => set({ functionName: f.functionName, functionVersion: f.version })}
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
                onChange={(e) => set({ actionKey: e.target.value })}
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
              {/* A credencial vive na conexão, cifrada. Ela não passa por esta tela. */}
              <p className="mt-1 text-(--text-faint)">A credencial fica na conexão do App e não aparece aqui.</p>
            </div>
          )}
        </div>
      )}

      <fieldset disabled={disabled} className="space-y-2">
        <legend className="mb-1 text-sm text-(--text-muted)">O que ele devolve</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODOS.map((m) => (
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
