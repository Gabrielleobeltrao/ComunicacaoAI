import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Badge, Button, Card, Dialog, Icon, IconButton, Input } from '../ui'

// A PASTA — um lugar que guarda coisas, desenhado como um lugar que guarda coisas.
//
// A lista era uma fileira de botões chapados: para ver o que tinha dentro de um Database
// era preciso ABRIR OUTRA TELA, e voltar para olhar o próximo. Com dois ou três ainda dá;
// com dez, a pessoa perde o fio de onde estava.
//
// Aqui a pasta abre no lugar. E as ações ficam onde a coisa está — renomear e apagar sem
// atravessar para outro canto, que era a reclamação: "não tem opção de editar as
// informações e também não tem como deletar".
//
// Um componente só para Databases e Históricos: são a mesma forma — um recipiente com
// itens dentro —, e dois desenhos para a mesma forma divergem no primeiro ajuste.

export interface ItemDaPasta {
  chave: string
  nome: string
  detalhe?: string
  /** Marcas curtas: o que distingue este item dos outros. */
  marcas?: { texto: string; tom?: 'success' | 'warning' | 'neutral' | 'brand' }[]
  aoRenomear?: (nome: string) => Promise<unknown> | unknown
  /** O retorno é ignorado de propósito: o que importa é ter terminado, e não o que voltou. */
  aoApagar?: () => Promise<unknown> | unknown
  /** Abrir ESTE item — não a pasta. Sem isto, o nome é só texto. */
  aoAbrir?: () => void
  /** O texto do diálogo de apagar: o que vai junto. Sem ele, não há como apagar. */
  avisoAoApagar?: string
}

export interface Pasta {
  chave: string
  nome: string
  detalhe?: string
  marcas?: { texto: string; tom?: 'success' | 'warning' | 'neutral' | 'brand' }[]
  itens: ItemDaPasta[]
  /** O que dizer quando a pasta está vazia — nunca um espaço em branco. */
  vazio?: string
  aoRenomear?: (nome: string) => Promise<unknown> | unknown
  aoApagar?: () => Promise<unknown> | unknown
  avisoAoApagar?: string
  /** Um caminho para a tela inteira, quando ela existe. */
  aoAbrirTela?: () => void
  /** O que aparece ao pé da pasta aberta — a consulta, um formulário. */
  rodape?: ReactNode
}

/** O nome do item vira botão quando há para onde ir, e continua texto quando não há. */
function Como({ abrir, testid, style, children }: { abrir?: () => void; testid: string; style: CSSProperties; children: ReactNode }) {
  if (!abrir) return <span style={style}>{children}</span>
  return (
    <button type="button" onClick={abrir} data-testid={testid} className="ds-hit" style={{ ...style, cursor: 'pointer' }}>
      {children}
    </button>
  )
}

export function ListaDePastas({ pastas, aoMudar, testid = 'pastas' }: { pastas: Pasta[]; aoMudar?: () => void; testid?: string }) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set())
  const [renomeando, setRenomeando] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [aApagar, setAApagar] = useState<{ aviso: string; nome: string; executar: () => Promise<unknown> | unknown } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const alternar = (chave: string) =>
    setAbertas((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(chave)) proximo.delete(chave)
      else proximo.add(chave)
      return proximo
    })

  const confirmarApagar = async () => {
    if (!aApagar) return
    setOcupado(true)
    setErro(null)
    try {
      await aApagar.executar()
      setAApagar(null)
      aoMudar?.()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const salvarNomeDoItem = async (item: ItemDaPasta) => {
    if (!item.aoRenomear || !nome.trim()) return
    setOcupado(true)
    setErro(null)
    try {
      await item.aoRenomear(nome.trim())
      setRenomeando(null)
      aoMudar?.()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const salvarNome = async (pasta: Pasta) => {
    if (!pasta.aoRenomear || !nome.trim()) return
    setOcupado(true)
    setErro(null)
    try {
      await pasta.aoRenomear(nome.trim())
      setRenomeando(null)
      aoMudar?.()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid={testid}>
      {pastas.map((pasta) => {
        const aberta = abertas.has(pasta.chave)
        return (
          <Card key={pasta.chave} padding="0">
            <div className="flex flex-wrap items-center gap-2" style={{ padding: '10px 12px' }}>
              <button
                type="button"
                onClick={() => alternar(pasta.chave)}
                aria-expanded={aberta}
                data-testid={`pasta-${pasta.chave}`}
                className="ds-hit flex flex-1 items-center gap-2"
                style={{ minWidth: 0, textAlign: 'left', border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}
              >
                {/* A seta e a pasta dizem juntas o que aquilo é e o que o clique faz. */}
                <Icon name={aberta ? 'chevron-down' : 'chevron-right'} size={16} color="var(--text-muted)" />
                <Icon name={aberta ? 'folder-open' : 'folder'} size={18} color="var(--intent-brand)" />
                <span style={{ minWidth: 0 }}>
                  <span className="flex flex-wrap items-center gap-2">
                    <strong style={{ fontSize: 14 }}>{pasta.nome}</strong>
                    {(pasta.marcas ?? []).map((m) => (
                      <Badge key={m.texto} tone={m.tom ?? 'neutral'}>
                        {m.texto}
                      </Badge>
                    ))}
                  </span>
                  {pasta.detalhe ? <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)' }}>{pasta.detalhe}</span> : null}
                </span>
              </button>

              {pasta.aoRenomear ? (
                <IconButton
                  icon="pencil"
                  label={`Renomear “${pasta.nome}”`}
                  data-testid={`pasta-editar-${pasta.chave}`}
                  onClick={() => {
                    setRenomeando(pasta.chave)
                    setNome(pasta.nome)
                  }}
                />
              ) : null}
              {pasta.aoAbrirTela ? (
                <IconButton icon="external-link" label={`Abrir “${pasta.nome}”`} data-testid={`pasta-abrir-${pasta.chave}`} onClick={pasta.aoAbrirTela} />
              ) : null}
              {pasta.aoApagar ? (
                <IconButton
                  icon="trash-2"
                  label={`Apagar “${pasta.nome}”`}
                  data-testid={`pasta-apagar-${pasta.chave}`}
                  onClick={() => setAApagar({ aviso: pasta.avisoAoApagar ?? '', nome: pasta.nome, executar: pasta.aoApagar! })}
                />
              ) : null}
            </div>

            {renomeando === pasta.chave ? (
              <div className="flex flex-wrap items-end gap-2" style={{ padding: '0 12px 12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px', fontSize: 12, color: 'var(--text-muted)' }}>
                  Nome
                  <Input value={nome} onChange={(e) => setNome(e.target.value)} data-testid="pasta-editar-nome" style={{ width: '100%' }} />
                </label>
                <Button onClick={() => void salvarNome(pasta)} disabled={ocupado || !nome.trim()} data-testid="pasta-editar-salvar">
                  Salvar
                </Button>
                <Button variant="secondary" onClick={() => setRenomeando(null)} data-testid="pasta-editar-cancelar">
                  Cancelar
                </Button>
              </div>
            ) : null}

            {aberta ? (
              <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '8px 12px 12px' }}>
                {pasta.itens.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid={`pasta-vazia-${pasta.chave}`}>
                    {pasta.vazio ?? 'Nada aqui dentro ainda.'}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {pasta.itens.map((item) => (
                      <div
                        key={item.chave}
                        className="flex flex-wrap items-center gap-2"
                        data-testid={`item-${item.chave}`}
                        style={{ padding: '6px 4px', borderRadius: 8 }}
                      >
                        <Icon name="file-text" size={15} color="var(--text-muted)" />
                        <Como
                          abrir={item.aoAbrir}
                          testid={`item-abrir-${item.chave}`}
                          style={{ minWidth: 0, flex: 1, textAlign: 'left', border: 0, background: 'transparent', padding: 0 }}
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{item.nome}</span>
                            {(item.marcas ?? []).map((m) => (
                              <Badge key={m.texto} tone={m.tom ?? 'neutral'}>
                                {m.texto}
                              </Badge>
                            ))}
                          </span>
                          {item.detalhe ? <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>{item.detalhe}</span> : null}
                        </Como>
                        {item.aoRenomear ? (
                          <IconButton
                            icon="pencil"
                            label={`Renomear “${item.nome}”`}
                            data-testid={`item-editar-${item.chave}`}
                            onClick={() => {
                              setRenomeando(`item:${item.chave}`)
                              setNome(item.nome)
                            }}
                          />
                        ) : null}
                        {item.aoApagar ? (
                          <IconButton
                            icon="trash-2"
                            label={`Apagar “${item.nome}”`}
                            data-testid={`item-apagar-${item.chave}`}
                            onClick={() => setAApagar({ aviso: item.avisoAoApagar ?? '', nome: item.nome, executar: item.aoApagar! })}
                          />
                        ) : null}
                        {renomeando === `item:${item.chave}` ? (
                          <span className="flex flex-wrap items-end gap-2" style={{ flexBasis: '100%' }}>
                            <Input value={nome} onChange={(e) => setNome(e.target.value)} data-testid="item-editar-nome" style={{ flex: '1 1 200px' }} />
                            <Button
                              size="sm"
                              onClick={() => void salvarNomeDoItem(item)}
                              disabled={ocupado || !nome.trim()}
                              data-testid="item-editar-salvar"
                            >
                              Salvar
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setRenomeando(null)}>
                              Cancelar
                            </Button>
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {pasta.rodape ? <div style={{ paddingTop: 10 }}>{pasta.rodape}</div> : null}
              </div>
            ) : null}
          </Card>
        )
      })}

      {/* APAGAR PERGUNTA, e diz o que vai junto. Um botão que apaga no primeiro clique, sem
          dizer o que leva, é a diferença entre uma limpeza e um acidente. */}
      <Dialog
        open={aApagar !== null}
        title="Apagar?"
        subtitle={aApagar?.nome}
        onClose={() => setAApagar(null)}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setAApagar(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmarApagar()} disabled={ocupado} data-testid="pasta-apagar-confirmar">
              Apagar
            </Button>
          </div>
        }
      >
        <p style={{ margin: 0, fontSize: 13.5 }}>{aApagar?.aviso || 'Isto não tem desfazer.'}</p>
        {erro ? (
          <p role="alert" style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="pasta-erro">
            {erro}
          </p>
        ) : null}
      </Dialog>
    </div>
  )
}
