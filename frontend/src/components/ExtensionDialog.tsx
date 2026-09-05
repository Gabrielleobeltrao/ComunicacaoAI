import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Dialog, Tag } from '../ui'
import * as api from '../lib/extensions'
import { KIND_LABEL, STATUS_LABEL, descreverPermissao } from '../lib/extensions'
import type { CatalogItem, Installed, MyPackage, UpdatePreview } from '../lib/extensions'

/**
 * UM item da comunidade, do jeito que a prateleira o conhece.
 *
 * Ele chega de duas fontes que dizem coisas diferentes: o catálogo (o que está publicado,
 * de qualquer um) e as minhas criações (o que é meu, publicado ou não). Um pacote meu e
 * publicado aparece nas duas — e é um item só, com as duas informações.
 */
export interface ItemDeComunidade {
  id: string
  kind: api.ExtensionKind
  name: string
  summary: string
  categories: string[]
  version: string | null
  author: 'platform' | 'community'
  installs: number | null
  /** Preenchido só quando o pacote é meu: é o que autoriza as ações de dono. */
  meu: MyPackage | null
  instalado: Installed | null
}

export const itemDeCatalogo = (c: CatalogItem, meu: MyPackage | null, instalado: Installed | null): ItemDeComunidade => ({
  id: c.id,
  kind: c.kind,
  name: c.name,
  summary: c.summary,
  categories: c.categories,
  version: c.latestVersion,
  author: c.author,
  installs: c.installs,
  meu,
  instalado,
})

export const itemDoDono = (p: MyPackage, instalado: Installed | null): ItemDeComunidade => ({
  id: p._id,
  kind: p.kind,
  name: p.name,
  summary: p.summary,
  categories: [],
  version: p.latestVersion,
  // Um pacote meu ainda não publicado não é "da plataforma" — e nem precisa de selo:
  // quem o vê é só quem o escreveu.
  author: 'community',
  installs: null,
  meu: p,
  instalado,
})

/**
 * O POPUP de um item da comunidade — informações e configurações, no próprio item.
 *
 * Isto era uma página inteira ("Comunidade"), com abas de catálogo, minhas criações e
 * instalados. A página dizia a coisa errada: que instalar algo de outra pessoa é uma
 * atividade separada de usar um App. Aqui, cada item carrega o que se decide sobre ele —
 * a permissão que aumenta numa atualização, a versão fixada, o motivo de uma suspensão —
 * e nada disso exige sair do lugar onde o item já estava.
 */
export function ExtensionDialog({ item, onClose, onChanged }: { item: ItemDeComunidade | null; onClose: () => void; onChanged: () => void }) {
  const [previa, setPrevia] = useState<UpdatePreview | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const packageId = item?.id ?? null
  const instaladoAgora = Boolean(item?.instalado)

  useEffect(() => {
    setErro(null)
    setAviso(null)
    setPrevia(null)
    // A prévia só faz sentido para o que já está instalado: é ela que diz se a próxima
    // versão passa a pedir mais. Buscar antes do clique é o que permite mostrar o diff
    // ANTES de existir um botão de atualizar.
    if (!packageId || !instaladoAgora) return
    let vivo = true
    void api
      .previewUpdate(packageId)
      .then((p) => vivo && setPrevia(p))
      .catch(() => vivo && setPrevia(null))
    return () => {
      vivo = false
    }
  }, [packageId, instaladoAgora])

  const acao = useCallback(
    async (fn: () => Promise<unknown>, mensagem?: string) => {
      setErro(null)
      setAviso(null)
      setOcupado(true)
      try {
        await fn()
        if (mensagem) setAviso(mensagem)
        onChanged()
      } catch (e) {
        setErro((e as Error).message)
      } finally {
        setOcupado(false)
      }
    },
    [onChanged],
  )

  if (!item) return null
  const meu = item.meu

  return (
    <Dialog open title={item.name} subtitle={item.summary} width={620} onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }} data-testid="extension-detail">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Tag>{KIND_LABEL[item.kind]}</Tag>
          {/* A procedência, sempre — e o selo, nunca por omissão. */}
          {item.author === 'platform' ? (
            <Badge tone="success" data-testid="selo-plataforma">
              da plataforma
            </Badge>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>da comunidade</span>
          )}
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>v{item.version ?? '—'}</span>
          {item.installs !== null && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>· {item.installs} instalações</span>}
        </div>

        {meu && (
          <div style={{ display: 'grid', gap: 6 }} data-testid="extension-dono">
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Seu pacote:</span>
              <Badge tone={meu.status === 'published' ? 'success' : meu.status === 'suspended' ? 'danger' : 'neutral'}>{STATUS_LABEL[meu.status]}</Badge>
            </div>
            {meu.suspendedReason && (
              <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--intent-danger-text)' }}>
                Suspenso: {meu.suspendedReason}
              </p>
            )}
            {(meu.status === 'draft' || meu.status === 'testing' || meu.status === 'changes_requested') && meu.latestVersion && (
              <div>
                <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => acao(() => api.submitForReview(meu._id), 'Enviado para revisão.')} data-testid="package-enviar">
                  Enviar para revisão
                </Button>
              </div>
            )}
          </div>
        )}

        {item.instalado && (
          <p style={{ margin: 0, fontSize: 13 }} data-testid="extension-instalado">
            Instalado: v{item.instalado.version} (fixada) · {item.instalado.status === 'active' ? 'ativo' : 'pausado'}
          </p>
        )}

        {previa && (
          <div style={{ display: 'grid', gap: 6 }} data-testid="update-diff">
            <p style={{ margin: 0, fontSize: 13 }}>
              Atualização disponível: {previa.from} → {previa.to}
              {previa.compatible ? '' : ' · versão MAIOR diferente, revise com atenção'}
            </p>
            {previa.changelog && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>{previa.changelog}</p>}
            {previa.permissions.needsApproval ? (
              <>
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700 }}>Esta versão passa a pedir:</p>
                <ul style={{ fontSize: 12.5, margin: 0, paddingLeft: 18 }}>
                  {previa.permissions.added.map((perm) => (
                    <li key={`${perm.kind}:${perm.key}`}>{descreverPermissao(perm)}</li>
                  ))}
                  {previa.permissions.changed.map((c) => (
                    <li key={`${c.kind}:${c.key}`}>
                      {c.key}: de [{c.before.join(', ')}] para [{c.after.join(', ')}]
                    </li>
                  ))}
                </ul>
                <div>
                  <Button size="sm" disabled={ocupado} onClick={() => acao(() => api.applyUpdate(item.id, true), 'Atualizado.')} data-testid="update-aprovar">
                    Revisei e aceito as novas permissões
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <Button size="sm" disabled={ocupado} onClick={() => acao(() => api.applyUpdate(item.id, false), 'Atualizado.')} data-testid="update-aplicar">
                  Atualizar
                </Button>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
          {!item.instalado ? (
            <Button
              size="sm"
              disabled={ocupado}
              onClick={() =>
                acao(
                  () => (item.kind === 'template' ? api.installTemplate(item.id) : api.installPackage(item.id)),
                  item.kind === 'template'
                    ? 'Template instalado. Ele abriu uma proposta no Arquiteto: nada foi criado até você revisar e aplicar.'
                    : 'Instalado. Conecte o que ele pede antes de usar.',
                )
              }
              data-testid="catalog-instalar"
            >
              Instalar
            </Button>
          ) : (
            item.instalado.status === 'active' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={ocupado}
                onClick={() => acao(() => api.uninstall(item.id), 'Pausado. Nada foi apagado: o histórico continua.')}
                data-testid="installed-remover"
              >
                Desinstalar
              </Button>
            )
          )}
        </div>

        {erro && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--intent-danger-text)' }} data-testid="extension-erro">
            {erro}
          </p>
        )}
        {aviso && (
          <p role="status" style={{ margin: 0, fontSize: 13 }} data-testid="extension-aviso">
            {aviso}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/**
 * O que a prateleira precisa da comunidade, resolvido de uma vez só.
 *
 * As três chamadas são independentes e nenhuma delas pode derrubar a página: a comunidade
 * pode estar FECHADA por configuração (`COMMUNITY_MARKETPLACE_ENABLED=0` responde 404), e
 * uma conta sem nada publicado é o caso comum. O que é da própria conta continua aparecendo
 * nos dois casos.
 */
export async function carregarComunidade(kind: api.ExtensionKind | api.ExtensionKind[]): Promise<{
  catalogo: CatalogItem[]
  meus: MyPackage[]
  instalados: Installed[]
}> {
  const kinds = Array.isArray(kind) ? kind : [kind]
  // Uma resposta com outro formato NÃO pode apagar a prateleira. Ela chegou de uma rota
  // que pode estar fechada, atrás de proxy, ou respondendo um corpo antigo — e o que é da
  // própria conta continua valendo em todos esses casos.
  const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  const [listas, meus, instalados] = await Promise.all([
    Promise.all(kinds.map((k) => api.searchCatalog('', k).then(lista<CatalogItem>).catch(() => [] as CatalogItem[]))),
    api.myPackages().then(lista<MyPackage>).catch(() => [] as MyPackage[]),
    api.installed().then(lista<Installed>).catch(() => [] as Installed[]),
  ])
  return { catalogo: listas.flat(), meus: meus.filter((p) => kinds.includes(p.kind)), instalados }
}

/**
 * A lista final: o catálogo, mais o que é meu e ainda não está lá.
 *
 * Um rascunho meu não aparece no catálogo — ele não está publicado — mas some da minha
 * vista se a prateleira for só o catálogo. Ele entra aqui, e só eu o vejo.
 */
export function juntarComunidade(catalogo: CatalogItem[], meus: MyPackage[], instalados: Installed[]): ItemDeComunidade[] {
  const porId = new Map(meus.map((p) => [p._id, p]))
  const instaladoDe = new Map(instalados.map((i) => [i.packageId, i]))
  // O catálogo pode ser lido em mais de um pedido (um por tipo). O mesmo pacote chegando
  // duas vezes viraria duas chaves iguais no React — que é um bug silencioso, e não um erro.
  const unicos = [...new Map(catalogo.map((c) => [c.id, c])).values()]
  const doCatalogo = unicos.map((c) => itemDeCatalogo(c, porId.get(c.id) ?? null, instaladoDe.get(c.id) ?? null))
  const jaListados = new Set(doCatalogo.map((i) => i.id))
  const soMeus = meus.filter((p) => !jaListados.has(p._id)).map((p) => itemDoDono(p, instaladoDe.get(p._id) ?? null))
  return [...doCatalogo, ...soMeus]
}
