import { useCallback, useEffect, useState } from 'react'
import {
  createSectorDocument,
  deleteSectorDocument,
  getSectorDocument,
  listSectorDocuments,
  updateSectorDocument,
  INDEX_STATUS_LABEL,
  SOURCE_LABEL,
  type SectorDocument,
} from '../lib/sectorKnowledge'
import { Button, Card, EmptyState, Field, Input, Tag, Textarea } from '../ui'

// The sector's shared knowledge base: a CURATED library the whole team reads —
// nothing is saved automatically. Mirrors the agent knowledge UX (list + editor),
// and shows each entry's origin, last update and indexing state.
export function SectorKnowledge({ sectorId }: { sectorId: string }) {
  const [docs, setDocs] = useState<SectorDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; title: string; content: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    listSectorDocuments(sectorId)
      .then(setDocs)
      .catch(() => setDocs([]))
  }, [sectorId])
  useEffect(load, [load])

  const openNew = () => setEditing({ id: null, title: '', content: '' })
  const openEdit = async (id: string) => {
    try {
      const doc = await getSectorDocument(sectorId, id)
      setEditing({ id: doc._id, title: doc.title, content: doc.content })
    } catch {
      setError('Não foi possível abrir o documento.')
    }
  }

  const save = async () => {
    if (!editing) return
    if (!editing.title.trim() || !editing.content.trim()) {
      setError('Informe título e conteúdo.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing.id) await updateSectorDocument(sectorId, editing.id, { title: editing.title.trim(), content: editing.content })
      else await createSectorDocument(sectorId, { title: editing.title.trim(), content: editing.content })
      setEditing(null)
      load()
    } catch {
      setError('Não foi possível salvar o documento.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (doc: SectorDocument) => {
    if (!window.confirm(`Excluir "${doc.title}" da base do setor?`)) return
    try {
      await deleteSectorDocument(sectorId, doc._id)
      load()
    } catch {
      setError('Não foi possível excluir o documento.')
    }
  }

  if (editing) {
    return (
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Título">
          <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Ex.: Política de trocas" autoFocus />
        </Field>
        <Field label="Conteúdo" hint="O texto que os agentes deste setor poderão consultar.">
          <Textarea rows={12} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
        </Field>
        {error ? <p style={{ margin: 0, color: 'var(--status-blocked)', fontSize: 13 }}>{error}</p> : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Conhecimento do setor</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>Base compartilhada por todos os agentes deste setor. Nada é salvo automaticamente.</p>
        </div>
        <Button variant="secondary" icon="plus" onClick={openNew}>
          Novo texto
        </Button>
      </div>

      {error ? <p style={{ margin: 0, color: 'var(--status-blocked)', fontSize: 13 }}>{error}</p> : null}

      {docs === null ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Carregando…</p>
      ) : docs.length === 0 ? (
        <EmptyState icon="book-open" title="Nenhum documento" body="Adicione textos que toda a equipe deve conhecer." />
      ) : (
        <div style={{ display: 'grid', gap: 10 }} data-testid="sector-knowledge-list">
          {docs.map((doc) => (
            <Card key={doc._id} padding="14px 16px" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--text-heading)' }}>{doc.title}</span>
                  <Tag>{SOURCE_LABEL[doc.source] ?? doc.source}</Tag>
                  <Tag color={doc.indexStatus === 'error' ? 'var(--status-blocked)' : undefined}>{INDEX_STATUS_LABEL[doc.indexStatus]}</Tag>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
                  Atualizado em {new Date(doc.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  {doc.chunkCount ? ` · ${doc.chunkCount} trecho(s)` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <Button variant="secondary" size="sm" icon="pencil" onClick={() => openEdit(doc._id)}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" icon="trash-2" onClick={() => remove(doc)}>
                  Excluir
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
