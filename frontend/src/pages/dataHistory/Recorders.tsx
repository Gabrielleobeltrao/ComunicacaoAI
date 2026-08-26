import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { AppLayout } from '../../components/AppLayout'
import { Badge, Button, Card, Dialog, EmptyState, Icon, IconButton } from '../../ui'
import { MODE_LABEL, SOURCE_LABEL, deleteRecorder, listRecorders } from '../../lib/dataHistory'
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
  const [aApagar, setAApagar] = useState<DataRecorder | null>(null)
  const navigate = useNavigate()

  const carregar = () => {
    listRecorders()
      .then(setLista)
      .catch((e) => setErro((e as Error).message))
  }
  useEffect(carregar, [])

  async function apagar() {
    if (!aApagar) return
    try {
      await deleteRecorder(aApagar.id)
      setAApagar(null)
      carregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

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
          <p role="alert" style={{ color: 'var(--intent-danger)', fontSize: 13 }} data-testid="recorders-error">
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
          <div className="flex flex-col gap-2" data-testid="recorder-list">
            {lista.map((r) => (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/historicos/${r.id}`)}
                    style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'transparent', padding: 0, minHeight: 44, cursor: 'pointer' }}
                    data-testid={`recorder-${r.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span style={{ fontWeight: 600 }}>{r.name}</span>
                      <Badge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'Ativo' : 'Desligado'}</Badge>
                      <Badge tone="brand">{MODE_LABEL[r.mode]}</Badge>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                      {SOURCE_LABEL[r.source.kind]} · {r.source.ref} · {r.recordCount.toLocaleString('pt-BR')} registro(s)
                    </p>
                    {r.lastError && (
                      <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--intent-danger)' }} data-testid="recorder-last-error">
                        {r.lastError.message}
                      </p>
                    )}
                  </button>
                  <IconButton icon="trash-2" label={`Apagar “${r.name}”`} onClick={() => setAApagar(r)} data-testid={`delete-recorder-${r.id}`} />
                </div>
              </Card>
            ))}
          </div>
        )}

        <p style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="info" size={14} />
          O dado ao vivo continua sendo só o valor de agora. O histórico é outra coisa, e só existe onde você pedir.
        </p>

        <Dialog
          open={aApagar !== null}
          title="Apagar este histórico?"
          subtitle={aApagar?.name}
          onClose={() => setAApagar(null)}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setAApagar(null)}>
                Cancelar
              </Button>
              <Button onClick={() => void apagar()} data-testid="confirm-delete-recorder">
                Apagar
              </Button>
            </div>
          }
        >
          <p style={{ margin: 0, fontSize: 13.5 }}>
            A regra e <strong>todos os registros que ela guardou</strong> são apagados. As fontes continuam funcionando — o que some é o histórico.
          </p>
        </Dialog>
      </div>
    </AppLayout>
  )
}
