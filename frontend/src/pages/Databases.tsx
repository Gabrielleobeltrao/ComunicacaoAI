import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { ListaDePastas } from '../components/PastaDeDados'
import { Badge, Button, Card, Dialog, IconButton, Input, Textarea } from '../ui'
import * as api from '../lib/databases'
import { createComputedColumn, deleteComputedColumn } from '../lib/databases'
import { DatabaseGrants } from '../components/DatabaseGrants'
import { FunctionPicker } from '../components/FunctionPicker'
import { listExecutorCatalog } from '../lib/apps'
import type { CatalogFunction } from '../lib/apps'
import type { DatabaseDetail, DatasetSummary, QueryResult } from '../lib/databases'

// DATABASES — o sistema de registros do escritório.
//
// A tela existe para responder três coisas que ninguém conseguia responder antes: o que a
// empresa guarda, qual é a forma de cada conjunto, e quem consegue consultar. E ela diz
// ORIGEM e ATUALIZAÇÃO em voz alta — chamar dados de mercado de "memória" ou
// "conhecimento" é o começo de todo mal-entendido sobre o que o agente sabe.

export function Databases() {
  const [params, setParams] = useSearchParams()
  const aberto = params.get('id')
  /**
   * A TELA LISTA BASES.
   *
   * "E por que temos pasta e conjunto?" Na conta do dono era 1:1 — duas pastas, uma tabela em
   * cada, e o nome da pasta era a descrição da tabela lá dentro. A pasta continua existindo,
   * porque é ela que carrega a permissão e a configuração de mercado e de App; ela só deixou
   * de ser a porta de entrada. Uma pasta aparece quando alguém decidiu criá-la — o resto é
   * agrupamento que o sistema inventou por dentro, e uma caixa com uma coisa dentro é
   * cerimônia.
   */
  const [bases, setBases] = useState<api.BaseResumo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [criando, setCriando] = useState<'base' | 'pasta' | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      setBases((await api.listBases()).items)
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const abrir = (id: string | null, conjunto?: string) => {
    const p = new URLSearchParams(params)
    if (id) p.set('id', id)
    else p.delete('id')
    if (conjunto) p.set('conjunto', conjunto)
    else p.delete('conjunto')
    setParams(p, { replace: true })
  }

  const soltas = (bases ?? []).filter((b) => !b.folder)
  const pastas = [...new Map((bases ?? []).filter((b) => b.folder).map((b) => [b.folder!.id, b.folder!])).values()]

  return (
    <AppLayout current="/databases" title="Databases" subtitle="O que este escritório guarda, e quem pode consultar">
      <div className="flex flex-col gap-3">
        {erro && (
          <Card>
            <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger-text)' }} data-testid="databases-error">
              {erro}{' '}
              <button type="button" onClick={carregar} style={{ textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}>
                Tentar de novo
              </button>
            </p>
          </Card>
        )}

        {!aberto && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setCriando((v) => (v === 'base' ? null : 'base'))} data-testid="databases-new">
                {criando === 'base' ? 'Cancelar' : 'Nova base'}
              </Button>
              <Button variant="secondary" onClick={() => setCriando((v) => (v === 'pasta' ? null : 'pasta'))} data-testid="folder-new">
                {criando === 'pasta' ? 'Cancelar' : 'Nova pasta'}
              </Button>
            </div>
            {criando === 'base' && (
              <NovaBase
                pastas={pastas}
                onCriada={() => {
                  setCriando(null)
                  void carregar()
                }}
              />
            )}
            {criando === 'pasta' && (
              <NovaPasta
                onCriada={() => {
                  setCriando(null)
                  void carregar()
                }}
              />
            )}

            {bases && bases.length === 0 && !erro && (
              <Card>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="databases-empty">
                  Nenhuma base ainda. Crie uma para guardar registros estruturados — preço, pedido, ocorrência — sem misturá-los com conhecimento.
                </p>
              </Card>
            )}

            {/* As BASES SOLTAS primeiro, e no mesmo nível: é o caso normal, e enterrá-las
                dentro de uma caixa foi o que fez a pergunta "por que temos pasta e conjunto?"
                existir. */}
            {soltas.length > 0 && (
              <Card>
                <div className="flex flex-col gap-2" data-testid="bases-soltas">
                  {soltas.map((b) => (
                    <LinhaDeBase key={b.id} base={b} pastas={pastas} onAbrir={() => abrir(b.dataStoreId, b.key)} onMudou={carregar} />
                  ))}
                </div>
              </Card>
            )}

            {pastas.length > 0 && (
              <ListaDePastas
                testid="databases-list"
                aoMudar={() => void carregar()}
                pastas={pastas.map((f) => ({
                  chave: f.id,
                  nome: f.name,
                  detalhe: `${(bases ?? []).filter((b) => b.folder?.id === f.id).length} base(s)`,
                  itens: (bases ?? [])
                    .filter((b) => b.folder?.id === f.id)
                    .map((b) => ({
                      chave: b.key,
                      nome: b.name || b.key,
                      ...(b.fields.length ? { detalhe: b.fields.join(', ') } : {}),
                      marcas: [{ texto: api.MUTABILITY_LABEL[b.mutability], tom: 'neutral' as const }],
                      aoRenomear: (nome: string) => api.patchDataset(b.dataStoreId, b.key, { name: nome }),
                      aoApagar: () => api.deleteDataset(b.dataStoreId, b.key),
                      avisoAoApagar: `A base "${b.name || b.key}" e TODOS os registros dela são apagados. A pasta continua de pé.`,
                      aoAbrir: () => abrir(b.dataStoreId, b.key),
                    })),
                  vazio: 'Nenhuma base aqui dentro — mova uma para cá pela lista acima.',
                  aoRenomear: (nome) => api.patchDatabase(f.id, { name: nome }),
                  aoApagar: () => api.deleteDatabase(f.id),
                  avisoAoApagar: `A pasta "${f.name}", as bases dela e TODOS os registros guardados são apagados. Quem tinha acesso perde o acesso junto.`,
                  aoAbrirTela: () => abrir(f.id),
                }))}
              />
            )}
          </>
        )}

        {aberto && <DetalheDoDatabase id={aberto} conjunto={params.get('conjunto')} onVoltar={() => abrir(null)} />}
      </div>
    </AppLayout>
  )
}

/**
 * Uma base na lista — e para onde ela pode ir.
 *
 * A troca de pasta fica AQUI, ao lado do nome, e não numa tela de configuração: mover é
 * organização, e organização se faz olhando a lista inteira.
 */
function LinhaDeBase({
  base,
  pastas,
  onAbrir,
  onMudou,
}: {
  base: api.BaseResumo
  pastas: { id: string; name: string }[]
  onAbrir: () => void
  onMudou: () => void
}) {
  const [aviso, setAviso] = useState<string | null>(null)

  const mover = async (folderId: string) => {
    setAviso(null)
    const r = await api.moveBase(base.id, folderId || null)
    // Mover não move registro nenhum — mas PERMISSÃO mora na pasta, e sair dela tira o acesso
    // de quem tinha. Descobrir isso depois, por um agente que parou de responder, é caro.
    if (r.perdeuGrants > 0) setAviso(`${r.perdeuGrants} permissão(ões) ficaram na pasta anterior — quem tinha acesso por ali perdeu.`)
    onMudou()
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`base-${base.key}`}>
      <button
        type="button"
        onClick={onAbrir}
        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-body)', textAlign: 'left' }}
        data-testid={`base-abrir-${base.key}`}
      >
        {base.name || base.key}
      </button>
      <Badge>{api.ADAPTER_LABEL[base.adapterKind]}</Badge>
      <span style={{ fontSize: 12, color: 'var(--text-faint)', minWidth: 0 }}>{base.fields.join(', ') || 'sem campos'}</span>
      <select
        value={base.folder?.id ?? ''}
        onChange={(e) => void mover(e.target.value)}
        aria-label={`Pasta de ${base.name || base.key}`}
        className="ml-auto"
        style={{ minHeight: 32, padding: '0 8px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', fontSize: 12 }}
        data-testid={`base-pasta-${base.key}`}
      >
        <option value="">Sem pasta</option>
        {pastas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {aviso && (
        <p role="alert" style={{ flexBasis: '100%', margin: 0, fontSize: 12, color: 'var(--intent-warning)' }} data-testid={`base-aviso-${base.key}`}>
          {aviso}
        </p>
      )}
    </div>
  )
}

/** Uma pasta é só um nome: o que ela guarda são as bases que alguém mover para dentro. */
function NovaPasta({ onCriada }: { onCriada: () => void }) {
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid="folder-new-form">
        <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Nome da pasta
          <Input value={nome} onChange={(e) => setNome(e.target.value)} data-testid="folder-new-name" />
        </label>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
          A pasta organiza — e uma permissão dada nela vale para todas as bases que estiverem dentro.
        </p>
        {erro && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="folder-new-error">
            {erro}
          </p>
        )}
        <div>
          <Button
            disabled={!nome.trim()}
            onClick={async () => {
              setErro(null)
              try {
                await api.createFolder(nome)
                onCriada()
              } catch (e) {
                setErro((e as Error).message)
              }
            }}
            data-testid="folder-new-save"
          >
            Criar pasta
          </Button>
        </div>
      </div>
    </Card>
  )
}

/**
 * A base em UM passo: nome, campos, e só.
 *
 * Antes eram dois — criar a pasta e, dentro dela, criar o conjunto. Quem criava a pasta e
 * parava ali ficava com uma caixa vazia e nada dizendo qual era o próximo passo.
 */
function NovaBase({ pastas, onCriada }: { pastas: { id: string; name: string }[]; onCriada: () => void }) {
  const [nome, setNome] = useState('')
  const [campos, setCampos] = useState('valor:number\ndata:string')
  const [pasta, setPasta] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    setSalvando(true)
    setErro(null)
    try {
      // "campo:tipo", uma linha por campo — o formato mais simples que ainda produz um schema
      // de verdade. JSON cru na tela seria pedir para errar.
      const fields = campos
        .split('\n')
        .map((l) => l.split(':').map((x) => x.trim()))
        .filter(([n]) => n)
        .map(([n, t]) => ({ name: n, type: (['string', 'number', 'boolean'].includes(t) ? t : 'string') as 'string' | 'number' | 'boolean' }))
      await api.createBase({ name: nome, fields, folderId: pasta || null })
      onCriada()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid="database-new-form">
        <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Nome
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Vendas do mês" data-testid="database-new-name" />
        </label>
        <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Campos — um por linha, no formato nome:tipo
          <Textarea rows={4} value={campos} onChange={(e) => setCampos(e.target.value)} data-testid="database-new-fields" />
        </label>
        {pastas.length > 0 && (
          <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Pasta (opcional)
            <select
              value={pasta}
              onChange={(e) => setPasta(e.target.value)}
              data-testid="database-new-folder"
              style={{ minHeight: 40, padding: '0 10px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', fontSize: 13 }}
            >
              <option value="">Sem pasta</option>
              {pastas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {erro && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="database-new-error">
            {erro}
          </p>
        )}
        <div>
          <Button onClick={salvar} disabled={salvando || !nome.trim()} data-testid="database-new-save">
            {salvando ? 'Criando…' : 'Criar base'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function DetalheDoDatabase({ id, conjunto, onVoltar }: { id: string; conjunto: string | null; onVoltar: () => void }) {
  const [detalhe, setDetalhe] = useState<DatabaseDetail | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [dataset, setDataset] = useState<DatasetSummary | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const d = await api.getDatabase(id)
      setDetalhe(d)
      setDataset((atual) => d.datasets.find((x) => x.key === (atual?.key ?? conjunto)) ?? d.datasets[0] ?? null)
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [id, conjunto])

  useEffect(() => {
    void carregar()
  }, [carregar])

  if (erro) {
    return (
      <Card>
        <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger-text)' }} data-testid="database-detail-error">
          {erro}
        </p>
      </Card>
    )
  }
  if (!detalhe) return null

  return (
    <div className="flex flex-col gap-3" data-testid="database-detail">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15 }}>{detalhe.name}</strong>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="database-detail-sub">
              {api.ADAPTER_LABEL[detalhe.adapterKind]} · {api.STATUS_LABEL[detalhe.status]}
              {dataset ? ` · ${dataset.name || dataset.key}` : ''}
            </p>
          </div>
          <Button variant="secondary" onClick={onVoltar} data-testid="database-back">
            Voltar
          </Button>
        </div>
      </Card>

      {dataset && <ConsultaDoDataset databaseId={id} dataset={dataset} onMudou={carregar} />}

      <DatabaseGrants databaseId={id} />
    </div>
  )
}

/**
 * Os tamanhos de página que a tela oferece.
 *
 * O teto do servidor é 500 (`MAX_LIMIT` no DSL); pedir mais que isso seria pedir o que ele
 * recusa. 20 continua o padrão: é o que cabe na tela sem rolar.
 */
const TAMANHOS = [20, 50, 100, 200]

/** A regra em português: "resumo de 5 min em 5 min", "toda ocorrência". */
const regraDaSerie = (s: { modo: string; intervalMs: number | null }): string => {
  const rotulo = MODO_DE_SERIE[s.modo] ?? s.modo
  if (!s.intervalMs) return rotulo
  const ms = s.intervalMs
  const cada = ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} h` : ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)}s`
  return `${rotulo} de ${cada} em ${cada}`
}

/** Os seis modos, em português. A mesma tabela que o resto do produto usa. */
const MODO_DE_SERIE: Record<string, string> = {
  every_event: 'Toda ocorrência',
  on_change: 'Quando mudar',
  snapshot_interval: 'De tempos em tempos',
  schedule_snapshot: 'Uma vez por dia',
  window_aggregate: 'Resumo por período',
  condition: 'Só quando a condição bater',
}

/**
 * O QUE DÁ PARA CALCULAR em cima deste conjunto.
 *
 * "Não são essas funções? quero o mesmo no database." As trinta e poucas funções do registro
 * só alcançavam o agente e o Flow: um conjunto com preço mínimo e máximo a cada dez minutos
 * não tinha como ganhar uma terceira coluna com a variação — a conta estava pronta e não
 * chegava no dado.
 *
 * O seletor é o MESMO de "Contratar agente" (`FunctionPicker`), e o card escolhido abre com
 * os campos dentro dele. O motor é o de série derivada, que já existia: a conta acontece na
 * gravação, com a versão da função fixada, e o histórico que já estava lá é recalculado na
 * hora em que a coluna nasce.
 */
function ColunasCalculadas({ databaseId, dataset, onMudou }: { databaseId: string; dataset: DatasetSummary; onMudou: () => void }) {
  const [aberto, setAberto] = useState(false)
  const [funcoes, setFuncoes] = useState<CatalogFunction[]>([])
  const [escolhida, setEscolhida] = useState<CatalogFunction | null>(null)
  const [nome, setNome] = useState('')
  const [campo, setCampo] = useState('')
  const [argumento, setArgumento] = useState('')
  const [saida, setSaida] = useState('')
  const [quantos, setQuantos] = useState(3)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!aberto || funcoes.length) return
    listExecutorCatalog()
      .then((c) => setFuncoes(c.functions))
      .catch(() => setErro('Não foi possível carregar as funções.'))
  }, [aberto, funcoes.length])

  /**
   * O ARGUMENTO e a SAÍDA são derivados do schema da função — e conferidos pelo servidor.
   *
   * Perguntar "qual argumento recebe a série?" a quem só quer a variação do preço seria pedir
   * que a pessoa lesse um JSON Schema. O que a tela faz é escolher o candidato óbvio: o único
   * argumento que é lista de números, e o primeiro número da saída.
   */
  const argumentos = propriedadesDe(escolhida?.inputSchema)
  const saidas = propriedadesDe(escolhida?.outputSchema)
  const serieDe = (f: CatalogFunction): string => {
    const props = (((f.inputSchema ?? {}) as { properties?: Record<string, { type?: string }> }).properties ?? {}) as Record<string, { type?: string }>
    return Object.keys(props).find((k) => props[k]?.type === 'array') ?? Object.keys(props)[0] ?? ''
  }

  const escolher = (f: CatalogFunction) => {
    setEscolhida(f)
    setErro(null)
    setArgumento(serieDe(f))
    setSaida(propriedadesDe(f.outputSchema)[0] ?? '')
    // Um nome sugerido do que a função devolve: `variacaoPercentual` → `variacaopercentual`.
    // Editável, e é só um começo — quem nomeia a coluna é quem vai lê-la depois.
    if (!nome) setNome((propriedadesDe(f.outputSchema)[0] ?? f.functionName.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9_]/g, ''))
    if (!campo) setCampo(dataset.fields[0] ?? '')
  }

  const criar = async () => {
    if (!escolhida) return
    setSalvando(true)
    setErro(null)
    try {
      await createComputedColumn(databaseId, dataset.key, {
        name: nome,
        functionName: escolhida.functionName,
        version: escolhida.version,
        inputField: campo,
        inputArg: argumento,
        lookback: quantos,
        outputField: saida,
      })
      setAberto(false)
      setEscolhida(null)
      setNome('')
      onMudou()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const existentes = dataset.computedColumns ?? []

  return (
    <div
      style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '10px 12px' }}
      data-testid="dataset-colunas-calculadas"
    >
      <div className="flex flex-wrap items-center justify-between gap-2" style={{ fontSize: 12.5 }}>
        <strong style={{ fontWeight: 600 }}>O que este conjunto calcula</strong>
        <Button variant="secondary" size="sm" icon={aberto ? 'x' : 'plus'} onClick={() => setAberto((v) => !v)} data-testid="coluna-nova">
          {aberto ? 'Cancelar' : 'Nova coluna'}
        </Button>
      </div>

      {existentes.length === 0 && !aberto && (
        <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
          Nenhuma ainda. Uma coluna calculada usa uma função do sistema — a mesma lista que um agente usa — e o servidor a preenche a cada registro
          novo, e no histórico que já existe.
        </p>
      )}

      {existentes.length > 0 && (
        <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }} className="flex flex-col gap-1.5">
          {existentes.map((c) => (
            <li key={c.name} className="flex flex-wrap items-center gap-2" data-testid={`coluna-${c.name}`}>
              <code style={{ fontSize: 12 }}>{c.name}</code>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {c.functionName} · {c.outputField} · versão {c.version}
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon="trash-2"
                onClick={async () => {
                  await deleteComputedColumn(databaseId, dataset.key, c.name)
                  onMudou()
                }}
                data-testid={`coluna-apagar-${c.name}`}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}

      {aberto && (
        <div style={{ marginTop: 10 }}>
          {erro && (
            <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="coluna-erro">
              {erro}
            </p>
          )}
          <FunctionPicker
            funcoes={funcoes}
            escolhida={escolhida?.functionName ?? ''}
            onEscolher={escolher}
            idPrefixo="coluna-funcao"
            detalhe={(f) => (
              <div className="flex flex-col gap-2" style={{ fontSize: 12.5 }}>
                <label className="flex flex-col gap-1">
                  <span style={{ color: 'var(--text-muted)' }}>Ler qual campo deste conjunto</span>
                  <select value={campo} onChange={(e) => setCampo(e.target.value)} className="rounded-lg border border-(--border-strong) bg-(--surface-card) px-2 py-1.5" data-testid="coluna-campo">
                    {dataset.fields.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span style={{ color: 'var(--text-muted)' }}>Quantos registros a conta olha para trás</span>
                  <input
                    type="number"
                    min={2}
                    max={5000}
                    value={quantos}
                    onChange={(e) => setQuantos(Number(e.target.value))}
                    className="rounded-lg border border-(--border-strong) bg-(--surface-card) px-2 py-1.5"
                    data-testid="coluna-lookback"
                  />
                  {/* Sem passado suficiente a conta NÃO roda — e a célula fica vazia em vez
                      de trazer uma estimativa. É melhor dizer isso antes. */}
                  <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                    As primeiras {Math.max(0, quantos - 1)} linha(s) ficam vazias: não há passado suficiente para calcular, e um número ali seria chute.
                  </span>
                </label>
                {saidas.length > 1 && (
                  <label className="flex flex-col gap-1">
                    <span style={{ color: 'var(--text-muted)' }}>Qual número de {f.functionName} vira a coluna</span>
                    <select value={saida} onChange={(e) => setSaida(e.target.value)} className="rounded-lg border border-(--border-strong) bg-(--surface-card) px-2 py-1.5" data-testid="coluna-saida">
                      {saidas.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {argumentos.length > 1 && (
                  <label className="flex flex-col gap-1">
                    <span style={{ color: 'var(--text-muted)' }}>Qual argumento recebe a série</span>
                    <select value={argumento} onChange={(e) => setArgumento(e.target.value)} className="rounded-lg border border-(--border-strong) bg-(--surface-card) px-2 py-1.5" data-testid="coluna-argumento">
                      {argumentos.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  <span style={{ color: 'var(--text-muted)' }}>Nome da coluna na tabela</span>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="variacao"
                    className="rounded-lg border border-(--border-strong) bg-(--surface-card) px-2 py-1.5"
                    data-testid="coluna-nome"
                  />
                </label>
                <div>
                  <Button size="sm" onClick={criar} disabled={salvando || !nome || !campo || !saida} data-testid="coluna-criar">
                    {salvando ? 'Criando…' : 'Criar coluna'}
                  </Button>
                </div>
              </div>
            )}
          />
        </div>
      )}
    </div>
  )
}

/** Os nomes das propriedades de um JSON Schema de objeto. */
const propriedadesDe = (schema: unknown): string[] =>
  Object.keys((((schema ?? {}) as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>)

function ConsultaDoDataset({ databaseId, dataset, onMudou }: { databaseId: string; dataset: DatasetSummary; onMudou: () => void }) {
  const navigate = useNavigate()
  const [resultado, setResultado] = useState<QueryResult | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  /**
   * VER TODOS os registros, e saber onde se está.
   *
   * A consulta trazia 20 e dizia "20 de 137". Os outros 117 não tinham caminho nenhum: quem
   * precisava conferir um registro gravado ontem lia quantos existiam sem ter como chegar
   * neles. O servidor já aceitava `skip` — o DSL diz "paginação com teto" desde sempre —, e
   * quem não usava era a tela.
   */
  const [tamanho, setTamanho] = useState(TAMANHOS[0])
  const [pulo, setPulo] = useState(0)

  const consultar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setResultado(await api.queryDataset(databaseId, dataset.key, { limit: tamanho, skip: pulo }))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [databaseId, dataset.key, tamanho, pulo])

  useEffect(() => {
    void consultar()
  }, [consultar])

  // Trocar de conjunto recomeça a leitura: a página 3 de um não é a página 3 do outro.
  useEffect(() => {
    setPulo(0)
  }, [databaseId, dataset.key])

  /**
   * CORRIGIR e APAGAR uma linha.
   *
   * A tabela mostrava e mais nada: um valor digitado errado ontem ficava errado para sempre,
   * ou dava trabalho de apagar o conjunto inteiro e regravar. Quem aponta qual linha é o
   * `rowId` que a consulta devolve — por isso ele não vira coluna, ele é a identidade.
   *
   * Só aparece onde faz sentido: numa série que só acrescenta o servidor recusa, e um botão
   * que sempre falha é pior que botão nenhum. No lugar dele vai o motivo, escrito.
   */
  const [editando, setEditando] = useState<{ rowId: string; valores: Record<string, string> } | null>(null)
  const [aApagar, setAApagar] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const podeMexer = dataset.mutability === 'mutable'
  const colunas = resultado?.rows.length ? Object.keys(resultado.rows[0]).filter((c) => c !== 'rowId') : []
  const editaveis = colunas.filter((c) => c !== 'occurredAt')

  const mexer = async (acao: () => Promise<unknown>) => {
    setOcupado(true)
    setErro(null)
    try {
      await acao()
      setEditando(null)
      setAApagar(null)
      await consultar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  /**
   * O campo digitado é texto; o conjunto tem forma. Um `preco: number` não aceita `"10"` —
   * o servidor valida contra o schema e recusa. Quem sabe a forma de cada campo é o schema,
   * então é ele quem manda na conversão, e não um palpite sobre o que parece número.
   */
  const tipoDoCampo = (c: string) =>
    String(((dataset.schema as { properties?: Record<string, { type?: unknown }> } | undefined)?.properties?.[c]?.type as string) ?? 'string')

  const comAForma = (valores: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(valores).map(([c, v]) => {
        const tipo = tipoDoCampo(c)
        if (tipo === 'number' || tipo === 'integer') return [c, v.trim() === '' || Number.isNaN(Number(v)) ? v : Number(v)]
        if (tipo === 'boolean') return [c, v === 'true' ? true : v === 'false' ? false : v]
        return [c, v]
      }),
    )

  const salvarLinha = () => (editando ? mexer(() => api.patchRow(databaseId, dataset.key, editando.rowId, comAForma(editando.valores))) : undefined)

  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid="dataset-query">
        {/*
          A PROCEDÊNCIA, ao lado do dado.
          Uma tabela sem procedência responde "o que foi gravado" e deixa a pergunta seguinte
          no ar: quem gravou, de onde, e de quanto em quanto tempo. Antes isso morava numa
          tela separada, que o dono nunca abria porque nunca criou nada lá.
        */}
        {dataset.serie && (
          <div
            style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '10px 12px', background: 'var(--surface-sunken)' }}
            data-testid="dataset-origem"
          >
            <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12.5 }}>
              <strong style={{ fontWeight: 600 }}>Como este dado chega</strong>
              <Badge tone={dataset.serie.ativa ? 'success' : 'warning'}>{dataset.serie.ativa ? 'coletando' : 'parada'}</Badge>
            </div>
            {/*
              SEM FONTE não é "não sei de onde vem" — é "ninguém coleta, ele recebe".
              O texto genérico de antes ("alimentado por uma série desta conta") não dizia nem
              uma coisa nem outra, e quem criou a base à mão ficava sem saber o que fazer em
              seguida. Quem grava aqui é a própria tela, um agente com permissão de escrita ou
              uma rotina; conectar uma coleta é edição, e o botão abaixo leva a ela.
            */}
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
              {dataset.serie.fonte
                ? `Vem de "${dataset.serie.fonte}"`
                : 'Ninguém coleta para ele: recebe o que for gravado aqui, por um agente ou por uma rotina'}{' '}
              · {regraDaSerie(dataset.serie)} · {dataset.serie.registros.toLocaleString('pt-BR')} registro(s)
            </p>
            {dataset.serie.contas.length > 0 && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>{dataset.serie.contas.join(' · ')}</p>
            )}
            <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
              <Button variant="secondary" size="sm" icon="pencil" onClick={() => navigate(`/historicos/${dataset.serie!.id}/editar`)} data-testid="dataset-editar-regra">
                {/* Sem fonte, "editar a regra" é o caminho para GANHAR uma: é a mesma tela que
                    escolhe de onde o dado vem e de quanto em quanto tempo ele chega. */}
                {dataset.serie.fonte ? 'Editar a regra' : 'Conectar uma coleta'}
              </Button>
            </div>
          </div>
        )}
        <ColunasCalculadas databaseId={databaseId} dataset={dataset} onMudou={onMudou} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong style={{ fontSize: 13 }}>{dataset.name}</strong>
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            campos: {dataset.fields.join(', ') || '—'}
          </span>
        </div>

        {carregando && <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Consultando…</p>}
        {erro && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="dataset-query-error">
            {erro}
          </p>
        )}

        {resultado && (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }} data-testid="dataset-query-counts">
              {/* "Quantos existem" e "quantos vieram" são coisas diferentes — e a diferença
                  muda a conclusão de quem lê. */}
              {resultado.returned} de {resultado.total} registro(s)
              {resultado.freshness ? ` · atualizado em ${new Date(resultado.freshness).toLocaleString('pt-BR')}` : ' · sem registros ainda'}
            </p>

            {/* A NAVEGAÇÃO diz a FAIXA, e não o número da página.
                "Página 2" obriga a pessoa a multiplicar de cabeça para saber o que está vendo;
                "21–40 de 137" já é a resposta. */}
            <div className="flex flex-wrap items-center gap-2" data-testid="dataset-paginacao">
              <span style={{ fontSize: 12, color: 'var(--text-body)' }} data-testid="dataset-pagina">
                {resultado.total === 0 ? '0 de 0' : `${pulo + 1}–${pulo + resultado.returned} de ${resultado.total}`}
              </span>
              <Button
                variant="ghost"
                disabled={pulo === 0 || carregando}
                onClick={() => setPulo((p) => Math.max(0, p - tamanho))}
                data-testid="dataset-anterior"
              >
                Anterior
              </Button>
              <Button
                variant="ghost"
                disabled={pulo + resultado.returned >= resultado.total || carregando}
                onClick={() => setPulo((p) => p + tamanho)}
                data-testid="dataset-proxima"
              >
                Próxima
              </Button>
              <label htmlFor={`tamanho-${dataset.key}`} className="sr-only">
                Registros por página
              </label>
              <select
                id={`tamanho-${dataset.key}`}
                value={tamanho}
                onChange={(e) => {
                  // Trocar o tamanho volta para o começo: continuar "na página 2" mostraria uma
                  // faixa que ninguém pediu.
                  setTamanho(Number(e.target.value))
                  setPulo(0)
                }}
                data-testid="dataset-tamanho"
                style={{
                  fontSize: 12.5,
                  padding: '6px 8px',
                  minHeight: 'var(--hit-min, 44px)',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface-app)',
                  color: 'var(--text-body)',
                }}
              >
                {TAMANHOS.map((t) => (
                  <option key={t} value={t}>
                    {t} por página
                  </option>
                ))}
              </select>
            </div>
            {resultado.rows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ fontSize: 12.5, borderCollapse: 'collapse', minWidth: '100%' }} data-testid="dataset-query-table">
                  <thead>
                    <tr>
                      {colunas.map((c) => (
                        <th key={c} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                          {c}
                        </th>
                      ))}
                      {podeMexer && <th style={{ borderBottom: '1px solid var(--border-subtle)' }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.rows.map((linha, i) => {
                      const rowId = String(linha.rowId ?? '')
                      const emEdicao = editando?.rowId === rowId
                      return (
                        <tr key={rowId || i} data-testid={rowId ? `linha-${rowId}` : undefined}>
                          {colunas.map((c) => (
                            <td key={c} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>
                              {emEdicao && editaveis.includes(c) ? (
                                <Input
                                  value={editando.valores[c] ?? ''}
                                  onChange={(e) => setEditando({ ...editando, valores: { ...editando.valores, [c]: e.target.value } })}
                                  data-testid={`linha-campo-${c}`}
                                  style={{ minWidth: 120, fontSize: 12.5 }}
                                />
                              ) : linha[c] instanceof Object ? (
                                JSON.stringify(linha[c])
                              ) : (
                                String(linha[c] ?? '')
                              )}
                            </td>
                          ))}
                          {podeMexer && (
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>
                              {emEdicao ? (
                                <span className="flex items-center gap-1">
                                  <Button size="sm" onClick={() => void salvarLinha()} disabled={ocupado} data-testid="linha-salvar">
                                    Salvar
                                  </Button>
                                  <Button size="sm" variant="secondary" onClick={() => setEditando(null)} data-testid="linha-cancelar">
                                    Cancelar
                                  </Button>
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <IconButton
                                    icon="pencil"
                                    label="Corrigir esta linha"
                                    data-testid={`linha-editar-${rowId}`}
                                    onClick={() =>
                                      setEditando({
                                        rowId,
                                        valores: Object.fromEntries(
                                          editaveis.map((c) => [c, linha[c] instanceof Object ? JSON.stringify(linha[c]) : String(linha[c] ?? '')]),
                                        ),
                                      })
                                    }
                                  />
                                  <IconButton icon="trash-2" label="Apagar esta linha" data-testid={`linha-apagar-${rowId}`} onClick={() => setAApagar(rowId)} />
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!podeMexer && resultado.rows.length > 0 && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }} data-testid="linhas-travadas">
                Este conjunto é {api.MUTABILITY_LABEL[dataset.mutability]} — corrigir e apagar linha não valem aqui.
              </p>
            )}
          </>
        )}
      </div>

      <Dialog
        open={aApagar !== null}
        title="Apagar esta linha?"
        onClose={() => setAApagar(null)}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setAApagar(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void (aApagar && mexer(() => api.deleteRow(databaseId, dataset.key, aApagar)))}
              disabled={ocupado}
              data-testid="linha-apagar-confirmar"
            >
              Apagar
            </Button>
          </div>
        }
      >
        <p style={{ margin: 0, fontSize: 13.5 }}>O registro sai da série e isto não tem desfazer.</p>
      </Dialog>
    </Card>
  )
}
