import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { AppLayout } from '../../components/AppLayout'
import { Button, EmptyState, Icon } from '../../ui'
import { ListaDePastas } from '../../components/PastaDeDados'
import { MODE_LABEL, SOURCE_LABEL, deleteRecorder, listRecorders, updateRecorder } from '../../lib/dataHistory'
import type { DataRecorder } from '../../lib/dataHistory'

/**
 * Os históricos da conta.
 *
 * A tela fala de DADO, não de mecanismo: "o que guardar", "de onde vem", "quando".
 * Nenhuma palavra sobre janela, agregador ou coleção — quem abre isto quer saber o
 * preço de ontem, o estoque da semana passada ou quantos pedidos entraram por hora.
 */
export function DataRecorders() {
  const [lista, setLista] = useState<DataRecorder[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const navigate = useNavigate()

  const carregar = () => {
    listRecorders()
      .then(setLista)
      .catch((e) => setErro((e as Error).message))
  }
  useEffect(carregar, [])

  return (
    <AppLayout current="/historicos" title="Históricos" subtitle="Guarde o que acontece na sua operação e consulte depois — sem programar.">
      <div className="flex flex-col gap-4" data-testid="data-recorders">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            Um histórico guarda o que uma fonte produz. Vale para cotação, estoque, pedido, sensor ou qualquer dado do sistema.
          </p>
          <Button icon="plus" onClick={() => navigate('/historicos/novo')} data-testid="new-recorder">
            Novo histórico
          </Button>
        </div>

        {erro && (
          <p role="alert" style={{ color: 'var(--intent-danger-text)', fontSize: 13 }} data-testid="recorders-error">
            {erro}
          </p>
        )}

        {lista === null ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Carregando…</p>
        ) : lista.length === 0 ? (
          <EmptyState
            icon="database"
            title="Nenhum histórico ainda"
            body="Escolha uma fonte, diga quando guardar e o que guardar. Nada é gravado antes de você ativar."
          />
        ) : (
          /*
           * O MESMO DESENHO DOS DATABASES: uma pasta por histórico, e dentro dela o que ele
           * guarda. Eram duas telas com a mesma forma — um recipiente com itens — desenhadas
           * de dois jeitos; quem usa aprendia duas vezes a mesma coisa.
           */
          <ListaDePastas
            testid="recorder-list"
            aoMudar={carregar}
            pastas={lista.map((r) => ({
              chave: r.id,
              nome: r.name,
              detalhe: `${SOURCE_LABEL[r.source.kind]} · ${r.source.ref} · ${r.recordCount.toLocaleString('pt-BR')} registro(s)${r.lastError ? ` · ${r.lastError.message}` : ''}`,
              marcas: [
                { texto: r.enabled ? 'Ativo' : 'Desligado', tom: r.enabled ? ('success' as const) : ('neutral' as const) },
                { texto: MODE_LABEL[r.mode], tom: 'brand' as const },
              ],
              vazio: 'Guarda o registro inteiro — nenhum campo foi escolhido.',
              // Tirar um campo é mexer na regra, e a regra inteira volta com o campo a menos.
              itens: (r.selectedFields ?? []).map((campo) => ({
                chave: `${r.id}-${campo}`,
                nome: campo,
                aoApagar: () => updateRecorder(r.id, { selectedFields: (r.selectedFields ?? []).filter((c) => c !== campo) }),
                avisoAoApagar: `“${campo}” deixa de ser guardado daqui para a frente. O que já foi gravado continua lá.`,
              })),
              aoRenomear: (nome) => updateRecorder(r.id, { name: nome }),
              aoAbrirTela: () => navigate(`/historicos/${r.id}`),
              aoApagar: () => deleteRecorder(r.id),
              avisoAoApagar: 'A regra e todos os registros que ela guardou são apagados. As fontes continuam funcionando — o que some é o histórico.',
            }))}
          />
        )}

        <p style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="info" size={14} />
          O dado ao vivo continua sendo só o valor de agora. O histórico é outra coisa, e só existe onde você pedir.
        </p>

      </div>
    </AppLayout>
  )
}
