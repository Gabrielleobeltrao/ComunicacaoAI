import { useMemo, useState } from 'react'
import { Badge, Card, Select } from '../../ui'
import { OfficeFloor } from '../../office/OfficeFloor'
import type { Blueprint } from '../../lib/architect'
import { blueprintToOfficePreview, describeFloor } from './blueprintPreview'

// O escritório que a proposta vai virar — desenhado antes de existir.
//
// É o MESMO mapa da página inicial e da visão do andar, não um segundo desenho: um
// segundo estilo de mapa treinaria a pessoa a ler duas linguagens para a mesma coisa, e
// a prévia deixaria de parecer o que ela promete ser — o escritório dela.
//
// Somente leitura, e por três motivos que valem ser ditos: nada disso existe no banco,
// os ids são temporários (`preview:`), e um clique que "abrisse o agente" levaria a uma
// página de nada. Estado ao vivo também não é consultado: não há execução de um agente
// que ainda não foi criado.

export function OfficePreview({ blueprint }: { blueprint: Blueprint | null | undefined }) {
  // Deriva do blueprint a cada render: editar um nome, tirar um agente ou receber uma
  // revisão nova redesenha o mapa sem recarregar nada.
  const preview = useMemo(() => blueprintToOfficePreview(blueprint), [blueprint])
  const [andarKey, setAndarKey] = useState<string | null>(null)

  const andar = preview.floors.find((f) => f.key === andarKey) ?? preview.floors[0]

  if (preview.floors.length === 0) {
    return (
      <Card>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="architect-office-empty">
          O desenho do escritório aparece quando a proposta tiver pelo menos um andar.
        </p>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-testid="architect-office-preview">
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2" data-testid="architect-office-totals">
              <Badge tone="brand">{preview.totals.agents} {preview.totals.agents === 1 ? 'agente' : 'agentes'}</Badge>
              <Badge>{preview.totals.sectors} {preview.totals.sectors === 1 ? 'setor' : 'setores'}</Badge>
              <Badge>{preview.totals.floors} {preview.totals.floors === 1 ? 'andar' : 'andares'}</Badge>
            </div>
            {/* O seletor só existe quando há escolha: um seletor de um item é decoração. */}
            {preview.floors.length > 1 && (
              <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                Andar
                <Select
                  value={andar?.key ?? ''}
                  onChange={(e) => setAndarKey(e.target.value)}
                  data-testid="architect-office-floor-select"
                  style={{ minWidth: 200 }}
                >
                  {preview.floors.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>

          {/* O que o mapa mostra, em texto. Vale para quem usa leitor de tela e para
              quem não quer contar cadeira no desenho. O `id` amarra esta frase ao mapa
              logo abaixo: é ela que descreve aquele desenho, e não um parágrafo solto. */}
          <p id="architect-office-desc" style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="architect-office-description">
            {describeFloor(andar)}
          </p>

          <p style={{ fontSize: 12, color: 'var(--text-faint)' }} data-testid="architect-office-notice">
            Simulação do rascunho: nada aqui existe ainda. Os recursos só passam a existir quando você aplicar.
          </p>
        </div>
      </Card>

      {/*
        `readOnly`: sem estado ao vivo e sem navegação — ver OfficeFloor.

        SEM `role="img"`: o mapa tem controles de verdade dentro (aproximar, ajustar à
        tela, tela cheia), e uma imagem não contém botões — anunciá-lo como figura
        esconderia esses controles de quem navega por leitor de tela. É uma `section`
        com nome próprio, descrita pela frase acima.
      */}
      <section aria-label="Mapa do escritório proposto" aria-describedby="architect-office-desc" data-testid="architect-office-map">
        <OfficeFloor agents={andar?.agents ?? []} sectors={andar?.sectors ?? []} readOnly />
      </section>
    </div>
  )
}
