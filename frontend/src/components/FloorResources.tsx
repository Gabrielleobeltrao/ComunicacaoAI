import { useEffect, useState } from 'react'
import { Badge, Card } from '../ui'
import * as api from '../lib/resources'
import type { ResourceKind } from '../lib/resources'

// OS RECURSOS DESTE ANDAR — o mesmo catálogo, filtrado por contexto.
//
// Não é uma segunda lista: se fosse, ela divergiria da global na primeira regra que
// alguém esquecesse de repetir. Aqui a contagem vem do servidor, com o escopo do andar —
// e por isso ela é a mesma que a tela global mostraria com o mesmo filtro.

const ORDEM: ResourceKind[] = ['knowledge', 'app', 'tool', 'database']

/**
 * Para onde cada atalho leva — o lugar onde aquele tipo é GERIDO.
 *
 * Eles apontavam todos para `/resources`, a tela que era um espelho e saiu. Mandar para
 * o redirecionamento funcionaria, e seria um pulo a mais para chegar no mesmo lugar.
 * Conhecimento é o caso especial: ele mora NESTE andar, e o atalho só troca a visão.
 */
const destinoDe = (kind: ResourceKind, floorId: string): string =>
  kind === 'knowledge'
    ? `/floors/${floorId}?view=knowledge`
    : kind === 'database'
      ? '/databases'
      : kind === 'tool'
        ? '/apps?tab=custom'
        : '/apps'

export function FloorResources({ floorId }: { floorId: string }) {
  const [contagens, setContagens] = useState<Record<string, number> | null>(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let vivo = true
    api
      .listResources({ scopeType: 'floor', scopeId: floorId, limit: 1 })
      .then((r) => vivo && setContagens(r.byKind))
      .catch(() => vivo && setErro(true))
    return () => {
      vivo = false
    }
  }, [floorId])

  // Sem recurso nenhum, o bloco não é desenhado: um cartão dizendo "zero de tudo" ocupa
  // o mesmo espaço do bloco de verdade e não serve para nada.
  if (erro || !contagens) return null
  const total = Object.values(contagens).reduce((n, v) => n + v, 0)
  if (total === 0) return null

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3" data-testid="floor-resources">
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 13 }}>Recursos deste andar</strong>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>O que pertence a este andar. Cada atalho abre onde aquele tipo é gerido.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" style={{ marginLeft: 'auto' }}>
          {ORDEM.filter((k) => (contagens[k] ?? 0) > 0).map((k) => (
            <a
              key={k}
              href={destinoDe(k, floorId)}
              data-testid={`floor-resource-${k}`}
              // Alvo de toque de verdade: um atalho de 26px de altura é um atalho que
              // erra o dedo. O `Badge` desenha; quem precisa ser tocável é o link.
              style={{
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 'var(--hit-min, 44px)',
                padding: '0 4px',
              }}
            >
              <Badge>
                {contagens[k]} {api.KIND_LABEL[k]}
              </Badge>
            </a>
          ))}
        </div>
      </div>
    </Card>
  )
}
