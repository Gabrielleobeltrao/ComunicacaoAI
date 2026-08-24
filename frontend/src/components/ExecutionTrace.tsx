import { useMemo, useState } from 'react'
import { ExecutionAudit } from './ExecutionAudit'
import { duracaoTotal, filtrarEventos, formatarDuracao, tokensDaTrilha } from '../lib/executionTrace'
import type { TraceEvent, TraceFilter } from '../lib/executionTrace'

// O caminho da execução, enquanto ela acontece.
//
// A resposta de um time é um texto; o que ela NÃO conta é como chegou ali — quem foi
// escolhido, o que foi pedido a cada um, o que a base devolveu, onde demorou, onde
// falhou. Isso existia só no log do servidor, ou seja, para quem tem acesso ao servidor.
//
// O que este painel mostra é o que ACONTECEU: decisão, instrução operacional, resultado.
// Nunca o raciocínio privado do modelo, e nunca credencial — o servidor não emite nem uma
// coisa nem outra, e aqui só se desenha o que chegou.

const CARA: Record<TraceEvent['type'], { icone: string; cor: string; rotulo: string }> = {
  user_prompt: { icone: '💬', cor: 'var(--text-muted)', rotulo: 'Pedido' },
  orchestration_start: { icone: '▶', cor: 'var(--intent-brand)', rotulo: 'Início' },
  planner: { icone: '🧭', cor: 'var(--grape-600)', rotulo: 'Planejamento' },
  agent: { icone: '🤖', cor: 'var(--intent-brand)', rotulo: 'Agente' },
  delegation: { icone: '↔', cor: 'var(--sky-600)', rotulo: 'Delegação' },
  tool: { icone: '🔧', cor: 'var(--mango-600)', rotulo: 'Ferramenta' },
  rag: { icone: '📚', cor: 'var(--mint-600)', rotulo: 'Base' },
  /* Ícone, cor e rótulo próprios: ler a base é local e de graça; ir para a internet gasta
     uma requisição da franquia e traz a página de um terceiro. Com a mesma cara, o painel
     escondia justamente a diferença que custa. */
  web_search: { icone: '🌐', cor: 'var(--sky-600)', rotulo: 'Busca na web' },
  synthesis: { icone: '🧩', cor: 'var(--grape-600)', rotulo: 'Consolidação' },
  sufficiency: { icone: '❓', cor: 'var(--mango-600)', rotulo: 'Suficiência' },
  orchestration_end: { icone: '■', cor: 'var(--text-muted)', rotulo: 'Fim' },
  final: { icone: '✓', cor: 'var(--mint-600)', rotulo: 'Resposta' },
  error: { icone: '⚠', cor: 'var(--coral-600)', rotulo: 'Erro' },
}

const FILTROS: { chave: TraceFilter; rotulo: string }[] = [
  { chave: 'all', rotulo: 'Tudo' },
  { chave: 'planner', rotulo: 'Plano' },
  { chave: 'agents', rotulo: 'Agentes' },
  { chave: 'tools', rotulo: 'Ferramentas' },
  { chave: 'rag', rotulo: 'Base' },
  { chave: 'web', rotulo: 'Web' },
  { chave: 'errors', rotulo: 'Erros' },
]

const duracao = formatarDuracao
const hora = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour12: false })
}
const texto = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

function Detalhe({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-1.5">
      <div className="text-[10px] font-semibold tracking-wide text-(--text-faint) uppercase">{rotulo}</div>
      <div className="mt-0.5 text-xs text-(--text-body)">{children}</div>
    </div>
  )
}

/**
 * A busca, contada como ela acontece: um FUNIL.
 *
 * O buscador devolve dezenas; poucos são escolhidos; menos ainda abrem; e de alguns sai
 * texto aproveitável. Quando a resposta vem fraca, a pergunta é sempre em qual desses
 * degraus ela afinou — e a lista de chave/valor genérica não respondia, porque tratava
 * "encontrados", "lidos" e "evidências" como três números sem relação entre si.
 */
function DetalheDaBusca({ meta }: { meta: Record<string, unknown> }) {
  const n = (v: unknown): number => (typeof v === 'number' ? v : Array.isArray(v) ? v.length : 0)
  const degraus = [
    { rotulo: 'encontrados', valor: n(meta.found) },
    { rotulo: 'escolhidos', valor: n(meta.selected) },
    { rotulo: 'abertos', valor: n(meta.read) },
    { rotulo: 'com evidência', valor: n(meta.evidence) },
  ]
  const maior = Math.max(1, ...degraus.map((d) => d.valor))
  const paginas = Array.isArray(meta.read) ? (meta.read as { url: string; ok: boolean; code?: string }[]) : []

  return (
    <div className="mb-2" data-testid="trace-web-search">
      <div className="grid gap-1">
        {degraus.map((d) => (
          <div key={d.rotulo} className="grid grid-cols-[88px_1fr_28px] items-center gap-2">
            <span className="text-[10px] text-(--text-faint)">{d.rotulo}</span>
            <span className="h-1.5 rounded-full bg-(--border-subtle)">
              <span
                className="block h-1.5 rounded-full"
                style={{ width: `${(d.valor / maior) * 100}%`, background: 'var(--sky-600)' }}
              />
            </span>
            <span className="text-right text-[11px] tabular-nums text-(--text-body)">{d.valor}</span>
          </div>
        ))}
      </div>
      {/* O endereço de cada página e se ela abriu. Um site que bloqueia leitura é a causa
          mais comum de "buscou e não trouxe nada", e sem isto ele fica invisível. */}
      {paginas.length > 0 && (
        <ul className="mt-2 space-y-0.5" data-testid="trace-web-pages">
          {paginas.slice(0, 8).map((p, i) => (
            <li key={`${p.url}-${i}`} className="flex items-baseline gap-1.5 text-[11px]">
              <span aria-hidden style={{ color: p.ok ? 'var(--mint-600)' : 'var(--coral-600)' }}>
                {p.ok ? '✓' : '✕'}
              </span>
              <span className="min-w-0 flex-1 truncate text-(--text-muted)">{p.url}</span>
              {!p.ok && p.code ? <span className="text-(--text-faint)">{p.code}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {typeof meta.provider === 'string' && (
        <p className="mt-1.5 text-[10px] text-(--text-faint)">
          via {meta.provider}
          {typeof meta.reason === 'string' ? ` · ${meta.reason}` : ''}
        </p>
      )}
    </div>
  )
}

function Evento({ evento }: { evento: TraceEvent }) {
  const [aberto, setAberto] = useState(false)
  const cara = CARA[evento.type] ?? CARA.error
  const erro = evento.status === 'error'
  const meta = (evento.metadata ?? {}) as Record<string, unknown>
  const temDetalhe = evento.input !== undefined || evento.output !== undefined || Object.keys(meta).length > 0

  return (
    <li className="relative pl-6" data-testid="trace-event" data-type={evento.type} data-status={evento.status ?? ''}>
      {/* A linha do tempo: o fio que liga um evento ao seguinte. */}
      <span className="absolute top-5 bottom-0 left-[7px] w-px bg-(--border-subtle)" aria-hidden />
      <span className="absolute top-1 left-0 text-xs" style={{ color: erro ? 'var(--coral-600)' : cara.cor }} aria-hidden>
        {erro ? '⚠' : cara.icone}
      </span>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        disabled={!temDetalhe}
        aria-expanded={aberto}
        className="w-full text-left disabled:cursor-default"
        data-testid="trace-event-toggle"
      >
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-(--text-heading)">{evento.title}</span>
          {evento.status === 'running' && <span className="text-[10px] text-(--text-faint)">em execução…</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-(--text-faint)">
          <span>{hora(evento.timestamp)}</span>
          <span>· {cara.rotulo}</span>
          {evento.durationMs !== undefined && <span>· {duracao(evento.durationMs)}</span>}
          {evento.model && <span>· {evento.model}</span>}
          {temDetalhe && <span>· {aberto ? 'menos' : 'detalhes'}</span>}
        </div>
      </button>
      {aberto && temDetalhe && (
        <div className="mt-1 mb-2 rounded-lg border border-(--border-subtle) bg-(--surface-sunken) p-2" data-testid="trace-event-detail">
          {evento.type === 'web_search' && <DetalheDaBusca meta={meta} />}
          {evento.input !== undefined && (
            <Detalhe rotulo={evento.type === 'tool' ? 'Parâmetros' : 'Entrada'}>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px]">{texto(evento.input)}</pre>
            </Detalhe>
          )}
          {evento.output !== undefined && (
            <Detalhe rotulo="Resultado">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px]">{texto(evento.output)}</pre>
            </Detalhe>
          )}
          {Object.entries(meta).map(([chave, valor]) =>
            valor === null || valor === undefined || (Array.isArray(valor) && valor.length === 0) ? null : (
              <Detalhe key={chave} rotulo={chave}>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px]">{texto(valor)}</pre>
              </Detalhe>
            ),
          )}
        </div>
      )}
    </li>
  )
}

export function ExecutionTrace({ events, live, onClear }: { events: TraceEvent[]; live: boolean; onClear: () => void }) {
  const [filtro, setFiltro] = useState<TraceFilter>('all')
  // A auditoria é um FILTRO como os outros: os mesmos eventos, lidos por quem investiga em
  // vez de por quem acompanha. Uma tela separada obrigaria a sair da execução para
  // entendê-la, e a voltar para conferir o que se entendeu.
  const [aba, setAba] = useState<'trilha' | 'auditoria'>('trilha')
  const visiveis = useMemo(() => filtrarEventos(events, filtro), [events, filtro])
  const total = useMemo(() => duracaoTotal(events), [events])
  const tokens = useMemo(() => tokensDaTrilha(events), [events])

  return (
    <div className="flex h-96 min-w-0 flex-col rounded-lg border border-(--border-subtle) bg-(--surface-card)/50" style={{ contain: 'inline-size' }} data-testid="execution-trace">
      <div className="flex flex-wrap items-center gap-2 border-b border-(--border-subtle) px-3 py-2">
        <span className="text-xs font-semibold text-(--text-heading)">Execution Trace</span>
        {live && (
          <span className="rounded-full bg-(--coral-600) px-1.5 py-0.5 text-[10px] font-bold text-white" data-testid="trace-live">
            AO VIVO
          </span>
        )}
        <span className="ml-auto text-[10px] text-(--text-faint)">
          {events.length > 0 ? `${events.length} evento(s)${total ? ` · ${duracao(total)}` : ''}${tokens ? ` · ${tokens} tokens` : ''}` : ''}
        </span>
        {events.length > 0 && (
          <button type="button" onClick={onClear} className="text-[10px] text-(--text-muted) underline" data-testid="trace-clear">
            Limpar
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1 border-b border-(--border-subtle) px-3 py-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            type="button"
            onClick={() => {
              setFiltro(f.chave)
              setAba('trilha')
            }}
            data-testid={`trace-filter-${f.chave}`}
            className={`rounded-full px-2 py-0.5 text-[10px] ${aba === 'trilha' && filtro === f.chave ? 'bg-(--intent-brand) text-(--text-on-brand)' : 'text-(--text-muted)'}`}
          >
            {f.rotulo}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAba('auditoria')}
          data-testid="trace-filter-audit"
          aria-pressed={aba === 'auditoria'}
          className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${aba === 'auditoria' ? 'bg-(--intent-brand) text-(--text-on-brand)' : 'text-(--text-muted)'}`}
        >
          Auditoria
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {aba === 'auditoria' ? (
          <ExecutionAudit events={events} />
        ) : events.length === 0 ? (
          <p className="text-xs text-(--text-muted)">
            Mande uma mensagem: cada passo da execução aparece aqui — quem foi escolhido, o que foi pedido a cada agente, o que a base
            devolveu e onde o tempo foi gasto.
          </p>
        ) : visiveis.length === 0 ? (
          <p className="text-xs text-(--text-muted)">Nenhum evento neste filtro.</p>
        ) : (
          <ol className="space-y-2">
            {visiveis.map((evento, i) => (
              <Evento key={`${evento.timestamp}-${i}`} evento={evento} />
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
