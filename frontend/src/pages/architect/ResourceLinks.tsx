import { useEffect, useState } from 'react'
import { Button, Card, Select } from '../../ui'
import * as api from '../../lib/architect'
import type { ArchitectProject, ArchitectTargets, BlueprintLink } from '../../lib/architect'
import { KIND_LABEL } from './shared'

// Escolher um recurso REAL para um item da proposta.
//
// A lista vem do servidor e só tem o que é desta conta — e o servidor confere a posse
// de novo ao gravar, porque esta lista pode estar velha. O modelo nunca preenche este
// campo: ele propõe reutilizar, e quem diz QUAL é quem está aqui.

type Kind = BlueprintLink['kind']
const ORDEM: Kind[] = ['floor', 'agent', 'sector', 'routine']

const VAZIO: ArchitectTargets = { floors: [], agents: [], sectors: [], routines: [] }

/** Mesmo nome, ignorando acento, caixa e espaço sobrando. */
const normal = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

export function ResourceLinks({ project, onSalvar, carregando }: { project: ArchitectProject; onSalvar: (links: BlueprintLink[]) => void; carregando: boolean }) {
  const [alvos, setAlvos] = useState<ArchitectTargets>(VAZIO)
  const [escolhas, setEscolhas] = useState<Record<string, string>>({})

  useEffect(() => {
    api.listTargets().then(setAlvos).catch(() => setAlvos(VAZIO))
  }, [])

  const bp = project.blueprint
  if (!bp) return null

  const itens: { kind: Kind; key: string; label: string; action: string; resourceId?: string | null }[] = [
    ...(bp.floors ?? []).map((f) => ({ kind: 'floor' as const, key: f.key, label: f.name, action: (f as { action?: string }).action ?? 'create', resourceId: (f as { resourceId?: string }).resourceId })),
    ...(bp.agents ?? []).map((a) => ({ kind: 'agent' as const, key: a.key, label: a.name, action: (a as { action?: string }).action ?? 'create', resourceId: (a as { resourceId?: string }).resourceId })),
    ...(bp.sectors ?? []).map((s) => ({ kind: 'sector' as const, key: s.key, label: s.name, action: (s as { action?: string }).action ?? 'create', resourceId: (s as { resourceId?: string }).resourceId })),
    ...(bp.routines ?? []).map((r) => ({ kind: 'routine' as const, key: r.key, label: r.name, action: (r as { action?: string }).action ?? 'create', resourceId: (r as { resourceId?: string }).resourceId })),
  ].sort((a, b) => ORDEM.indexOf(a.kind) - ORDEM.indexOf(b.kind))

  const opcoes = (kind: Kind) =>
    kind === 'floor' ? alvos.floors : kind === 'agent' ? alvos.agents : kind === 'sector' ? alvos.sectors : alvos.routines

  /**
   * O recurso que a proposta quis dizer.
   *
   * O modelo propõe reaproveitar identificando pelo NOME — ele não pode escrever id, e
   * não escreve. Sem esta ponte, a pessoa recebia um item marcado como "reaproveitar",
   * um select aberto em "Criar novo" e um erro de validação dizendo para escolher o
   * recurso: ela tinha que adivinhar qual, numa lista que pode ter dezenas.
   *
   * Quem grava continua sendo ela: isto pré-seleciona, e o servidor confere a posse.
   */
  const sugestaoDe = (item: (typeof itens)[number]) => {
    if (item.action === 'create' || item.resourceId) return null
    const iguais = opcoes(item.kind).filter((o) => normal(o.name) === normal(item.label))
    // Dois recursos com o mesmo nome: aí não há sugestão possível, e adivinhar seria
    // ligar a proposta ao recurso errado sem ninguém perceber.
    return iguais.length === 1 ? iguais[0] : null
  }

  const valorDe = (item: (typeof itens)[number]) => {
    const escolhido = escolhas[`${item.kind}:${item.key}`]
    if (escolhido !== undefined) return escolhido
    if (item.action !== 'create' && item.resourceId) return `${item.action}|${item.resourceId}`
    if (item.action === 'create') return ''
    const sugerido = sugestaoDe(item)
    return sugerido ? `${item.action}|${sugerido.id}` : ''
  }

  function salvar() {
    const links: BlueprintLink[] = itens
      .map((item) => {
        const escolhido = valorDe(item)
        if (!escolhido) return { kind: item.kind, key: item.key, action: 'create' as const }
        const [acao, id] = escolhido.split('|')
        return { kind: item.kind, key: item.key, action: acao as 'reuse' | 'update', resourceId: id }
      })
      // Só o que MUDOU: mandar tudo faria toda revisão reescrever a proposta inteira.
      .filter((l, i) => l.action !== itens[i].action || (l.resourceId ?? null) !== (itens[i].resourceId ?? null))
    if (links.length) onSalvar(links)
  }

  const total = opcoes('floor').length + opcoes('agent').length + opcoes('sector').length + opcoes('routine').length

  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid="architect-links-editor">
        <strong style={{ fontSize: 13 }}>Aproveitar o que já existe</strong>
        {total === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="architect-no-targets">
            Esta conta ainda não tem andares, agentes ou setores para reaproveitar. Tudo será criado.
          </p>
        ) : (
          <>
            {itens.map((item) => {
              const sugerido = sugestaoDe(item)
              return (
              <label key={`${item.kind}:${item.key}`} className="flex flex-col gap-1" style={{ fontSize: 12.5 }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {KIND_LABEL[item.kind]}: {item.label}
                </span>
                {sugerido && (
                  <span style={{ color: 'var(--text-muted)' }} data-testid={`architect-link-suggested-${item.kind}-${item.key}`}>
                    A proposta pediu para reaproveitar — encontrei “{sugerido.name}” com este nome. Confirme abaixo.
                  </span>
                )}
                <Select
                  data-testid={`architect-link-${item.kind}-${item.key}`}
                  value={valorDe(item)}
                  onChange={(e) => setEscolhas((atual) => ({ ...atual, [`${item.kind}:${item.key}`]: e.target.value }))}
                >
                  <option value="">Criar novo</option>
                  {opcoes(item.kind).map((o) => (
                    <optgroup key={o.id} label={o.name}>
                      <option value={`reuse|${o.id}`}>Usar “{o.name}” como está</option>
                      <option value={`update|${o.id}`}>Usar “{o.name}” e aplicar as mudanças</option>
                    </optgroup>
                  ))}
                </Select>
              </label>
              )
            })}
            <div>
              <Button variant="secondary" onClick={salvar} disabled={carregando} data-testid="architect-links-save">
                {itens.some((i) => sugestaoDe(i)) ? 'Confirmar escolhas' : 'Salvar escolhas'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
