import { useEffect, useState } from 'react'
import { Badge, Button, Card, Input, Textarea } from '../ui'
import { MessageContent } from '../components/MessageContent'
import * as api from '../lib/knowledge'
import type { Authority, KnowledgeDoc, KnowledgeScopeType, LifecycleStatus } from '../lib/knowledge'

// O EDITOR — Markdown de um lado, prévia do outro.
//
// A prévia usa o MESMO renderizador seguro das mensagens: um segundo caminho de
// renderização é um segundo lugar onde um HTML colado pode escapar.
//
// A curadoria (autoridade, validade, revisão) fica aqui e não numa tela à parte, porque
// é no momento de escrever que a pessoa sabe se aquilo é política ou anotação — perguntar
// depois é receber "referência" em tudo.

const AUTORIDADES: Authority[] = ['official_policy', 'procedure', 'reference', 'note']
const CICLOS: LifecycleStatus[] = ['draft', 'approved', 'archived']

export function KnowledgeEditor({
  documentId,
  escopo,
  onSalvo,
  onFechar,
}: {
  documentId: string | null
  escopo: { scopeType: KnowledgeScopeType; scopeId: string | null; label: string }
  onSalvo: (doc: KnowledgeDoc) => void
  onFechar: () => void
}) {
  const [doc, setDoc] = useState<KnowledgeDoc | null>(null)
  const [titulo, setTitulo] = useState('')
  const [conteudo, setConteudo] = useState('')
  const [autoridade, setAutoridade] = useState<Authority>('reference')
  const [ciclo, setCiclo] = useState<LifecycleStatus>('approved')
  const [validade, setValidade] = useState('')
  const [revisao, setRevisao] = useState('')
  const [aba, setAba] = useState<'escrever' | 'previa'>('escrever')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(Boolean(documentId))

  useEffect(() => {
    if (!documentId) return
    let vivo = true
    setCarregando(true)
    api
      .getDocument(documentId)
      .then((d) => {
        if (!vivo) return
        setDoc(d)
        setTitulo(d.title)
        setConteudo(d.content ?? '')
        setAutoridade(d.authority)
        setCiclo(d.lifecycleStatus)
        setValidade(d.validUntil ? d.validUntil.slice(0, 10) : '')
        setRevisao(d.reviewIntervalDays ? String(d.reviewIntervalDays) : '')
      })
      .catch((e) => vivo && setErro((e as Error).message))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [documentId])

  const salvar = async () => {
    setSalvando(true)
    setErro(null)
    try {
      const campos = {
        title: titulo,
        content: conteudo,
        authority: autoridade,
        lifecycleStatus: ciclo,
        validUntil: validade ? new Date(`${validade}T23:59:59.000Z`).toISOString() : null,
        reviewIntervalDays: revisao ? Number(revisao) : null,
      }
      const salvo = documentId
        ? await api.updateDocument(documentId, campos)
        : await api.createDocument({ ...campos, scopeType: escopo.scopeType, scopeId: escopo.scopeId })
      setDoc(salvo)
      onSalvo(salvo)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const reindexar = async () => {
    if (!documentId) return
    setErro(null)
    try {
      setDoc(await api.reindexDocument(documentId))
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="knowledge-editor">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong style={{ fontSize: 14 }}>{documentId ? 'Editar documento' : 'Adicionar conhecimento'}</strong>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>em {escopo.label}</span>
        </div>

        {carregando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando…</p>}

        <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Título
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} data-testid="knowledge-editor-title" />
        </label>

        {/* Abas no celular; no desktop as duas colunas cabem lado a lado. */}
        <div className="flex gap-2" role="tablist" aria-label="Editor">
          {(['escrever', 'previa'] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={aba === a}
              onClick={() => setAba(a)}
              data-testid={`knowledge-editor-tab-${a}`}
              style={{
                minHeight: 36,
                padding: '0 12px',
                borderRadius: 999,
                border: '1px solid var(--border-subtle)',
                background: aba === a ? 'var(--intent-brand)' : 'var(--surface-card)',
                color: aba === a ? '#fff' : 'var(--text-muted)',
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              {a === 'escrever' ? 'Escrever' : 'Prévia'}
            </button>
          ))}
        </div>

        {aba === 'escrever' ? (
          <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Conteúdo (Markdown — use [[Título]] para ligar a outro documento)
            <Textarea rows={12} value={conteudo} onChange={(e) => setConteudo(e.target.value)} data-testid="knowledge-editor-content" />
          </label>
        ) : (
          <div data-testid="knowledge-editor-preview" style={{ padding: 12, borderRadius: 10, background: 'var(--surface-sunken)', minHeight: 120 }}>
            <MessageContent content={conteudo || '_Nada escrito ainda._'} />
          </div>
        )}

        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Autoridade
            <select value={autoridade} onChange={(e) => setAutoridade(e.target.value as Authority)} data-testid="knowledge-editor-authority" style={selectStyle}>
              {AUTORIDADES.map((a) => (
                <option key={a} value={a}>
                  {api.AUTHORITY_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Situação
            <select value={ciclo} onChange={(e) => setCiclo(e.target.value as LifecycleStatus)} data-testid="knowledge-editor-lifecycle" style={selectStyle}>
              {CICLOS.map((c) => (
                <option key={c} value={c}>
                  {api.LIFECYCLE_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Vale até
            <Input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} data-testid="knowledge-editor-valid-until" />
          </label>
          <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Revisar a cada (dias)
            <Input type="number" min={1} value={revisao} onChange={(e) => setRevisao(e.target.value)} data-testid="knowledge-editor-review" />
          </label>
        </div>

        {doc && (
          <div className="flex flex-wrap items-center gap-2" data-testid="knowledge-editor-state">
            <Badge tone={doc.indexStatus === 'indexed' ? 'success' : doc.indexStatus === 'error' ? 'danger' : 'warning'}>
              {doc.indexStatus === 'indexed' ? `${doc.chunkCount} trecho(s) indexado(s)` : doc.indexStatus === 'error' ? 'erro ao indexar' : 'indexando…'}
            </Badge>
            {/* O erro de embedding é acionável: o texto foi salvo, o que falhou foi a
                indexação — e tentar de novo é a ação, não recomeçar. */}
            {doc.indexStatus === 'error' && (
              <>
                <span style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }}>{doc.indexError}</span>
                <Button variant="secondary" onClick={reindexar} data-testid="knowledge-editor-reindex">
                  Tentar novamente
                </Button>
              </>
            )}
          </div>
        )}

        {doc && doc.links.length > 0 && (
          <div className="flex flex-col gap-1">
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Ligações</span>
            {doc.links.map((l) => (
              <span key={l.target} style={{ fontSize: 12.5, color: l.resolvedDocumentId ? 'var(--text-muted)' : 'var(--intent-warning)' }}>
                {l.target}
                {!l.resolvedDocumentId && ' — não encontrado nesta base'}
              </span>
            ))}
          </div>
        )}

        {erro && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="knowledge-editor-error">
            {erro}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={salvar} disabled={salvando || !titulo.trim() || !conteudo.trim()} data-testid="knowledge-editor-save">
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button variant="secondary" onClick={onFechar}>
            Fechar
          </Button>
        </div>
      </div>
    </Card>
  )
}

const selectStyle: React.CSSProperties = {
  minHeight: 40,
  padding: '0 10px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-card)',
  color: 'var(--text-strong, inherit)',
  fontSize: 13,
}
