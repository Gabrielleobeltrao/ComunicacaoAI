import type { WsDestination, WsDestinationKind, WsTargets } from '../../lib/websocketApp'
import { DESTINATION_LABEL } from '../../lib/websocketApp'
import { Field } from '../../ui'

/**
 * O DESTINO, e o que ele exige junto.
 *
 * Escolher "memória" sem dizer onde, ou "rotina" sem dizer qual, é uma configuração que
 * o servidor recusa — então a tela pergunta na hora, em vez de deixar salvar e falhar.
 *
 * As listas vêm todas da conta: um seletor nunca oferece o agente de outra pessoa.
 */

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-card)',
  color: 'var(--text-body)',
  fontSize: 13.5,
}

const DESTINOS: WsDestinationKind[] = ['history', 'memory', 'routine', 'agent', 'sector']
const ESCOPOS = [
  { value: 'agent', label: 'Do agente' },
  { value: 'sector', label: 'Do setor' },
  { value: 'floor', label: 'Do andar' },
  { value: 'building', label: 'Do prédio' },
] as const

/** A frase que explica o que aquele destino custa. Ler é mais barato que descobrir. */
const AVISO: Partial<Record<WsDestinationKind, string>> = {
  history: 'Guarda e para. É o mais barato: nenhuma execução, nenhum token.',
  memory: 'A memória é escrita direto, sem passar por modelo nenhum: nenhum token é gasto.',
  routine: 'A rotina roda pela fila de sempre, com a idempotência e a auditoria de sempre.',
  agent: 'O agente decide o que fazer com as permissões que ele já tem — um evento não ganha ferramenta por vir de fora. Isto consome tokens.',
  sector: 'O setor recebe pelo caminho de sempre, com as permissões dos agentes dele. Isto consome tokens.',
}

export function DestinationFields({
  destination,
  targets,
  onChange,
  prefix = '',
}: {
  destination: WsDestination
  targets: WsTargets | null
  onChange: (d: WsDestination) => void
  prefix?: string
}) {
  const escopo = destination.memoryScope ?? 'agent'
  const lista =
    destination.kind === 'routine'
      ? targets?.routines
      : destination.kind === 'sector' || (destination.kind === 'memory' && escopo === 'sector')
        ? targets?.sectors
        : destination.kind === 'memory' && escopo === 'floor'
          ? targets?.floors
          : targets?.agents

  const campo =
    destination.kind === 'routine'
      ? 'automationId'
      : destination.kind === 'sector' || (destination.kind === 'memory' && escopo === 'sector')
        ? 'sectorId'
        : destination.kind === 'memory' && escopo === 'floor'
          ? 'floorId'
          : 'agentId'

  // Prédio não pede seleção: a conta tem um, e ele é resolvido na escrita.
  const precisaEscolher = destination.kind !== 'history' && !(destination.kind === 'memory' && escopo === 'building')

  return (
    <>
      <Field label="O que fazer com o que chegar">
        <select
          style={selectStyle}
          value={destination.kind}
          onChange={(e) => onChange({ kind: e.target.value as WsDestinationKind })}
          data-testid={`${prefix}ws-sub-destination`}
        >
          {DESTINOS.map((d) => (
            <option key={d} value={d}>
              {DESTINATION_LABEL[d]}
            </option>
          ))}
        </select>
      </Field>

      {destination.kind === 'memory' ? (
        <Field label="Onde guardar">
          <select
            style={selectStyle}
            value={escopo}
            onChange={(e) => onChange({ kind: 'memory', memoryScope: e.target.value as typeof escopo })}
            data-testid={`${prefix}ws-sub-scope`}
          >
            {ESCOPOS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {precisaEscolher ? (
        <Field label={destination.kind === 'routine' ? 'Rotina' : campo === 'sectorId' ? 'Setor' : campo === 'floorId' ? 'Andar' : 'Agente'}>
          <select
            style={selectStyle}
            value={(destination as unknown as Record<string, string | null | undefined>)[campo] ?? ''}
            onChange={(e) => onChange({ ...destination, [campo]: e.target.value })}
            data-testid={`${prefix}ws-sub-target`}
          >
            <option value="">Escolha…</option>
            {(lista ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {AVISO[destination.kind] ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }} data-testid={`${prefix}ws-sub-note`}>
          {AVISO[destination.kind]}
        </p>
      ) : null}
    </>
  )
}
