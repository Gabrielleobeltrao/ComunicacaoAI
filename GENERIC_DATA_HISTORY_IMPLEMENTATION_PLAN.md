# Plano de implementação — Histórico e agregação genérica de dados

## 1. Objetivo

Criar uma camada de plataforma para registrar, organizar, consultar e agregar historicamente qualquer dado produzido ou recebido pelo sistema, sem ficar presa a WebSocket, trading, candles, ações ou a um provider específico.

A funcionalidade deve permitir que uma fonte de dados existente gere histórico por regras configuráveis:

- salvar toda ocorrência;
- salvar apenas quando o valor mudar;
- salvar snapshots a cada N segundos/minutos/horas;
- salvar uma vez por dia;
- manter primeiro/último valor de uma janela;
- calcular mínimo, máximo, média, soma e contagem;
- construir agregações temporais como OHLC sem tornar candle um conceito central da arquitetura.

Candles são apenas um caso de uso possível do mecanismo genérico.

## 2. Estado atual a preservar

Reaproveitar o que já existe:

- MongoDB como source of truth;
- BullMQ para jobs e scheduler;
- motor de Rotinas/Automações;
- barramento interno de eventos durável;
- WebSocket Genérico;
- Live Data Store com TTL e upsert por chave;
- normalização de payload WebSocket;
- tools/agentes capazes de ler Live Data;
- marketData engine especializado em trades, quotes e candles;
- owner-scoping, building-scoping, logs, auditoria e testes.

Não transformar `live_data` em histórico. Live Data continua respondendo apenas “qual é o valor atual?”.

Não substituir o `marketData` engine. Para mercado financeiro, ele continua sendo a implementação especializada quando semântica de trade/quote/candle for necessária.

Não criar um segundo event bus, scheduler, sistema de tools ou mecanismo de jobs.

## 3. Conceitos principais

### 3.1 Data Source

Origem lógica de dados que pode apontar para qualquer superfície existente:

- evento interno;
- Live Data;
- WebSocket;
- execução de tool;
- resultado de agente/código;
- rotina;
- webhook;
- API/integration futura.

A origem deve ser referenciada por configuração, sem acoplamento ao provider.

### 3.2 Recorder

Regra que decide quando um dado vira histórico.

Modos mínimos:

- `every_event` — persiste cada ocorrência aceita;
- `on_change` — persiste quando o valor/campo selecionado muda;
- `snapshot_interval` — persiste o último estado a cada intervalo;
- `window_aggregate` — agrega ocorrências em janelas e persiste um resultado;
- `schedule_snapshot` — snapshot em agenda/cron existente;
- `condition` — persiste apenas quando filtros/condições forem satisfeitos.

### 3.3 Historical Record

Registro histórico imutável, owner-scoped e associado a um recorder.

```ts
interface DataHistoryRecord {
  _id: ObjectId
  ownerId: string
  recorderId: ObjectId
  sourceKey: string
  entityKey: string | null
  occurredAt: Date
  recordedAt: Date
  windowStart: Date | null
  windowEnd: Date | null
  value: unknown
  schemaVersion: number
  dedupeKey: string
  expiresAt: Date | null
}
```

Criar índices para owner/recorder/entity/time e deduplicação.

### 3.4 Aggregation

Operações genéricas configuráveis por campo:

- `first`
- `last`
- `min`
- `max`
- `avg`
- `sum`
- `count`

Exemplo de candle sem dependência de trading:

```text
price first -> open
price max   -> high
price min   -> low
price last  -> close
volume sum  -> volume
```

O mesmo motor deve servir para estoque, sensores, pedidos, métricas etc.

## 4. Modelo de configuração

Criar coleção `data_recorders` ou nome equivalente.

```ts
interface DataRecorderDefinition {
  _id: ObjectId
  ownerId: string
  buildingId?: string | null
  name: string
  enabled: boolean
  source: DataSourceDefinition
  entityKeyPath?: string | null
  occurredAtPath?: string | null
  mode: RecorderMode
  intervalMs?: number | null
  schedule?: ExistingScheduleDefinition | null
  filters: ExistingConditionCompatibleFilter[]
  selectedFields?: string[] | null
  aggregations?: AggregationRule[]
  retentionDays?: number | null
  createdAt: Date
  updatedAt: Date
}
```

A definição não deve conter secrets.

## 5. Fonte genérica e eventos

Evitar criar um `EVENT_TYPE` diferente para cada dado de negócio.

Adicionar, se necessário, contrato genérico versionado como `data.updated`/`data.recordable`:

```json
{
  "source": "websocket:connection-id",
  "key": "BTCUSDT",
  "value": {},
  "occurredAt": "...",
  "metadata": {}
}
```

Antes de adicionar novo tipo, avaliar se `integration.websocket.message` ou outra superfície existente pode alimentar o recorder diretamente sem duplicar eventos.

A camada deve conseguir consumir eventos existentes por tipo/filtro e também ler snapshots do Live Data quando o modo exigir.

## 6. Window Aggregator

Implementar agregação determinística, sem LLM.

Requisitos:

- janelas UTC ou timezone configurado;
- intervalos 1m, 5m, 15m, 1h, 1d e customizáveis dentro de limites seguros;
- `first`/`last` definidos por `occurredAt`, não ordem de chegada;
- suporte a eventos atrasados enquanto a janela estiver aberta;
- fechamento idempotente;
- dedupe;
- recuperação após restart;
- persistência antes de publicar evento de janela fechada;
- não manter janela crítica apenas em memória.

Reaproveitar padrões robustos do `marketData` candle engine, sem fazer o módulo genérico depender dele.

## 7. Histórico bruto vs agregado

Permitir:

- apenas histórico bruto;
- apenas agregado;
- ambos.

Aplicar limites seguros para evitar milhões de registros acidentais. Permitir retenção configurável e TTL.

## 8. Tools para agentes e código

Adicionar tools determinísticas, owner-scoped:

- `data_history.latest`
- `data_history.range`
- `data_history.aggregate`
- `data_history.series`

Suportar recorder/source, entityKey, intervalo de datas, limite/paginação, ordenação e campos selecionados.

Não usar LLM para soma/média/min/max/OHLC.

## 9. Interface

Criar superfície reutilizando o design system.

Fluxo:

1. Nome do histórico
2. Escolher fonte
3. Escolher chave/entidade
4. Quando salvar
5. Campos a salvar
6. Agregações opcionais
7. Retenção
8. Testar configuração
9. Ativar

Exibir prévia antes de ativar.

Criar tela para consultar histórico por período/chave e visualizar JSON organizado. Gráficos são opcionais.

## 10. Integração com Live Data

Manter `live_data` independente.

- `snapshot_interval` lê o último valor;
- `on_change` deve preferencialmente ser disparado pelo fluxo que atualiza Live Data, sem polling desnecessário;
- não gravar histórico a cada tick se a regra não pedir.

## 11. Integração com marketData

Não remover nem reimplementar candles atuais.

O recorder genérico pode consumir `market.candle.closed` quando útil.

Para trading, continuar usando o engine especializado quando a semântica exigir trades reais, quotes e candles fechados.

## 12. Segurança e isolamento

- ownerId obrigatório;
- validar ownership de ids enviados pelo cliente;
- limitar tamanho/profundidade de payload;
- bloquear paths perigosos/prototype pollution;
- secrets nunca entram em histórico;
- aplicar redaction;
- quotas por owner/recorder para taxa, chaves e armazenamento.

## 13. Confiabilidade

- idempotência em inserts e fechamento de janelas;
- retries usando infraestrutura atual;
- dead-letter/erro visível;
- restart não pode perder janela;
- jobs duplicados não podem duplicar registros;
- separar timestamp externo (`occurredAt`) de `recordedAt`.

## 14. Testes obrigatórios

Testar:

- every_event;
- on_change;
- snapshot_interval;
- schedule_snapshot;
- filtros;
- first/last/min/max/avg/sum/count;
- múltiplas chaves;
- eventos fora de ordem;
- evento atrasado;
- restart;
- idempotência/dedupe;
- dois workers concorrentes;
- TTL/retenção;
- owner isolation;
- payload inválido/grande;
- integração com Live Data;
- integração com event bus;
- tools de consulta;
- compatibilidade com marketData.

## 15. Exemplo inicial — BTC sem acoplamento a candle

Fonte:

```text
Live Data -> WebSocket Genérico -> key BTCUSDT
```

Recorder:

```text
mode: window_aggregate
window: 5m
entityKey: symbol
price: first -> open
price: max -> high
price: min -> low
price: last -> close
volume: sum -> volume
```

Saída:

```json
{
  "symbol": "BTCUSDT",
  "windowStart": "...",
  "windowEnd": "...",
  "open": 100,
  "high": 110,
  "low": 98,
  "close": 108,
  "volume": 1234
}
```

O motor não sabe que isso é uma candle. É apenas uma agregação temporal configurada.

## 16. Critérios de aceite

1. qualquer fonte compatível pode ser registrada sem código específico do provider;
2. Live Data continua apenas como estado atual;
3. histórico bruto e agregado são persistidos separadamente;
4. agregações são determinísticas e não usam LLM;
5. agentes/código consultam séries e intervalos via tools;
6. marketData atual continua sem regressão;
7. restart/concorrência não duplicam nem perdem dados;
8. ownership, limites e retenção são respeitados;
9. frontend permite criar/testar/ativar recorder;
10. lint, typecheck, build e testes existentes + novos ficam verdes.

## 17. Ordem sugerida de implementação

1. Mapear infraestrutura atual e contratos reutilizáveis.
2. Criar domínio `dataHistory` com tipos/validação/store.
3. Implementar recorder de eventos.
4. Implementar snapshots de Live Data.
5. Implementar window aggregator.
6. Integrar scheduler/BullMQ somente pelos serviços existentes.
7. Criar tools de leitura.
8. Criar API/routes.
9. Criar frontend.
10. Testes de concorrência/restart/idempotência.
11. Validar compatibilidade com WebSocket e marketData.
12. Documentar exemplos genéricos e de mercado.
