# Plano de Implementação — Integrações, WebSocket, Market Data e Alpaca Paper

## Objetivo

Evoluir o ComunicacaoAI para integrar serviços externos, receber dados em tempo real e executar fluxos determinísticos sem transformar cada evento em uma chamada de LLM.

O trabalho deve ser incremental, retrocompatível e reaproveitar a arquitetura atual. Não reescrever o projeto inteiro, não criar protótipos desconectados do backend e não duplicar fontes de verdade.

## Estado atual que deve ser preservado

O projeto já possui:

- Apps oficiais, privados e futura origem community;
- `AppInstallation`/`connections` com configuração criptografada;
- grants e permissões de ações por agente;
- Custom Tools HTTP/REST;
- webhooks públicos de entrada;
- rotinas, scheduler e modos `collect_only`, `deterministic`, `ai`, `hybrid` e `automatic`;
- etapas `app.execute`, memória e execução por agente;
- executores `llm`, `function/code` e `tool` com contratos de entrada e saída;
- Execution Trace, métricas e auditoria;
- App oficial `candle_analyzer`, já implementado e testado, porém `coming_soon`.

Antes de alterar qualquer arquivo, confirmar esses caminhos no código atual e identificar mudanças feitas depois da criação deste plano.

## Regras arquiteturais obrigatórias

1. `Apps + AppInstallation/connections` continuam sendo a fonte única de credenciais e conexões. Não criar outra coleção concorrente de integrações.
2. Segredos são escritos uma vez, criptografados e nunca retornam ao frontend, prompts, responses, traces ou logs.
3. Ferramentas, Apps e agentes existentes continuam funcionando sem reconfiguração.
4. WebSocket roda no backend/worker, nunca no navegador.
5. Como API e worker podem ser processos diferentes, eventos operacionais não podem depender apenas de `EventEmitter` em memória.
6. Tick, quote e candle não entram automaticamente na memória de agente.
7. `agent.execute` continua sendo o único caminho que chama LLM. Processamento de mercado, indicadores, filtros e políticas devem ser determinísticos.
8. Instalar uma integração não concede acesso automático aos agentes.
9. Ações de trading e regras de risco são validadas por código no backend.
10. Alpaca começa exclusivamente em Paper Trading. Live não pode ser ativado automaticamente.

## Arquitetura-alvo

```text
Providers externos
  -> REST / WebSocket / Webhook
  -> AppInstallation + Credential Resolver
  -> HTTP Client / WebSocket Manager
  -> Event Bus durável
  -> Market Data Engine
  -> Apps e Code/Function Agents
  -> Rotinas e fluxos atuais
  -> LLM somente quando uma etapa explícita precisar
```

---

## Fase 1 — Generalizar integrações e reutilizar conexões nas ferramentas

### Backend

- Evoluir a instalação/conexão existente para comportar providers genéricos e os protocolos REST, WebSocket e API personalizada.
- Adicionar, somente quando necessário, metadados públicos como `providerKey`, `environment`, capacidades, status e `lastTestedAt`.
- Manter dentro da configuração criptografada: API key, secret, bearer token, basic auth, headers secretos e variáveis secretas.
- Permitir conexões `default`, `paper` e `live`, sem compartilhar automaticamente credenciais.
- Criar adapters/resolvers versionados por provider. Manifestos continuam sendo dados; somente adapters oficiais compilados podem executar código nativo.
- Adicionar à Custom Tool um vínculo opcional com `installationId` e modo de URL manual ou relativa.
- No modo conectado, persistir apenas path/endpoint, método, schemas, body, timeout e opções próprias. Resolver base URL, autenticação e headers no backend no momento da execução.
- Validar `ownerId`, status, versão, ambiente, domínio permitido e grants antes de executar.
- `installationId` ausente mantém exatamente a execução HTTP atual.

### Frontend

- Reaproveitar a página atual de Apps e criar dentro dela uma visão/aba minimalista de Conexões.
- Não criar no sidebar outra central concorrente chamada Integrações.
- Na ferramenta, oferecer `Configuração manual` ou uma conexão compatível.
- Esconder URL base e autenticação herdadas; mostrar somente conexão, path e resumo seguro.
- Configurações técnicas ficam recolhidas em `Avançado`.

### Critérios de aceite

- Ferramentas antigas continuam executando.
- Uma conexão pode ser reutilizada por várias ferramentas sem duplicar segredo.
- Um usuário nunca acessa conexão de outro.
- API nunca devolve segredo completo ou criptografado.
- Conexão revogada/expirada bloqueia execução com erro claro.

---

## Fase 2 — WebSocket Manager e Event Bus durável

### WebSocket Manager

- Executar no worker e possuir adapters por provider.
- Suportar URL, headers, autenticação inicial, subscribe, unsubscribe, heartbeat, timeout e reconexão com backoff e jitter.
- Estados: `disconnected`, `connecting`, `connected`, `reconnecting`, `error`, `paused`.
- Start/stop/subscribe/unsubscribe devem ser idempotentes.
- Restaurar streams ativos após reinício do worker.
- Controlar limite de conexões e subscriptions por proprietário.
- Nunca registrar credenciais ou payloads de autenticação.

### Event Bus

- Implementar transporte durável compatível com MongoDB atual, sem depender de serviço externo para o MVP.
- Eventos devem possuir `eventId`, `ownerId`, `type`, `source`, `schemaVersion`, `payload`, `occurredAt`, `dedupeKey`, status, tentativas e timestamps.
- Implementar publicação, consumo com lease/lock, idempotência, retry com backoff e dead-letter.
- Definir contratos iniciais:
  - `market.price.updated`;
  - `market.candle.closed`;
  - `market.signal.detected`;
  - `trade.order.created`;
  - `trade.order.filled`;
  - `trade.stop.triggered`;
  - `trade.position.closed`.

### Interface

- Na conexão, mostrar estado, última conexão, último evento, última falha e ações testar, pausar e reconectar.
- Diagnóstico detalhado fica em área avançada.

### Critérios de aceite

- Reconecta depois de queda e reinício do worker.
- Evento duplicado não gera processamento duplicado.
- Eventos ficam isolados por proprietário.
- Falha permanente vai para dead-letter sem loop infinito.

---

## Fase 3 — Market Data Engine genérico

### Domínio e normalização

- Criar contratos versionados para `trade`, `quote`, `bar` e `candle`.
- Normalizar formatos diferentes dos providers para o contrato interno.
- Tratar mensagens duplicadas, atrasadas e fora de ordem.
- Manter último preço/quote por provider, conta, símbolo e ambiente.

### Candles

- Suportar `1m`, `5m`, `15m`, `1h`, `4h` e `1D`.
- Agregar timeframes maiores a partir de candles menores.
- Fechar cada candle exatamente uma vez.
- Publicar `market.candle.closed` somente depois do fechamento.

### Persistência

- Estado atual em cache/coleção com TTL adequado.
- Candles em coleção própria com índices por owner/provider/symbol/timeframe/timestamp e política de retenção.
- Persistência de ticks brutos desativada por padrão e configurável somente com limite.
- Nenhum dado de mercado entra na memória de agente automaticamente.

### Integração com análise existente

- Reutilizar o App `candle_analyzer`; não duplicar indicadores ou padrões.
- Entregar ao App a série OHLCV fechada usando seu contrato atual.
- Continuar `coming_soon` até o fluxo completo da Fase 4 ser aprovado.

### Critérios de aceite

- OHLCV e agregações corretos em testes determinísticos.
- Reinício não duplica candle fechado.
- Esta camada realiza zero chamadas de LLM e registra zero tokens.

---

## Fase 4 — Gatilhos internos, agentes e rotinas

### Automations

- Estender a estrutura atual com trigger `internal_event`, separado do webhook público.
- Permitir selecionar tipo de evento, conexão/provider, símbolos, timeframe e condições.
- O payload entra como dado estruturado e pode alimentar `app.execute`, memória, transformação ou Code Agent.
- Preservar os modos de execução atuais.
- Em `collect_only` e `deterministic`, nunca inserir `agent.execute`.
- Em `hybrid`/`automatic`, chamar LLM somente mediante condição explícita e registrada no trace.

### Permissões

- Estender grants apenas no necessário para recursos/subscriptions.
- O agente recebe somente ações e fontes autorizadas.
- Instalação sem grant não aparece como ferramenta executável.
- Writes e ações críticas continuam exigindo autorização autônoma explícita.

### Candle Analyzer

- Conectar `market.candle.closed` ao `candle_analyzer` via execução determinística.
- Permitir que somente um sinal relevante publique `market.signal.detected` ou avance para memória/LLM.
- Após E2E completo, mudar `availability` para `available`.

### Interface

- Adicionar configuração simples `Evento de mercado` na área de gatilhos do agente.
- Mostrar resumo humano: evento, símbolos, timeframe, condição e modo.
- JSON, filtros técnicos e retries ficam em `Avançado`.

### Observabilidade

- Execution Trace deve mostrar evento, filtros, etapas determinísticas, motivo para chamar ou ignorar IA, tokens e resultado.

### Critérios de aceite

- Evento real ou simulado percorre o fluxo completo.
- Modo determinístico consome zero tokens.
- Payload incompatível falha no contrato antes de chegar ao próximo passo.

---

## Fase 5 — Alpaca como primeiro provider real

### App oficial Alpaca

- Implementar como App oficial e adapter compilado usando as abstrações anteriores.
- Criar instalação `Alpaca Paper` com credenciais criptografadas.
- URLs e regras do provider ficam no adapter; não espalhar condicionais Alpaca pelo sistema.
- Suportar market data REST e WebSocket com trades, quotes e bars.
- Suportar brokerage: conta, buying power, posições, listar/criar/cancelar/substituir ordens e fechar posição.
- Suportar bracket order com entrada, stop-loss e take-profit.

### Risco das ações

- Consultas: `read`.
- Alterações não críticas: `write`.
- Criar/cancelar/substituir ordem e fechar posição: `high_risk`.
- Grant e autorização autônoma devem ser específicos por ação.

### Paper versus Live

- Exibir selo `PAPER` de forma clara.
- Preparar o campo `live`, mas mantê-lo bloqueado/indisponível neste ciclo.
- Nunca enviar ordens reais em testes ou seeds.

### Critérios de aceite

- Todos os testes usam mocks/fixtures.
- REST, stream, rate limit e erros são traduzidos para contratos internos.
- Nenhuma credencial aparece em prompt, trace ou log.

---

## Fase 6 — Políticas determinísticas e hardening para produção

### Policy Engine

Criar políticas versionadas por instalação e/ou agente para:

- valor máximo por operação;
- quantidade máxima;
- percentual máximo da carteira;
- perda diária máxima;
- máximo de operações por dia;
- stop-loss obrigatório;
- take-profit obrigatório;
- impedir posição duplicada;
- allowlist de símbolos;
- bloquear short;
- bloquear opções;
- restringir horários.

Todas devem ser reavaliadas no backend imediatamente antes da chamada ao provider. Não confiar em LLM, frontend ou prompt.

### Segurança de execução

- Revalidar owner, grant, environment, status da conexão e policy.
- Usar idempotency key para ordens.
- Não repetir automaticamente uma escrita cujo resultado ficou incerto.
- Implementar reconciliação/consulta do status antes de nova tentativa.
- Paper e Live nunca compartilham credenciais ou políticas automaticamente.

### Logs e auditoria

- Registrar agente, rotina, etapa, conexão, ambiente, ação, validações, latência, status, orderId e timestamps.
- Redigir authorization, cookies, tokens, secrets, payloads de autenticação e campos marcados como sensíveis.
- Não transformar market ticks em logs de auditoria individuais.

### Interface

- Configuração principal curta e guiada.
- Políticas ficam em seção `Segurança`.
- Opções raras e técnicas ficam em `Avançado`.
- Antes de ação high-risk, mostrar ambiente e política aplicada.

---

## Migração e compatibilidade

- Fazer mudanças aditivas e defaults retrocompatíveis.
- Ferramenta antiga sem conexão continua manual.
- Instalação antiga continua legível.
- Agente LLM existente continua funcionando.
- Webhook e rotina existentes conservam comportamento.
- `internal_event` não altera gatilhos públicos.
- Migrações devem ser idempotentes e seguras para reexecução.
- Não apagar campos antigos antes de confirmar migração e uso em produção.

## Estratégia de testes

Após cada fase:

1. testes unitários dos contratos e regras;
2. integrações com Mongo e adapters simulados;
3. regressão dos agentes, Apps, tools, webhooks e rotinas atuais;
4. frontend lint/test/build;
5. backend build/test;
6. E2E das telas e fluxos afetados;
7. `git diff --check`;
8. revisar que nenhum secret ou payload sensível aparece em DTOs, logs ou snapshots.

Testes obrigatórios adicionais:

- isolamento por owner;
- conexão revogada;
- restart do worker;
- idempotência de eventos e ordens;
- zero tokens em processamento determinístico;
- erro de contrato entre etapas;
- impossibilidade de Live operar sem suporte e autorização explícitos.

## Protocolo de execução para o Claude

1. Trabalhar na branch de desenvolvimento atual; não fazer merge na `main`.
2. Antes de cada fase, reler o código afetado e adaptar o plano ao que já existe.
3. Implementar uma fase por vez, em mudanças pequenas.
4. Não deixar tela sem persistência/backend real.
5. Não avançar enquanto build e testes relevantes da fase atual falharem.
6. Se encontrar conflito arquitetural, escolher a solução que reutiliza os serviços atuais e documentar a decisão.
7. Não remover APIs ou comportamento legado sem migração.
8. Não habilitar Alpaca Live.
9. Prosseguir automaticamente até concluir todas as fases, salvo bloqueio que exija credencial externa ou decisão impossível de inferir com segurança.

## Entrega final

Ao concluir, apresentar:

- resumo por fase;
- arquivos criados e alterados;
- migrations e índices;
- novos models, endpoints e workers;
- variáveis de ambiente novas, sem valores secretos;
- como cadastrar conexão REST e WebSocket;
- como vincular uma conexão a uma ferramenta;
- como conceder permissões a um agente;
- como configurar e testar Alpaca Paper sem dinheiro real;
- evidências de testes/build;
- limitações conhecidas e itens deliberadamente deixados fora do MVP.
