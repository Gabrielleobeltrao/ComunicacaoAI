import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { Badge, Button, Card, Input, Tabs } from '../ui'
import * as api from '../lib/extensions'
import { KIND_LABEL, STATUS_LABEL, descreverPermissao } from '../lib/extensions'
import type { CatalogItem, Installed, MyPackage, UpdatePreview } from '../lib/extensions'

// COMUNIDADE — o catálogo, o que é meu e o que está instalado.
//
// Três coisas que a tela nunca esconde: a PROCEDÊNCIA (de quem é isto), a PERMISSÃO (o
// que passa a poder fazer) e o MOTIVO de uma suspensão. Um marketplace que mostra só
// nome e número de instalações transforma "instalar" num clique sem informação — e o que
// se instala aqui alcança o escritório inteiro.

type Aba = 'catalog' | 'mine' | 'installed'

export function Marketplace() {
  const [params, setParams] = useSearchParams()
  const aba = ((params.get('tab') as Aba) ?? 'catalog') as Aba
  const [termo, setTermo] = useState('')
  const [catalogo, setCatalogo] = useState<CatalogItem[] | null>(null)
  const [meus, setMeus] = useState<MyPackage[] | null>(null)
  const [instalados, setInstalados] = useState<Installed[] | null>(null)
  const [previa, setPrevia] = useState<Record<string, UpdatePreview | null>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      if (aba === 'catalog') setCatalogo(await api.searchCatalog(termo))
      if (aba === 'mine') setMeus(await api.myPackages())
      if (aba === 'installed') {
        const lista = await api.installed()
        setInstalados(lista)
        // A prévia de atualização de cada instalado: é ela que diz se algo mudou de
        // permissão. Buscar junto evita a tela dizer "atualização disponível" sem saber
        // o que a atualização pede.
        const previas = await Promise.all(
          lista.map(async (i) => [i.packageId, await api.previewUpdate(i.packageId).catch(() => null)] as const),
        )
        setPrevia(Object.fromEntries(previas))
      }
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [aba, termo])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const acao = async (fn: () => Promise<unknown>, mensagem?: string) => {
    setErro(null)
    setAviso(null)
    try {
      await fn()
      if (mensagem) setAviso(mensagem)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  const trocarAba = (nova: Aba) => {
    const p = new URLSearchParams(params)
    p.set('tab', nova)
    setParams(p, { replace: true })
  }

  return (
    <AppLayout current="/community" title="Comunidade" subtitle="O que dá para instalar, o que é seu e o que já está aqui">
      <div className="flex flex-col gap-3">
        <Tabs
          value={aba}
          onChange={(v) => trocarAba(v as Aba)}
          tabs={[
            { value: 'catalog', label: 'Catálogo' },
            { value: 'mine', label: 'Minhas criações' },
            { value: 'installed', label: 'Instalados' },
          ]}
        />

        {erro && (
          <Card>
            <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger)' }} data-testid="marketplace-error">
              {erro}
            </p>
          </Card>
        )}
        {aviso && (
          <Card>
            <p role="status" style={{ fontSize: 13 }} data-testid="marketplace-aviso">
              {aviso}
            </p>
          </Card>
        )}

        {aba === 'catalog' && (
          <>
            <Input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Procurar por nome" data-testid="marketplace-busca" />
            {catalogo?.length === 0 && (
              <Card>
                <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                  Nada publicado ainda. O catálogo só mostra o que passou por revisão — rascunho e suspenso ficam de fora.
                </p>
              </Card>
            )}
            {catalogo?.map((item) => (
              <Card key={item.id}>
                <div className="flex flex-col gap-2" data-testid="catalog-item">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong style={{ fontSize: 15 }}>{item.name}</strong>
                    <Badge tone="neutral">{KIND_LABEL[item.kind]}</Badge>
                    {/* A procedência, sempre. Nunca "oficial" por omissão. */}
                    <Badge tone={item.author === 'platform' ? 'success' : 'neutral'}>
                      {item.author === 'platform' ? 'da plataforma' : 'da comunidade'}
                    </Badge>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>v{item.latestVersion ?? '—'}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>· {item.installs} instalações</span>
                  </div>
                  <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{item.summary}</p>
                  <div className="flex gap-2">
                    <Button
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
                  </div>
                </div>
              </Card>
            ))}
          </>
        )}

        {aba === 'mine' && (
          <>
            {meus?.length === 0 && (
              <Card>
                <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                  Você ainda não preparou nada para compartilhar. Um App privado ou uma ferramenta vira pacote quando você escolhe — nunca por
                  varredura.
                </p>
              </Card>
            )}
            {meus?.map((p) => (
              <Card key={p._id}>
                <div className="flex flex-col gap-2" data-testid="my-package">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong style={{ fontSize: 15 }}>{p.name}</strong>
                    <Badge tone="neutral">{KIND_LABEL[p.kind]}</Badge>
                    <Badge tone={p.status === 'published' ? 'success' : p.status === 'suspended' ? 'danger' : 'neutral'}>{STATUS_LABEL[p.status]}</Badge>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>v{p.latestVersion ?? 'sem versão'}</span>
                  </div>
                  {p.suspendedReason && (
                    <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger)' }}>
                      Suspenso: {p.suspendedReason}
                    </p>
                  )}
                  {(p.status === 'draft' || p.status === 'testing' || p.status === 'changes_requested') && p.latestVersion && (
                    <div>
                      <Button variant="ghost" onClick={() => acao(() => api.submitForReview(p._id), 'Enviado para revisão.')} data-testid="package-enviar">
                        Enviar para revisão
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </>
        )}

        {aba === 'installed' && (
          <>
            {instalados?.length === 0 && (
              <Card>
                <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Nada instalado ainda.</p>
              </Card>
            )}
            {instalados?.map((i) => {
              const p = previa[i.packageId]
              return (
                <Card key={i.packageId}>
                  <div className="flex flex-col gap-2" data-testid="installed-item">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong style={{ fontSize: 15 }}>{i.packageId}</strong>
                      <Badge tone={i.status === 'active' ? 'success' : 'warning'}>{i.status === 'active' ? 'ativo' : 'pausado'}</Badge>
                      <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>v{i.version} (fixada)</span>
                    </div>

                    {p && (
                      <div className="flex flex-col gap-1" data-testid="update-diff">
                        <p style={{ fontSize: 13 }}>
                          Atualização disponível: {p.from} → {p.to}
                          {p.compatible ? '' : ' · versão MAIOR diferente, revise com atenção'}
                        </p>
                        {p.changelog && <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{p.changelog}</p>}
                        {p.permissions.needsApproval ? (
                          <>
                            <p style={{ fontSize: 12.5, fontWeight: 700 }}>Esta versão passa a pedir:</p>
                            <ul style={{ fontSize: 12.5, margin: 0, paddingLeft: 18 }}>
                              {p.permissions.added.map((perm) => (
                                <li key={`${perm.kind}:${perm.key}`}>{descreverPermissao(perm)}</li>
                              ))}
                              {p.permissions.changed.map((c) => (
                                <li key={`${c.kind}:${c.key}`}>
                                  {c.key}: de [{c.before.join(', ')}] para [{c.after.join(', ')}]
                                </li>
                              ))}
                            </ul>
                            <div>
                              <Button
                                onClick={() => acao(() => api.applyUpdate(i.packageId, true), 'Atualizado.')}
                                data-testid="update-aprovar"
                              >
                                Revisei e aceito as novas permissões
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div>
                            <Button onClick={() => acao(() => api.applyUpdate(i.packageId, false), 'Atualizado.')} data-testid="update-aplicar">
                              Atualizar
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {i.status === 'active' && (
                      <div>
                        <Button
                          variant="ghost"
                          onClick={() => acao(() => api.uninstall(i.packageId), 'Pausado. Nada foi apagado: o histórico continua.')}
                          data-testid="installed-remover"
                        >
                          Desinstalar
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </>
        )}
      </div>
    </AppLayout>
  )
}
