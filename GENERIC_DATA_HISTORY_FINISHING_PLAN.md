# Plano de correção e acabamento — Histórico Genérico de Dados

## 1. Objetivo

Finalizar a implementação de `dataHistory` sem refazer a arquitetura já criada.

A base atual está correta: Live Data continua sendo estado atual, `dataHistory` guarda histórico genérico, `marketData` continua especializado em mercado, e o motor usa MongoDB/Event Bus/BullMQ/Tools existentes.

Esta rodada deve corrigir lacunas de UX, configuração e concorrência, mantendo compatibilidade com tudo que já funciona.

## 2. Não alterar

- Não substituir `dataHistory`.
- Não transformar `live_data` em histórico.
- Não remover o `marketData` atual.
- Não criar outro scheduler, event bus ou sistema de tools.
- Não criar lógica específica para BTC, ações, candles, estoque ou qualquer domínio.
- Não quebrar APIs atuais sem migração/compatibilidade.

## 3. Filtros configuráveis no frontend

O backend já aceita `filters`, mas a tela precisa permitir editar isso.

Adicionar editor de filtros com:
- path;
- operator;
- value;
- adicionar/remover condição.

Operadores suportados:
- exists;
- equals;
- not_equals;
- gt;
- gte;
- lt;
- lte;
- contains.

O modo `condition` só pode ser ativado se houver pelo menos um filtro válido.

## 4. Campos selecionados

Adicionar no frontend configuração de `selectedFields`.

Permitir:
- salvar valor inteiro;
- ou escolher uma lista de paths.

Exemplo:
`symbol`
`price`
`volume`
`data.total`

## 5. Escolha real da fonte

Não exigir que o usuário copie IDs internos.

Para `live_data`:
- carregar conexões disponíveis da conta;
- mostrar nome amigável + tipo;
- guardar internamente o ID/ref correto.

Para `event`:
- listar tipos de evento conhecidos;
- permitir busca;
- oferecer modo avançado de texto apenas quando necessário.

Para `manual`:
- manter nome livre.

A API deve continuar owner-scoped.

## 6. Agenda e timezone

O `schedule_snapshot` atual está limitado a uma hora/minuto UTC por dia.

Evoluir para reutilizar o scheduler/recurrence existente do projeto.

Suportar:
- a cada hora;
- diariamente em horário específico;
- dias da semana;
- cron/recorrência avançada;
- timezone IANA, ex. `America/New_York`.

Não criar scheduler paralelo.

Manter compatibilidade com definições antigas `{hour, minute}` e migrar/normalizar ao ler.

## 7. Bruto, agregado ou ambos

Adicionar política de persistência para recorder de janela:

- `aggregate_only`
- `raw_only`
- `raw_and_aggregate`

Quando `raw_and_aggregate` estiver ativo:
- fatos brutos são registros imutáveis;
- resultado da janela é outro registro;
- ambos devem ter dedupe independente;
- consulta deve permitir filtrar `recordKind: raw | aggregate | snapshot`.

Não salvar cada tick por padrão.

## 8. Cota atômica

Garantir que `MAX_RECORDS_PER_RECORDER` seja imposto atomicamente no banco.

Requisitos:
- dois workers não podem ultrapassar a cota por corrida;
- dedupe não deve consumir cota duas vezes;
- falha de insert não incrementa contador;
- não confiar apenas no `recordCount` cacheado;
- documentar se `recordCount` significa total histórico gravado ou armazenamento atual.

## 9. Preview real

A prévia deve continuar usando o mesmo motor e mostrar:
- fato aceito/filtrado;
- entityKey resolvida;
- occurredAt resolvido;
- valor final recortado;
- resultado agregado;
- motivo de recusa;
- raw/aggregate que seriam persistidos.

A prévia nunca grava estado permanente.

## 10. Tela de consulta

Melhorar para:
- escolher entityKey;
- período;
- tipo de registro;
- ordem;
- limite/paginação;
- exibir `occurredAt` e `recordedAt` separadamente;
- visualizar JSON formatado;
- identificar snapshot/agregado/bruto.

Não criar gráfico nesta rodada.

## 11. Tools

Revisar:
- `data_history.latest`
- `data_history.range`
- `data_history.aggregate`
- `data_history.series`

Adicionar suporte ao novo `recordKind` quando aplicável e manter owner isolation.

## 12. Segurança e validação

Manter:
- bloqueio de prototype pollution;
- limite de profundidade/tamanho;
- owner isolation;
- redaction;
- retenção/TTL.

Adicionar testes para paths inválidos e refs de outro owner.

## 13. Testes obrigatórios

Testar:
- editor de filtros;
- condition sem filtro;
- selectedFields;
- dropdown de conexões;
- source ref owner-scoped;
- tipos de evento;
- timezone;
- recorrência;
- compatibilidade com schedule legado;
- aggregate_only;
- raw_only;
- raw_and_aggregate;
- recordKind;
- cota atômica concorrente;
- dedupe + cota;
- preview sem efeitos colaterais;
- paginação;
- tools;
- regressão de WebSocket, Live Data e marketData.

## 14. Critérios de aceite

1. usuário configura tudo pela UI sem copiar IDs internos;
2. `condition` funciona de ponta a ponta;
3. selectedFields funciona na UI/backend;
4. schedule usa timezone/recorrência do sistema existente;
5. recorder de janela permite bruto/agregado/ambos;
6. cota é segura com múltiplos workers;
7. preview mostra exatamente o que seria gravado;
8. consultas distinguem tipos de registro;
9. APIs continuam owner-scoped;
10. lint, typecheck, build, backend tests e E2E ficam verdes.

## 15. Ordem sugerida

1. Auditar APIs atuais de dataHistory e fontes.
2. Corrigir modelo/validação com compatibilidade.
3. Implementar cota atômica.
4. Implementar persistPolicy/recordKind.
5. Integrar schedule ao scheduler existente.
6. Criar endpoints de discovery de fontes.
7. Completar formulário frontend.
8. Melhorar preview.
9. Melhorar consulta.
10. Ajustar tools.
11. Adicionar testes de concorrência/E2E.
12. Rodar suíte completa e corrigir regressões.
