import { useMemo, useState, type ReactNode } from 'react'
import type { CatalogFunction } from '../lib/apps'
import { Icon } from '../ui'

// O SELETOR DE FUNÇÃO — um só, para o agente e para o conjunto de dados.
//
// Ele nasceu dentro do formulário de agente e ficou preso lá: as trinta e poucas funções do
// registro só existiam para quem estava contratando alguém. O dono olhou a lista e perguntou
// "não são essas funções? quero o mesmo no database" — e estava certo duas vezes: são as
// mesmas funções, e não havia motivo para a tela ser outra.
//
// A mudança de forma veio junto. Antes, escolher uma função abria os campos dela LÁ EMBAIXO,
// depois de vinte e sete cards: quem clicava não via nada acontecer. Agora o card escolhido
// ABRE, e os campos aparecem dentro dele, onde a pessoa está olhando.

/** O prefixo antes do ponto: `lista.agrupar` → `lista`. É como as funções já se agrupam. */
export const familiaDe = (nome: string): string => (nome.includes('.') ? nome.split('.')[0] : 'geral')

const FAMILIA_LABEL: Record<string, string> = {
  lista: 'Listas e tabelas',
  json: 'Objetos e campos',
  texto: 'Texto',
  dados: 'Conferência de dados',
  math: 'Cálculo',
  registros: 'Registros e consultas',
  serie: 'Séries',
  valores: 'Comparações',
  financeiro: 'Financeiro',
  data: 'Datas',
  br: 'Documentos brasileiros',
  regra: 'Regras e faixas',
  liveData: 'Dado ao vivo',
  data_history: 'Histórico',
  realtime_data: 'Tempo real do agente',
  geral: 'Outras',
}

export const rotuloDaFamilia = (familia: string): string => FAMILIA_LABEL[familia] ?? familia

export interface FunctionPickerProps {
  funcoes: CatalogFunction[]
  /** O nome da função escolhida, ou vazio. */
  escolhida: string
  onEscolher: (f: CatalogFunction) => void
  /**
   * O que aparece DENTRO do card escolhido.
   *
   * É o que muda entre os dois usos: no agente, os parâmetros fixos; no conjunto, qual campo
   * ler e qual número vira a coluna. A lista é a mesma; o que se preenche depois, não.
   */
  detalhe?: (f: CatalogFunction) => ReactNode
  /** Só estas famílias entram na lista. Vazio = todas. */
  familiasPermitidas?: string[]
  idPrefixo?: string
}

export function FunctionPicker({ funcoes, escolhida, onEscolher, detalhe, familiasPermitidas, idPrefixo = 'function' }: FunctionPickerProps) {
  const [busca, setBusca] = useState('')
  const [familias, setFamilias] = useState<Set<string>>(new Set())
  const [filtroAberto, setFiltroAberto] = useState(false)
  const filtro = busca.trim().toLowerCase()

  const doEscopo = useMemo(
    () => (familiasPermitidas?.length ? funcoes.filter((f) => familiasPermitidas.includes(familiaDe(f.functionName))) : funcoes),
    [funcoes, familiasPermitidas],
  )

  /**
   * As famílias possíveis vêm da lista INTEIRA, não da filtrada.
   *
   * Derivá-las do que está visível faria a opção sumir no instante em que fosse escolhida — e
   * aí não haveria como desmarcá-la.
   */
  const familiasDisponiveis = useMemo(() => [...new Set(doEscopo.map((f) => familiaDe(f.functionName)))], [doEscopo])

  const alternarFamilia = (familia: string) =>
    setFamilias((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(familia)) proximo.delete(familia)
      else proximo.add(familia)
      return proximo
    })

  const visiveis = useMemo(
    () =>
      doEscopo.filter(
        (f) =>
          // Nenhuma família escolhida quer dizer TODAS — é o que "sem filtro" significa.
          (familias.size === 0 || familias.has(familiaDe(f.functionName))) &&
          (!filtro ||
            f.functionName.toLowerCase().includes(filtro) ||
            f.description.toLowerCase().includes(filtro) ||
            f.capabilities.some((c) => c.toLowerCase().includes(filtro))),
      ),
    [doEscopo, filtro, familias],
  )

  const porFamilia = useMemo(() => {
    const mapa = new Map<string, CatalogFunction[]>()
    for (const f of visiveis) {
      const familia = familiaDe(f.functionName)
      const atual = mapa.get(familia)
      if (atual) atual.push(f)
      else mapa.set(familia, [f])
    }
    return [...mapa.entries()]
  }, [visiveis])

  return (
    <div className="flex flex-col gap-2">
      {/*
        Uma LISTA, e nunca uma caixa de texto livre.
        O que executa é código deste servidor; quem escolhe guarda o nome. Um campo onde se
        cola um trecho seria a porta de execução arbitrária que o resto do sistema existe
        para fechar.
      */}
      <div className="flex items-center gap-2">
        <input
          id={`${idPrefixo}-search`}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar por nome, descrição ou capacidade"
          className="min-w-0 flex-1 rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
          data-testid={`${idPrefixo}-search`}
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
          data-testid={`${idPrefixo}-filter`}
        >
          <Icon name="list-filter" size={16} />
          {/* O número no botão: com o painel fechado, é a única pista de que há filtro
              ativo — e sem ela a lista parece incompleta sem motivo. */}
          {familias.size > 0 && <span className="font-semibold">{familias.size}</span>}
        </button>
      </div>

      {filtroAberto && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-(--border-subtle) p-2" data-testid={`${idPrefixo}-filter-panel`}>
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
                data-testid={`${idPrefixo}-filter-${familia}`}
              >
                {rotuloDaFamilia(familia)}
              </button>
            )
          })}
          {familias.size > 0 && (
            <button
              type="button"
              onClick={() => setFamilias(new Set())}
              className="ml-auto rounded-full px-2 py-1 text-xs text-(--text-muted) underline"
              data-testid={`${idPrefixo}-filter-clear`}
            >
              Limpar
            </button>
          )}
        </div>
      )}

      {/* Agrupadas por família: com quase trinta funções, uma lista corrida obriga a ler
          todas para achar a que serve. O prefixo já dizia o grupo. */}
      <div className="max-h-96 space-y-3 overflow-y-auto" data-testid={`${idPrefixo}-list`}>
        {visiveis.length === 0 && <p className="p-2 text-xs text-(--text-faint)">Nenhuma função encontrada.</p>}
        {porFamilia.map(([familia, doGrupo]) => (
          <div key={familia} className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-(--text-faint)">{rotuloDaFamilia(familia)}</p>
            {/*
              O card escolhido ocupa a LARGURA INTEIRA.
              Ele deixou de ser um botão e virou um painel com campos dentro; espremido em meia
              coluna, os campos ficariam com dois centímetros cada.
            */}
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {doGrupo.map((f) => {
                const estaEscolhida = escolhida === f.functionName
                return (
                  <div
                    key={f.functionName}
                    className={`flex h-full flex-col gap-1 rounded-lg border p-2.5 text-left transition ${
                      estaEscolhida ? 'border-(--border-focus) bg-(--surface-sunken) sm:col-span-2' : 'border-(--border-subtle) hover:border-(--border-strong)'
                    }`}
                    data-testid={`${idPrefixo}-card-${f.functionName}`}
                  >
                    <button
                      type="button"
                      onClick={() => onEscolher(f)}
                      aria-pressed={estaEscolhida}
                      aria-expanded={estaEscolhida}
                      className="flex flex-col gap-1 text-left"
                      data-testid={`${idPrefixo}-option-${f.functionName}`}
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
                    </button>
                    {/*
                      OS CAMPOS DA FUNÇÃO ESCOLHIDA, aqui dentro.
                      Eles ficavam no fim do formulário, depois de vinte e sete cards: quem
                      clicava não via nada acontecer, e o passo seguinte estava fora da tela.
                    */}
                    {estaEscolhida && detalhe && (
                      <div className="mt-1 border-t border-(--border-subtle) pt-2" data-testid={`${idPrefixo}-detail-${f.functionName}`}>
                        {detalhe(f)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
