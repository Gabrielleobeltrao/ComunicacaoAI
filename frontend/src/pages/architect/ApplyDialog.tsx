import { useState } from 'react'
import { Button, Checkbox, Dialog, Icon } from '../../ui'
import type { ArchitectPreview } from '../../lib/architect'
import { ACTION_LABEL, KIND_LABEL } from './shared'

/**
 * A confirmação.
 *
 * Duas coisas exigem um clique a mais, cada uma por um motivo. Alteração em recurso que
 * já existe vem DESMARCADA: quem abriu a tela para criar uma operação não espera que
 * ela mexa no que já estava lá. E permissão de App vem desmarcada porque dar acesso a
 * uma conexão é uma decisão à parte de criar um agente.
 */
export function ApplyDialog({
  preview,
  aberto,
  aplicando,
  erro,
  onFechar,
  onConfirmar,
}: {
  preview: ArchitectPreview
  aberto: boolean
  aplicando: boolean
  erro: string | null
  onFechar: () => void
  onConfirmar: (aprovado: { approvedAppKeys: string[]; approvedUpdateKeys: string[] }) => void
}) {
  const alteracoes = preview.items.filter((i) => i.requiresApproval)
  const apps = preview.items.filter((i) => i.kind === 'app' && i.action !== 'wait_user')
  const [aprovados, setAprovados] = useState<string[]>([])
  const [alteracoesOk, setAlteracoesOk] = useState<string[]>([])

  const podeAplicar = alteracoes.every((a) => alteracoesOk.includes(a.key)) && !aplicando

  return (
    <Dialog open={aberto} onClose={onFechar} title="Revisar antes de aplicar">
      <div className="flex flex-col gap-3" data-testid="architect-apply-dialog" style={{ maxHeight: '70dvh', overflowY: 'auto' }}>
        <p style={{ fontSize: 13 }}>
          Vou criar {preview.counts.create} {preview.counts.create === 1 ? 'item' : 'itens'}.
          {preview.counts.waitUser > 0 && ` ${preview.counts.waitUser} ${preview.counts.waitUser === 1 ? 'depende' : 'dependem'} de você e ficam pendentes.`}
        </p>

        <ul style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyle: 'none' }}>
          {preview.items
            .filter((i) => i.action === 'create')
            .map((i) => (
              <li key={`${i.kind}-${i.key}`} style={{ fontSize: 13, display: 'flex', gap: 6 }}>
                <Icon name="plus" size={14} color="var(--intent-brand)" />
                <span style={{ overflowWrap: 'anywhere' }}>
                  {KIND_LABEL[i.kind]}: {i.label}
                </span>
              </li>
            ))}
        </ul>

        {alteracoes.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="architect-approve-updates">
            <strong style={{ fontSize: 13 }}>Estas mudanças mexem em algo que já existe</strong>
            {alteracoes.map((a) => (
              <Checkbox
                key={a.key}
                checked={alteracoesOk.includes(a.key)}
                onChange={(v) => setAlteracoesOk((atual) => (v ? [...atual, a.key] : atual.filter((k) => k !== a.key)))}
                label={`${ACTION_LABEL[a.action]} ${KIND_LABEL[a.kind]}: ${a.label}`}
              />
            ))}
          </div>
        )}

        {apps.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="architect-approve-apps">
            <strong style={{ fontSize: 13 }}>Dar acesso a estes Apps</strong>
            {apps.map((a) => (
              <Checkbox
                key={a.key}
                checked={aprovados.includes(a.label)}
                onChange={(v) => setAprovados((atual) => (v ? [...atual, a.label] : atual.filter((k) => k !== a.label)))}
                label={a.label}
              />
            ))}
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sem marcar, os agentes são criados sem acesso e o item fica na checklist.</p>
          </div>
        )}

        {erro && (
          <p role="alert" style={{ color: 'var(--intent-danger)', fontSize: 13 }} data-testid="architect-apply-error">
            {erro}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onFechar} disabled={aplicando}>
            Cancelar
          </Button>
          {/* O que foi marcado VAI no pedido, e o servidor confere de novo. Sem isto,
              o checkbox seria só um pedágio visual antes de aplicar tudo. */}
          <Button onClick={() => onConfirmar({ approvedAppKeys: aprovados, approvedUpdateKeys: alteracoesOk })} disabled={!podeAplicar} data-testid="architect-apply-confirm">
            {aplicando ? 'Aplicando…' : 'Confirmar e criar'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
