# ComunicaçãoAI — Plano de Pivot para Prédio Operacional de IAs

> Plano mestre de implementação para execução pelo Claude Code.
>
> Repositório: `Gabrielleobeltrao/ComunicacaoAI`
>
> Branch-base analisada: `main`
>
> Commit de referência no momento da elaboração: `6d4f809d1c3bfc5bc49e0ed725c13f68b0f2e10f`
>
> Estado deste documento: especificação de produto, arquitetura, migração, implementação e QA.

---

## 1. Objetivo executivo

Transformar a ComunicaçãoAI de uma plataforma centrada em chat/atendimento em um **prédio operacional de inteligências artificiais**.

O produto deverá permitir que uma pessoa construa seu prédio virtual, crie andares com missões diferentes, organize agentes em salas/setores e configure automações que executam trabalhos de forma manual, agendada ou acionada por eventos. Os resultados poderão ser salvos como entregáveis e enviados por diferentes canais.

O chat incorporável, o WhatsApp, as conversas e toda a estrutura atual de atendimento **não serão removidos**. Eles passam a ser capacidades especializadas dentro do prédio, principalmente no andar de Atendimento, e deixam de ser o centro conceitual de toda a aplicação.

Nova tese do produto:

> A ComunicaçãoAI é um prédio operacional de IAs. Cada andar possui uma missão, cada sala reúne uma especialidade, os agentes realizam trabalhos por meio de automações e cada execução produz resultados rastreáveis e entregáveis.

O eixo principal do sistema passa de:

`mensagem → resposta`

para:

`gatilho → automação → execução → entregável → envio`

---

## 2. Resultado esperado para o usuário

Ao final deste plano, o usuário deverá conseguir:

1. Entrar em uma visão geral do seu prédio.
2. Criar, editar, arquivar e alternar entre vários andares.
3. Definir nome, missão, descrição, fuso horário e preferências de cada andar.
4. Entrar em um andar e ver apenas suas salas, seus agentes e sua atividade.
5. Continuar criando agentes, setores, widgets e canais de WhatsApp sem regressões.
6. Criar uma automação por um assistente estruturado.
7. Escolher se ela será manual, agendada ou acionada por webhook.
8. Definir fonte de dados, agentes participantes, etapas, formato de saída e destinos.
9. Testar uma automação antes de ativá-la.
10. Executá-la manualmente ou deixá-la rodar de forma recorrente.
11. Acompanhar cada execução, etapa, ferramenta utilizada, consumo e erro.
12. Pausar, retomar ou cancelar uma execução quando tecnicamente possível.
13. Consultar relatórios, resumos e outros entregáveis produzidos.
14. Receber resultados por e-mail e Telegram no primeiro MVP operacional.
15. Continuar usando widget web e WhatsApp como canais conversacionais.
16. Ver o escritório animado refletir, progressivamente, o estado operacional real dos agentes.

Exemplo mínimo obrigatório:

> Em um andar chamado “Inteligência e Pesquisa”, criar uma automação chamada “Resumo diário de notícias”, executada todos os dias às 8h no fuso escolhido. Ela busca itens de fontes RSS/URLs permitidas das últimas 24 horas, remove duplicatas, pede a um agente que produza um resumo com links das fontes, salva o relatório e o envia por e-mail ou Telegram.

Não implementar mecanismos para contornar paywall, autenticação de terceiros, robots.txt, termos de uso ou bloqueios de sites. Para fontes jornalísticas, preferir RSS ou APIs oficiais/configuradas pelo usuário.

---

## 3. Narrativa e modelo mental oficial

| Elemento do produto | Significado funcional |
| --- | --- |
| Prédio | Workspace principal do usuário/organização |
| Térreo | Visão geral operacional do prédio |
| Andar | Grande área de trabalho com uma missão própria |
| Sala/Setor | Especialidade organizacional e localização visual |
| Agente | Trabalhador de IA com função, instruções, conhecimento e permissões |
| Automação | Definição reutilizável de um trabalho |
| Gatilho | Evento que inicia a automação |
| Etapa | Unidade ordenada de trabalho da automação |
| Execução | Ocorrência concreta e rastreável de uma automação |
| Entregável | Resultado persistido: relatório, texto, JSON, arquivo ou link |
| Canal | Superfície por onde entra uma solicitação ou sai uma entrega |
| Conexão | Conta/credencial externa autorizada para uso |

### 3.1 Regra semântica essencial

Um andar **não representa uma execução individual**. Ele é uma estrutura permanente com missão ampla e pode conter vários setores, agentes, automações, execuções e entregáveis.

Exemplo:

- Prédio: ComunicaçãoAI da empresa.
- Andar: Marketing e Crescimento.
- Missão: aumentar presença digital e gerar oportunidades.
- Salas: Pesquisa, Conteúdo, Social Media e Performance.
- Automação: Calendário semanal de conteúdo.
- Execução: rodada iniciada em 17/08/2026 às 09:00.
- Entregável: `calendario-semana-34.md`.

### 3.2 O setor não é um workflow

Setor/sala continuará representando organização, especialidade e localização visual. Não sobrecarregar `Sector` para fazê-lo representar uma automação.

Os modos atuais `adaptive` e `pipeline` pertencem à orquestração conversacional já existente. Devem permanecer funcionais, mas não se tornam o motor universal das novas automações.

Uma automação pode usar agentes de setores diferentes sem alterar o setor principal ou a posição visual permanente desses agentes.

---

## 4. Estado atual que deve ser preservado

Antes de alterar código, confirmar novamente a `main` remota e registrar o commit-base no relatório final. Não presumir que o commit informado no cabeçalho ainda é o mais recente.

O repositório atual possui uma base valiosa que deve ser reutilizada:

- React 19, Vite, TypeScript e interface responsiva.
- Node/Express, MongoDB e Better Auth.
- Provedores Anthropic e OpenAI com BYOK.
- RAG/documentos dos agentes.
- Memória de conversa e identificação de visitantes.
- Guardrails, estilos de resposta e handoff humano.
- Agentes, setores e modelo inicial de `Office`.
- Widget web incorporável.
- WhatsApp e conversas em tempo real.
- Socket.IO.
- Ferramentas HTTP com proteção SSRF.
- Integrações Google Calendar/Sheets, Slack, Mercado Pago, RD Station, HubSpot, Stripe e Nuvemshop.
- Criptografia AES-256-GCM para segredos já centralizados.
- Escritório visual animado com salas, agentes, pathfinding, colisões, interações e controles.
- Dockerfiles separados, configuração de produção e documentação de deploy.
- Testes unitários do escritório, testes responsivos, lint, builds e E2E existentes.

### 4.1 Acoplamentos atuais que precisam ser tratados

Hoje o domínio está centrado em conversação:

- `generateAgentReply` pressupõe histórico e resposta a visitante.
- Prompts usam os conceitos visitante, atendimento e resposta.
- Ferramentas são oferecidas ao modelo dentro do loop de resposta do chat.
- `Sector` adaptive/pipeline roteia mensagens e etapas conversacionais.
- Dashboard mede conversas, mensagens, leads e handoffs.
- `Agent` mistura configuração geral com muitas opções exclusivas de atendimento.
- Não há scheduler, fila durável, worker, automações, runs, step-runs, artifacts ou deliveries.

O trabalho deverá desacoplar esses pontos sem remover a camada conversacional.

---

## 5. Escopo e não escopo

### 5.1 Incluído neste programa

- Nova narrativa Prédio → Andares → Salas → Agentes.
- Fundação explícita de prédio/workspace.
- Múltiplos andares reais e isolados por usuário.
- Contexto de andar ativo no frontend e backend.
- Motor genérico de execução de agente.
- Definição e versionamento de automações.
- Execução assíncrona e durável.
- Histórico de runs e etapas.
- Agendamento com fuso horário.
- Gatilhos manuais e webhook.
- Fonte RSS e leitura HTTP pública segura.
- Entregáveis persistidos.
- Entrega inicial por e-mail e Telegram.
- Central de conexões/credenciais.
- Dashboard operacional.
- Eventos em tempo real para execução.
- Integração segura do estado operacional ao mapa.
- Compatibilidade integral com atendimento atual.
- Migrações idempotentes, testes, observabilidade e documentação.

### 5.2 Fora do primeiro MVP

- Canvas visual irrestrito semelhante a ferramentas no-code maduras.
- Execução arbitrária de código fornecido pelo usuário.
- Navegador autônomo geral sem limites.
- Automação de desktop local.
- Marketplace público de automações.
- Cobrança por assento, organização ou automação.
- Colaboração multiusuário completa e permissões RBAC avançadas.
- Aplicativo móvel nativo.
- Armazenamento de arquivos grandes sem object storage adequado.
- Contorno de paywalls ou proteções de terceiros.
- Migração destrutiva imediata de `offices/officeId` para `floors/floorId` no MongoDB.

Esses itens podem receber pontos de extensão, mas não devem aumentar desnecessariamente a primeira entrega.

---

## 6. Princípios obrigatórios de implementação

1. **Não fazer big bang.** Implementar em fatias verticais pequenas e verificáveis.
2. **Compatibilidade primeiro.** Chat, widget, WhatsApp e rotas atuais devem continuar funcionando em todas as fases.
3. **Banco preservado.** Nenhuma migração destrutiva sem dry-run, backup documentado e rollback.
4. **Dados por proprietário.** Toda leitura e mutação deve incluir `ownerId` e, quando aplicável, `buildingId` e `floorId`.
5. **Execução fora da requisição HTTP.** Trabalho longo deve entrar em fila e ser executado por worker.
6. **MongoDB é a fonte de verdade.** Redis/BullMQ coordena jobs, não substitui registros de domínio e auditoria.
7. **Runs reproduzíveis.** Cada execução guarda snapshot/versionamento da automação usada.
8. **Idempotência.** Reentregas de webhook, reconciliação do scheduler e retries não podem duplicar trabalho ou entrega.
9. **Segredos centralizados.** Não duplicar novos tokens sensíveis em agentes ou automações.
10. **Logs seguros.** Nunca gravar chaves, Authorization headers ou payloads secretos em logs/runs.
11. **Limites explícitos.** Timeout, tamanho de resposta, número de etapas, ferramentas, tentativas, custo/tokens e concorrência.
12. **Acessibilidade e responsividade.** Toda nova tela deve funcionar de 320px a desktop.
13. **Progressive enhancement visual.** O mapa não pode virar dependência do motor operacional.
14. **Feature flags.** Componentes incompletos não aparecem para todos antes de estarem prontos.
15. **Sem chamadas externas reais em teste.** Usar mocks/fakes e credenciais `.invalid`.

---

## 7. Estratégia de compatibilidade de nomenclatura

O domínio apresentado ao usuário passa imediatamente a usar **Prédio** e **Andar**. Entretanto, o banco atual contém coleção `offices` e referências `officeId` em agentes e setores.

Para reduzir risco:

### Fase de compatibilidade

- Manter temporariamente a coleção `offices`.
- Manter `officeId` nos documentos existentes.
- Evoluir o documento atual de Office para representar funcionalmente um andar.
- Criar uma camada/repository de domínio com nomes `Floor` e `floor` na API nova.
- Aceitar internamente o ID atual sem duplicar documentos.
- Expor APIs novas em `/api/floors`.
- Não expor a palavra “Office” nas novas telas.
- Documentar claramente o alias temporário.

### Migração física futura

Somente após o pivot estar estável:

- criar migração versionada `offices → floors`;
- preservar `_id`;
- fazer dual-read/dual-write durante janela controlada, se necessário;
- backfill `officeId → floorId`;
- validar contagens e referências;
- remover compatibilidade apenas em uma versão posterior.

Essa limpeza física não é critério para liberar o MVP. Evitar churn sem benefício funcional.

---

## 8. Arquitetura de domínio alvo

```text
Building (Prédio)
├── Floors (Andares)
│   ├── Sectors (Salas)
│   │   └── Agents (Agentes)
│   ├── Automations (Automações)
│   │   ├── Automation Versions
│   │   └── Runs
│   │       ├── Step Runs
│   │       ├── Tool Calls
│   │       ├── Artifacts
│   │       └── Deliveries
│   └── Floor Activity
├── Connections (Conexões)
├── Channels (Canais)
└── Policies / Usage / Audit
```

### 8.1 Building

Criar entidade explícita `Building`, mesmo que cada proprietário tenha inicialmente apenas um prédio. Isso evita que o conceito do produto fique implicitamente preso ao usuário de autenticação e prepara colaboração futura sem implementá-la agora.

Campos mínimos:

```ts
interface Building {
  _id: ObjectId
  ownerId: string
  name: string
  description: string
  defaultTimezone: string
  defaultLanguage: 'pt' | 'en' | 'es'
  createdAt: Date
  updatedAt: Date
}
```

Regras:

- Criar `ensureDefaultBuilding(ownerId)` idempotente.
- Um usuário existente recebe “Meu prédio” ou nome derivado seguro.
- Índice único inicial por `ownerId` se o produto limitar um prédio por conta nesta fase.
- Não implementar troca de múltiplos prédios ainda, mas nunca codificar regras que impeçam essa evolução.

### 8.2 Floor

Evoluir o atual `Office` funcionalmente para:

```ts
interface Floor {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId
  name: string
  mission: string
  description: string
  timezone: string
  defaultLanguage: 'pt' | 'en' | 'es'
  color: string | null
  icon: string | null
  order: number
  status: 'active' | 'archived'
  createdAt: Date
  updatedAt: Date
}
```

Regras:

- Todo usuário atual recebe um prédio e seu `Escritório principal` vira o primeiro andar.
- Preservar o `_id` atual para não quebrar agentes e setores.
- Novos agentes e setores sempre recebem o andar ativo explicitamente.
- Listagens devem ser filtráveis por `floorId`.
- Não permitir excluir um andar com dados sem uma decisão explícita: mover conteúdo ou arquivar.
- Preferir arquivamento; deleção definitiva exige confirmação e regras de cascata documentadas.
- A ordenação sustenta o painel de elevador, mas o usuário não precisa ver números rígidos se preferir nomes.

### 8.3 Agent

Preservar os campos existentes. Adicionar configuração geral sem apagar configurações conversacionais:

```ts
interface AgentOperationalFields {
  role: string
  instructions: string
  capabilities: string[]
  operationalStatus: 'available' | 'disabled'
  allowedConnectionIds: ObjectId[]
}
```

Diretrizes:

- `objective` atual pode alimentar inicialmente `instructions`, sem sobrescrita destrutiva.
- Campos como `firstMessage`, `conversationPersistence`, `identityFields`, `handoffEnabled` e estilo de resposta ficam numa seção “Atendimento e conversas”.
- Agente possui um andar e, opcionalmente, um setor principal.
- Participar de uma automação não muda seu setor.
- Não persistir estado transitório “trabalhando” diretamente no agente; derivá-lo de runs ativas.

### 8.4 Sector

Preservar setor como sala organizacional.

- Adicionar descrição/missão apenas se necessário à UX.
- Manter `adaptive` e `pipeline` para conversação.
- Renomear textos visíveis que ainda chamam setores de “times” quando incoerentes.
- Garantir que toda consulta respeite o andar selecionado.
- Manter a regra de setor principal único para a posição visual do agente.
- Não usar membership de setor para controlar quais agentes uma automação pode chamar.

### 8.5 Automation

Criar entidade de definição:

```ts
type AutomationStatus = 'draft' | 'active' | 'paused' | 'archived'
type TriggerType = 'manual' | 'schedule' | 'webhook'

interface Automation {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId
  floorId: ObjectId
  name: string
  description: string
  status: AutomationStatus
  trigger: AutomationTrigger
  currentVersion: number
  lastPublishedVersion: number | null
  createdAt: Date
  updatedAt: Date
}
```

Não armazenar apenas um grande prompt opaco. A definição deve ser estruturada.

### 8.6 AutomationVersion

Cada ativação/publicação cria versão imutável:

```ts
interface AutomationVersion {
  _id: ObjectId
  ownerId: string
  automationId: ObjectId
  version: number
  definition: AutomationDefinition
  definitionHash: string
  createdAt: Date
  createdBy: string
}
```

`AutomationDefinition` contém:

- gatilho normalizado;
- inputs aceitos;
- etapas ordenadas;
- dependências entre etapas;
- políticas de retry/timeout;
- formato do resultado;
- destinos de entrega;
- limites de custo/tokens;
- necessidade de aprovação, quando habilitada futuramente.

O primeiro editor deve suportar sequência linear. O modelo pode prever `dependsOn`, mas não construir um canvas complexo no MVP.

### 8.7 StepDefinition

Tipos iniciais suportados:

```ts
type StepType =
  | 'source.rss'
  | 'source.http'
  | 'agent.execute'
  | 'transform.template'
  | 'delivery.send'
```

Campos comuns:

- `id` estável dentro da versão;
- `name`;
- `type`;
- `enabled`;
- `dependsOn`;
- `inputMapping`;
- `config` validada por tipo;
- `timeoutMs`;
- `retryPolicy`;
- `continueOnError` apenas quando semanticamente seguro.

Não aceitar tipos desconhecidos silenciosamente.

### 8.8 AutomationRun

```ts
type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'canceled'

interface AutomationRun {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId
  floorId: ObjectId
  automationId: ObjectId
  automationVersion: number
  definitionHash: string
  definitionSnapshot: AutomationDefinition
  triggerType: TriggerType
  triggerPayload: unknown
  idempotencyKey: string
  status: RunStatus
  currentStepId: string | null
  queuedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  cancelRequestedAt: Date | null
  usage: { inputTokens: number; outputTokens: number }
  error: SafeRunError | null
}
```

Regras:

- Índice único por `ownerId + idempotencyKey`.
- Snapshot imutável da definição usada.
- Erros armazenados de forma segura, sem stack/segredos para o cliente.
- Stack técnica pode ir para log interno sanitizado.
- Cancelamento cooperativo entre etapas e antes de entregas.

### 8.9 StepRun

Registrar cada tentativa:

```ts
interface StepRun {
  _id: ObjectId
  ownerId: string
  runId: ObjectId
  stepId: string
  stepType: StepType
  attempt: number
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'canceled'
  inputPreview: unknown
  outputPreview: unknown
  artifactIds: ObjectId[]
  startedAt: Date | null
  finishedAt: Date | null
  usage: { inputTokens: number; outputTokens: number }
  error: SafeRunError | null
}
```

Preview deve ser truncado e sanitizado. Dados completos grandes pertencem a artifacts.

### 8.10 Artifact

```ts
interface Artifact {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId
  floorId: ObjectId
  runId: ObjectId
  stepRunId: ObjectId | null
  name: string
  kind: 'markdown' | 'text' | 'json' | 'link' | 'file'
  mimeType: string
  sizeBytes: number
  content?: string
  externalStorageKey?: string
  metadata: Record<string, unknown>
  createdAt: Date
}
```

- Conteúdo pequeno pode ficar no Mongo com limite explícito.
- Arquivos grandes requerem object storage; até existir, rejeitar acima do limite em vez de estourar documentos Mongo.
- Usar nomes seguros e Content-Disposition apropriado.

### 8.11 Connection

Centralizar novas credenciais:

```ts
interface Connection {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId
  provider: string
  name: string
  status: 'connected' | 'error' | 'revoked'
  encryptedConfig: string
  publicMetadata: Record<string, string>
  scopes: string[]
  createdAt: Date
  updatedAt: Date
}
```

- Criptografar sempre com o mecanismo existente.
- A API nunca devolve `encryptedConfig` nem segredos descriptografados.
- Agentes/automações referenciam `connectionId`.
- Planejar migração das integrações existentes e credenciais por agente, mas manter compatibilidade durante o MVP.

### 8.12 Delivery

Registrar envios separadamente do artifact:

```ts
interface Delivery {
  _id: ObjectId
  ownerId: string
  runId: ObjectId
  artifactId: ObjectId
  provider: 'email' | 'telegram' | 'slack' | 'whatsapp' | 'webhook'
  connectionId: ObjectId
  destinationMasked: string
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'canceled'
  attempt: number
  providerMessageId: string | null
  idempotencyKey: string
  error: SafeRunError | null
  createdAt: Date
  sentAt: Date | null
}
```

O MVP implementa e-mail e Telegram. Slack/WhatsApp/webhook podem reutilizar adaptadores depois, sem fingir que estão prontos.

---

## 9. Motor genérico de agentes

### 9.1 Problema atual

`generateAgentReply` está acoplado ao formato de conversa. Não duplicar loops Anthropic/OpenAI para automação.

### 9.2 Arquitetura alvo

Extrair um núcleo comum, por exemplo:

```ts
interface AgentExecutionRequest {
  objective: string
  instructions: string
  input: unknown
  context: string[]
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  tools: ResolvedTool[]
  output?: {
    format: 'text' | 'markdown' | 'json'
    jsonSchema?: Record<string, unknown>
  }
  limits: {
    maxToolIterations: number
    timeoutMs: number
    maxOutputChars: number
  }
}
```

Camadas sugeridas:

```text
provider loop (Anthropic/OpenAI)
└── executeAgentTask (genérico)
    ├── conversation adapter → generateAgentReply atual
    └── automation step adapter → agent.execute
```

Requisitos:

- Manter assinatura pública ou wrapper compatível de `generateAgentReply`.
- Manter prompt caching quando suportado.
- Manter tool-call cap e token accounting.
- Suportar retorno estruturado validado quando solicitado.
- Não incluir automaticamente instruções de visitante/atendimento no caminho genérico.
- RAG recebe uma consulta derivada do input da etapa, não exige mensagem de visitante.
- As ferramentas existentes resolvidas por agente devem poder ser usadas por automações, respeitando permissões de conexão.
- Separar erros de provedor, ferramenta, timeout, validação e limite.
- Testar equivalência comportamental da conversa atual após a extração.

---

## 10. Execução durável, fila e worker

### 10.1 Processos

O backend deverá suportar dois processos a partir da mesma base de código/imagem:

- **API:** autenticação, CRUD, consultas, webhooks e criação de runs.
- **Worker:** consumo de fila, execução das etapas, retries, artifacts e deliveries.

Adicionar scripts explícitos, por exemplo:

- `start:api`
- `start:worker`
- `dev:api`
- `dev:worker`

Preservar `start` como alias compatível da API se o deploy atual depender dele.

### 10.2 Redis/BullMQ

Usar Redis e BullMQ para:

- fila de runs;
- retry com backoff;
- concorrência controlada;
- agendamentos recorrentes;
- recuperação após reinício;
- deduplicação operacional.

MongoDB continua contendo o estado canônico de domínio.

### 10.3 Scheduler

- A definição de schedule vive no Mongo.
- Um reconciliador registra/remove schedulers do BullMQ.
- Reconciliar no startup e após ativar, editar, pausar ou arquivar automação.
- Usar identificador estável por automação e versão.
- Guardar timezone IANA.
- Tratar horário de verão explicitamente.
- Nunca calcular recorrência apenas pelo relógio do navegador.
- Uma falha de reconciliação deve aparecer como estado de erro da automação.

### 10.4 Idempotência e retries

- Manual: chave gerada no servidor ou header idempotente aceito.
- Schedule: chave derivada de `automationId + scheduledTimestamp`.
- Webhook: chave de evento do provedor quando existir; fallback por hash controlado.
- Delivery: chave de `runId + artifactId + destination`.
- Retry de etapa não pode criar artifact ou envio duplicado.
- Retentar apenas erros classificados como transitórios.
- Erros de validação/configuração falham imediatamente.

### 10.5 Concorrência e limites

Configurar via env com defaults seguros:

- concorrência global do worker;
- concorrência por proprietário;
- timeout de step;
- máximo de etapas;
- máximo de tentativas;
- limite de bytes de fonte;
- limite de artifact inline;
- limite de tool calls;
- limite de tokens/run quando suportado.

Não permitir que uma automação monopolize o worker.

### 10.6 Saúde operacional

- Manter `/api/health` e `/api/ready`.
- Criar heartbeat do worker no Redis/Mongo ou healthcheck próprio sem expor segredos.
- Dashboard deve distinguir “API saudável” de “worker indisponível”.
- Graceful shutdown: parar de buscar novos jobs, finalizar/cancelar com segurança e fechar conexões.

---

## 11. Gatilhos e etapas do MVP

### 11.1 Manual

- Botão “Executar agora”.
- Modal de inputs se a automação declarar parâmetros.
- Retorno imediato com `runId` e status `queued`.
- Interface acompanha por Socket.IO e polling de segurança.

### 11.2 Schedule

Suportar interface amigável para:

- diário;
- dias da semana;
- semanal;
- mensal simples;
- expressão avançada somente se validada.

Sempre mostrar próxima execução e timezone antes de ativar.

### 11.3 Webhook

- URL difícil de adivinhar.
- Secret de assinatura por automação, armazenado criptografado.
- Verificação HMAC quando configurada.
- Limite de payload e Content-Type.
- Rate limiting.
- Rotação/revogação do segredo.
- Nunca expor secret completo depois da criação.

### 11.4 `source.rss`

- URL pública http/https.
- Reutilizar/fortalecer proteção SSRF.
- Timeout, limite de bytes e redirects limitados.
- Parse defensivo.
- Filtro de janela de tempo.
- Normalização e deduplicação por GUID/URL/hash.
- Resultado estruturado com título, URL, data, autor e trecho.

### 11.5 `source.http`

- GET público no MVP.
- Headers secretos somente via Connection; headers não sensíveis podem estar na etapa.
- Bloquear IPs privados, localhost, metadata services e DNS rebinding.
- Revalidar cada redirect.
- Limitar tipos e tamanho de conteúdo.
- HTML deve ser reduzido a texto útil de forma segura.
- Guardar URLs de origem para citações no entregável.

### 11.6 `agent.execute`

- Escolher agente do mesmo prédio; cross-floor permitido somente quando explicitamente selecionado e visível.
- Configurar instrução da etapa.
- Mapear outputs anteriores como input.
- Escolher formato text/markdown/JSON.
- RAG opcional do agente.
- Ferramentas/conexões permitidas explicitamente.
- Gerar artifact quando marcado como entrega principal.

### 11.7 `transform.template`

- Composição determinística simples.
- Variáveis conhecidas das etapas anteriores.
- Sem execução de JavaScript arbitrário.
- Falhar com mensagem clara em variável inexistente.

### 11.8 `delivery.send`

- Selecionar artifact/saída.
- Selecionar conexão e destino.
- Registrar Delivery antes de enviar.
- Envio idempotente.
- Não marcar run como sucesso se uma entrega obrigatória falhou definitivamente.
- Permitir entrega opcional sem apagar sucesso do conteúdo, mas mostrar warning.

---

## 12. E-mail e Telegram

### 12.1 E-mail

Criar adapter desacoplado. Escolher um provedor compatível com o deploy atual ou SMTP configurável, sem acoplar domínio ao primeiro fornecedor.

Configuração:

- connection com host/provider, usuário/remetente e segredo criptografado;
- destinatários validados;
- subject e body por template;
- texto e HTML sanitizado;
- anexos apenas dentro dos limites;
- provider message ID quando disponível.

### 12.2 Telegram

- Connection guarda bot token criptografado.
- Destino guarda `chatId` de forma segura e exibe versão mascarada quando apropriado.
- Incluir ação de teste de conexão.
- Respeitar limites de tamanho; dividir mensagens ou enviar documento de forma determinística.
- Não expor token em URL, log, erro ou run.

---

## 13. APIs propostas

Seguir padrões REST consistentes e validação centralizada.

### Prédio e andares

- `GET /api/building`
- `PATCH /api/building`
- `GET /api/floors`
- `POST /api/floors`
- `GET /api/floors/:floorId`
- `PATCH /api/floors/:floorId`
- `POST /api/floors/:floorId/archive`
- `POST /api/floors/:floorId/restore`
- `GET /api/floors/:floorId/activity`

### Automações

- `GET /api/automations?floorId=&status=`
- `POST /api/automations`
- `GET /api/automations/:automationId`
- `PATCH /api/automations/:automationId`
- `POST /api/automations/:automationId/validate`
- `POST /api/automations/:automationId/test`
- `POST /api/automations/:automationId/publish`
- `POST /api/automations/:automationId/activate`
- `POST /api/automations/:automationId/pause`
- `POST /api/automations/:automationId/archive`
- `GET /api/automations/:automationId/versions`

### Runs

- `POST /api/automations/:automationId/runs`
- `GET /api/runs?floorId=&automationId=&status=`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/steps`
- `POST /api/runs/:runId/cancel`
- `POST /api/runs/:runId/retry`

### Artifacts e deliveries

- `GET /api/artifacts?floorId=&runId=`
- `GET /api/artifacts/:artifactId`
- `GET /api/artifacts/:artifactId/download`
- `GET /api/runs/:runId/deliveries`
- `POST /api/deliveries/:deliveryId/retry`

### Connections

- `GET /api/connections`
- `POST /api/connections`
- `GET /api/connections/catalog`
- `POST /api/connections/:connectionId/test`
- `PATCH /api/connections/:connectionId`
- `DELETE /api/connections/:connectionId`

### Webhooks

- `POST /api/hooks/automations/:publicKey`

Regras gerais:

- Validar ObjectId antes de consultar.
- Confirmar ownership e escopo de prédio/andar em todas as relações.
- Não confiar em `floorId`, `agentId` ou `connectionId` enviados pelo cliente.
- Paginar listas de runs/artifacts.
- Padronizar erros com `code`, `message` segura e `requestId`.
- Não retornar snapshots ou payloads enormes nas listagens.

---

## 14. UX e navegação

### 14.1 Navegação alvo

- Prédio
- Automações
- Agentes
- Setores
- Execuções
- Entregáveis
- Canais
- Conversas
- Integrações
- Configurações

No mobile, manter poucos itens primários no bottom navigation e mover o restante para drawer/menu, sem duplicar fonte de verdade da navegação.

### 14.2 Térreo / visão do prédio

Transformar `/dashboard` na visão geral do prédio:

- nome e resumo do prédio;
- seletor/elevador de andares;
- cards de cada andar;
- agentes ativos;
- automações ativas;
- runs em andamento;
- falhas que exigem atenção;
- próximas execuções;
- últimos entregáveis;
- métricas de uso.

As métricas conversacionais permanecem em um bloco secundário ou na área Conversas.

### 14.3 Andar

Nova rota recomendada: `/floors/:floorId`.

Conteúdo:

- nome, missão e status do andar;
- mapa visual existente filtrado por andar;
- resumo das automações do andar;
- atividade recente;
- próximos agendamentos;
- erros/avisos;
- ações “Criar automação”, “Contratar agente” e “Criar setor”.

Preservar `/dashboard` e links existentes. Não quebrar deep links.

### 14.4 Elevador

Criar um seletor acessível, não apenas decorativo:

- exibir nome dos andares;
- indicar andar ativo;
- permitir teclado e leitor de tela;
- funcionar como select/drawer no mobile;
- mostrar status discreto: normal, trabalho ativo, atenção;
- não depender de animação para navegação.

### 14.5 Contexto do andar

- Persistir último `floorId` válido por usuário no frontend ou preferência de conta.
- Toda tela de agentes/setores/automações deve mostrar claramente o escopo atual.
- Permitir “Todos os andares” somente em telas agregadas.
- Ao criar agente/setor/automação, pré-selecionar o andar atual, mas exigir valor explícito no payload.
- Se o andar salvo foi arquivado ou não pertence ao usuário, escolher fallback seguro.

### 14.6 Wizard de automação

Fluxo recomendado:

1. **Objetivo:** “O que deve acontecer?”
2. **Gatilho:** manual, agendamento ou webhook.
3. **Fontes:** RSS, URL ou input manual.
4. **Equipe:** agentes e funções de cada etapa.
5. **Etapas:** ordem, instruções e mapeamentos.
6. **Resultado:** texto, Markdown ou JSON.
7. **Entrega:** salvar, e-mail, Telegram.
8. **Limites:** timeout, retries e orçamento.
9. **Revisão:** resumo em linguagem clara.
10. **Teste:** run de teste e inspeção.
11. **Ativação:** publicar versão imutável.

Salvar rascunho entre passos. Erros devem apontar para o passo/campo correto.

Não implementar geração por linguagem natural antes do editor estruturado estar confiável. Depois, a IA pode preencher o mesmo schema, mas nunca criar configuração invisível.

### 14.7 Execuções

Listagem com:

- automação;
- andar;
- origem/gatilho;
- status;
- início e duração;
- etapa atual;
- consumo;
- ações permitidas.

Detalhe com timeline de etapas, tool calls sanitizadas, artifacts, deliveries e erro acionável.

### 14.8 Entregáveis

- busca e filtros por andar, automação, tipo e período;
- preview seguro para Markdown/texto/JSON;
- download quando aplicável;
- vínculo para run de origem;
- reenvio por destino existente com confirmação.

---

## 15. Escritório visual conectado ao trabalho real

O mapa atual é uma vantagem estratégica. Integrá-lo gradualmente, sem misturar simulação visual com execução de backend.

### 15.1 Fonte de verdade

- Estado do run vem do backend.
- Frontend agrega o estado operacional por agente.
- Simulação continua responsável apenas por posição, caminhada e interações visuais.
- Se eventos em tempo real falharem, polling reconcilia.

### 15.2 Estados visuais iniciais

| Estado operacional | Representação sugerida |
| --- | --- |
| Sem run ativa | comportamento ocioso atual |
| Run enfileirada | badge discreto/aguardando |
| Executando etapa de IA | trabalhando à mesa/pose de ligação existente |
| Usando integração | pose de ligação, badge da ferramenta ou ponto de interação |
| Aguardando aprovação | parado em local apropriado com indicador |
| Falha | indicador de atenção; nunca animação agressiva |
| Concluído recentemente | retorno natural ao comportamento ocioso |

Não teleportar agentes nem interromper pathfinding. Alterações de estado devem ser aplicadas em transições seguras da máquina visual.

### 15.3 Socket.IO

Eventos sugeridos:

- `run:queued`
- `run:started`
- `run:step_started`
- `run:step_finished`
- `run:finished`
- `run:failed`
- `delivery:updated`

Autorizar salas por owner/building. Nunca permitir que um cliente assine eventos de outro usuário.

### 15.4 Feature flag visual

Adicionar flag independente para estados reais no mapa. Se houver regressão, desativar overlay operacional sem desativar automações.

---

## 16. Dashboard e métricas

Novas métricas principais:

- automações ativas;
- runs hoje/semana/mês;
- taxa de sucesso;
- runs em andamento;
- falhas abertas;
- próximas execuções;
- entregáveis recentes;
- duração média;
- tokens/custo por automação e andar;
- deliveries enviados/falhos.

Métricas atuais de conversa continuam disponíveis:

- conversas;
- mensagens;
- leads;
- handoffs;
- taxa de atendimento.

Não somar runs e conversas como se fossem a mesma unidade.

---

## 17. Segurança e privacidade

### 17.1 Segredos

- Reutilizar AES-256-GCM existente.
- Não mudar `ENCRYPTION_KEY` durante a migração.
- Mascarar valores no frontend.
- Nunca devolver segredos em GET.
- Rotação deve substituir valor sem revelar o anterior.
- Redigir Authorization, cookies, tokens, bot token, SMTP password e query secrets.

### 17.2 SSRF e conteúdo externo

Expandir a proteção HTTP atual:

- validar protocolo;
- bloquear ranges privados IPv4/IPv6;
- bloquear localhost, `.local`, `.internal` e metadata services;
- resolver DNS e revalidar redirects;
- limitar redirects;
- timeout;
- limite de bytes;
- Content-Type allowlist;
- não aceitar `file:`, `ftp:`, `data:` ou esquemas arbitrários.

Criar testes contra DNS rebinding/redirect para rede privada na medida possível.

### 17.3 Autorização

- Todas as entidades carregam `ownerId`.
- Validar cadeia Building → Floor → Automation → Run/Artifact.
- Um ID válido de outro usuário deve responder como não encontrado/negado sem vazar existência.
- Webhooks públicos usam public key e assinatura, nunca sessão do usuário.

### 17.4 Prompt injection e conteúdo não confiável

- Marcar conteúdo de fontes como dado não confiável no prompt.
- Instruir o modelo a não seguir comandos encontrados em páginas/RSS.
- Ferramentas são permitidas pela definição e pelo agente, não pelo texto coletado.
- Delivery não aceita destinatário arbitrário extraído de fonte externa sem configuração/aprovação.

### 17.5 Auditoria

Registrar:

- criação/edição/publicação/ativação de automação;
- criação/revogação de conexão;
- início/cancelamento/retry de run;
- delivery e retry;
- alterações de andar.

Não incluir segredo ou conteúdo integral desnecessário na auditoria.

---

## 18. Migração de dados

Criar scripts versionados e idempotentes, separados do boot normal quando houver risco.

### 18.1 Inventário/dry-run

Antes de escrever:

- contar owners;
- listar owners sem office;
- contar offices por owner;
- validar agentes/setores sem `officeId`;
- identificar referências órfãs;
- identificar duplicidades;
- produzir relatório sem dados sensíveis.

### 18.2 Backfill inicial

Para cada owner:

1. garantir Building padrão;
2. garantir ao menos um Floor/Office existente;
3. adicionar `buildingId` ao Office atual;
4. preencher missão/descrição/timezone/defaultLanguage com defaults seguros;
5. preservar `_id`;
6. preencher `updatedAt`;
7. ligar agentes e setores legacy ao andar padrão somente se realmente ausentes;
8. nunca mover conteúdo já corretamente associado.

### 18.3 Validação pós-migração

- número de owners com building;
- todos floors com building válido;
- todos agentes/setores com andar válido;
- nenhum cross-owner reference;
- contagens antes/depois;
- reexecução produz zero mudanças;
- rollback documentado.

### 18.4 Índices

Criar índices necessários de forma controlada:

- buildings por owner;
- floors/offices por owner + building + status + order;
- agents/sectors por owner + officeId;
- automations por owner + floorId + status;
- versions único por automationId + version;
- runs por owner + floorId + createdAt;
- runs único por owner + idempotencyKey;
- stepRuns por runId + stepId + attempt;
- artifacts por owner + floorId + createdAt;
- deliveries por runId e idempotencyKey;
- connections por owner + building + provider.

Testar impacto em base de desenvolvimento antes de produção.

---

## 19. Feature flags e rollout

Flags sugeridas:

- `AI_BUILDING_ENABLED`
- `AI_FLOORS_ENABLED`
- `AI_AUTOMATIONS_ENABLED`
- `AI_SCHEDULER_ENABLED`
- `AI_DELIVERIES_ENABLED`
- `AI_OFFICE_LIVE_STATUS_ENABLED`

No frontend, usar flags públicas correspondentes apenas para apresentação; autorização e capacidade real continuam validadas no backend.

Rollout:

1. modelos e backfill invisíveis;
2. andares e seletor;
3. automações draft/manual para conta de teste;
4. worker e runs;
5. schedule;
6. deliveries;
7. dashboard operacional;
8. status real no mapa;
9. habilitação geral.

Cada flag deve ter caminho de remoção documentado após estabilização.

---

## 20. Fases de implementação

### Fase 0 — Baseline e proteção

- Atualizar `main` e criar branch dedicada.
- Registrar commit-base e worktree status.
- Ler README, planos, relatórios, env matrix e split guide.
- Instalar pelos lockfiles corretos.
- Executar build, lint e testes na ordem documentada.
- Não atribuir falha de dependência ausente ao código.
- Registrar baseline e problemas preexistentes.
- Criar feature flags desligadas.
- Definir estratégia de backup/migração.

**Gate:** nenhum código funcional do pivot antes de baseline confiável.

### Fase 1 — Building e Floors

- Criar `Building` e repository/service.
- Evoluir Office como Floor compatível.
- Criar migration dry-run/backfill.
- Criar APIs building/floors.
- Filtrar agentes e setores por andar.
- Criar contexto de andar ativo.
- Implementar Térreo e elevador.
- Criar rota de andar com o mapa atual.
- Preservar `/dashboard` e rotas existentes.
- Atualizar textos e empty states.
- Testar multiandar e isolamento.

**Gate:** dois andares com agentes/setores distintos funcionam sem vazamento ou regressão do mapa.

### Fase 2 — Runtime genérico

- Extrair provider loop comum.
- Criar `executeAgentTask`.
- Manter `generateAgentReply` como adapter.
- Criar output estruturado validado.
- Reutilizar RAG e tools.
- Adicionar timeouts/limites/erros tipados.
- Testar conversa atual e nova execução genérica com providers mockados.

**Gate:** toda suíte conversacional permanece verde e uma task não conversacional roda sem palavras/instruções de atendimento.

### Fase 3 — Domínio de automações

- Criar Automation, Version, Run, StepRun e Artifact.
- Criar schemas/validators por tipo de step.
- Criar CRUD de rascunho.
- Criar validate/publish/version.
- Criar listagens paginadas.
- Construir wizard até revisão, ainda protegido por flag.
- Criar preview do plano em linguagem clara.

**Gate:** versão publicada é imutável e alterações posteriores criam nova versão.

### Fase 4 — Fila e execução manual

- Adicionar Redis/BullMQ.
- Separar API e worker.
- Criar enqueue idempotente.
- Implementar runner linear e step adapters iniciais.
- Persistir estados e tentativas.
- Implementar cancel/retry.
- Emitir Socket.IO seguro.
- Criar telas Runs e Run Detail.
- Criar manual run/test run.

**Gate:** reiniciar worker não perde run; retry não duplica artifact; API não espera a execução terminar.

### Fase 5 — Sources e primeiro caso completo

- Implementar RSS seguro.
- Implementar HTTP GET seguro.
- Implementar transform/template.
- Implementar agent.execute com RAG e tools.
- Implementar artifacts Markdown/JSON/texto.
- Criar template “Resumo periódico de notícias”.
- Validar links/citações.

**Gate:** exemplo de resumo roda manualmente ponta a ponta e produz artifact rastreável.

### Fase 6 — Scheduler

- Implementar schedule schema e UX amigável.
- Implementar reconciliador BullMQ.
- Calcular próxima execução.
- Tratar timezone/DST.
- Ativar/pausar/republicar sem jobs duplicados.
- Criar estado de saúde do scheduler.

**Gate:** testes de recorrência, DST, pausa, edição e reconciliação passam.

### Fase 7 — Connections e deliveries

- Criar central de Connections.
- Criar adapters e-mail e Telegram.
- Criar teste de conexão.
- Criar delivery.send e registro Delivery.
- Implementar idempotência e retry.
- Criar UI de integração e status.
- Não remover integrações legacy ainda.

**Gate:** artifact é enviado uma única vez por destino e falhas são retentáveis/visíveis.

### Fase 8 — Dashboard operacional e mapa vivo

- Adicionar métricas de automação.
- Implementar próximas execuções, falhas e entregáveis.
- Manter métricas de conversa separadas.
- Criar endpoint de activity/status por andar.
- Integrar estados reais ao mapa atrás de flag.
- Preservar movimento, colisão, pausa e recall atuais.
- Testar reconnect/poll fallback.

**Gate:** desativar overlay real não quebra automações; mapa nunca é fonte de verdade.

### Fase 9 — Reenquadramento de canais e atendimento

- Apresentar Widget e WhatsApp como canais de entrada conversacional.
- Manter rotas públicas e embeds.
- Organizar configurações exclusivas de conversa em seção própria do agente.
- Preparar adapter “mensagem recebida” como gatilho futuro, sem reescrever o atendimento estável nesta fase.
- Atualizar README e onboarding para o novo posicionamento.

**Gate:** widget, WhatsApp, Chats, playgrounds e handoff continuam funcionando como antes.

### Fase 10 — Hardening e release

- Rodar migração em base de teste cópia/sanitizada.
- Executar suites completas.
- Testar containers API/worker/frontend/Redis.
- Validar graceful shutdown e recuperação.
- Fazer auditoria de segredos e ownership.
- Testar 320px, mobile, tablet e desktop.
- Produzir relatório final e runbook.
- Remover flags somente das funcionalidades estáveis.

**Gate:** todos os critérios globais de aceite atendidos.

---

## 21. Testes obrigatórios

### 21.1 Unitários

- validação dos modelos e schemas;
- normalização de timezone/schedule;
- hash e imutabilidade de version;
- idempotency keys;
- classificação de erros/retries;
- mapeamento de input/output entre steps;
- sanitização de logs/previews;
- parse/deduplicação de RSS;
- SSRF e redirects;
- templates;
- adapters de delivery com mocks;
- motor genérico Anthropic/OpenAI com mocks;
- compatibilidade do adapter conversacional;
- agregação de status por agente.

### 21.2 Integração de backend

- CRUD com ownership;
- tentativa cross-owner;
- building/floor backfill;
- publish/version;
- enqueue e processamento;
- retry e cancelamento;
- restart/recovery;
- schedule reconciliation;
- webhook assinado e replay;
- artifact size limit;
- delivery idempotente;
- secret redaction;
- Socket.IO authorization.

### 21.3 Frontend

- floor context e fallback;
- elevador acessível;
- wizard com rascunho;
- validações por etapa;
- run timeline;
- artifacts preview;
- estados loading/empty/error/partial;
- navegação e mobile drawer;
- mapa filtrado por andar;
- overlay operacional on/off.

### 21.4 E2E

Fluxos mínimos:

1. usuário legacy entra e vê seu primeiro andar;
2. cria segundo andar;
3. cria/move ou associa agente e setor corretamente;
4. cria automação manual de resumo;
5. testa e publica;
6. executa e acompanha até artifact;
7. agenda e pausa;
8. configura delivery mock/test;
9. widget existente continua respondendo;
10. WhatsApp manager e Conversas carregam;
11. navegação funciona em 320px e desktop;
12. usuário não acessa recurso de outro owner.

### 21.5 Regressão obrigatória

- todos os testes existentes do escritório;
- 53 testes de frontend registrados nos relatórios atuais ou total maior;
- lint frontend;
- typecheck/build frontend;
- build backend;
- testes backend após build quando a suíte consome `dist`;
- E2E responsivo existente;
- build isolado frontend/backend pelos lockfiles próprios;
- compose de produção/teste, quando Docker estiver disponível.

Nunca reduzir assertions, excluir testes ou marcar skip para obter verde sem justificar e corrigir a causa.

---

## 22. Critérios globais de aceite

- [ ] Produto apresenta Prédio, Térreo, Andares, Salas, Agentes, Automações, Execuções e Entregáveis de forma consistente.
- [ ] Usuário legacy recebe prédio/andar sem perda de dados.
- [ ] Múltiplos andares são reais e isolam agentes, setores, automações e mapa.
- [ ] Não há troca destrutiva imediata de `officeId`.
- [ ] Runtime genérico não carrega linguagem de atendimento em tarefas autônomas.
- [ ] Chat/widget/WhatsApp continuam funcionais.
- [ ] Automação possui rascunho, validação, publicação e versão imutável.
- [ ] Run ocorre no worker, não bloqueia HTTP e sobrevive a reinício.
- [ ] Manual, schedule e webhook funcionam com idempotência.
- [ ] RSS/HTTP respeitam SSRF, redirects, limites e conteúdo não confiável.
- [ ] Artifacts são rastreáveis à run/step.
- [ ] E-mail e Telegram usam Connections criptografadas.
- [ ] Retry não duplica artifact nem delivery.
- [ ] Dashboard separa métricas operacionais e conversacionais.
- [ ] Mapa reflete estado real sem comandar o backend.
- [ ] Todas as consultas aplicam ownership.
- [ ] Nenhum segredo aparece em resposta, log, bundle ou relatório.
- [ ] Migrações são idempotentes, auditáveis e possuem dry-run.
- [ ] Interface funciona em 320px, mobile, tablet e desktop.
- [ ] Builds, lint, unit, integração e E2E passam.
- [ ] Docker/deploy docs contemplam API, worker e Redis.
- [ ] README descreve corretamente o novo produto.

---

## 23. Estratégia de commits

Fazer commits pequenos e semânticos. Sugestão:

1. `chore(pivot): capture baseline and add feature flags`
2. `feat(building): add building and floor compatibility domain`
3. `feat(floors): add migrations and scoped APIs`
4. `feat(floors): add building overview and elevator navigation`
5. `refactor(llm): extract generic agent execution runtime`
6. `feat(automations): add definitions versions and validation`
7. `feat(automations): add creation wizard and draft flow`
8. `feat(runs): add durable queue and worker process`
9. `feat(runs): add execution history cancel and retry`
10. `feat(sources): add safe rss and http steps`
11. `feat(artifacts): persist and preview run deliverables`
12. `feat(scheduler): add timezone-aware recurring runs`
13. `feat(connections): centralize encrypted integrations`
14. `feat(delivery): add email and telegram adapters`
15. `feat(dashboard): add operational building metrics`
16. `feat(office): reflect live agent execution states`
17. `refactor(channels): reposition conversation surfaces`
18. `test(pivot): add integration responsive and e2e coverage`
19. `docs(pivot): document architecture migrations and operations`

Não misturar migração, grande redesign e runtime numa única alteração.

---

## 24. Rollback e recuperação

Cada fase deve permitir rollback independente.

- Flags desligam novas telas/capacidades.
- Campos novos são aditivos.
- Coleção `offices` e `officeId` permanecem na primeira versão.
- Chat continua usando adapter compatível.
- Desativar worker impede novas automações sem derrubar API/chat.
- Pausar scheduler remove recorrências sem apagar definições.
- Connections novas não substituem credenciais legacy até migração validada.
- Overlay do mapa pode ser desligado separadamente.

Documentar comandos/ações para:

- pausar todos os schedules;
- drenar/parar worker;
- reprocessar run segura;
- reconciliar fila com Mongo;
- restaurar backup;
- reverter migration compatível;
- localizar jobs órfãos sem apagá-los automaticamente.

Não usar `git reset --hard`, apagar coleções ou recriar banco como estratégia de rollback.

---

## 25. Variáveis de ambiente e deploy

Atualizar matrix sem inserir valores reais:

Backend API/worker:

- Mongo existente.
- Auth e encryption existentes.
- `REDIS_URL`.
- flags do pivot.
- concorrência/timeout/limites.
- configuração pública necessária para webhook.
- provider de e-mail, se env-global for adotado; preferir Connection quando por usuário.

Frontend:

- URL pública da API existente.
- flags públicas de UX quando necessárias.

Docker/Coolify:

- frontend continua independente;
- backend API usa imagem backend e comando API;
- backend worker usa a mesma imagem e comando worker;
- Redis é recurso separado e privado;
- worker não precisa de domínio público;
- healthchecks distintos;
- secrets apenas em runtime;
- nenhuma credencial entra em build arg do frontend.

Não executar deploy real neste plano sem autorização explícita. Preparar e validar configuração, mas não modificar produção automaticamente.

---

## 26. Documentação obrigatória

Criar/atualizar:

- README com novo posicionamento e quick start.
- `docs/architecture/building-domain.md`.
- `docs/architecture/automation-runtime.md`.
- `docs/architecture/security-and-connections.md`.
- `docs/operations/worker-and-scheduler.md`.
- `docs/operations/migrations.md`.
- `docs/operations/rollback.md`.
- `.env.example` de cada serviço, sem secrets reais.
- matrix de deploy atualizada.
- relatório final `AI_BUILDING_PIVOT_IMPLEMENTATION_REPORT.md`.

O relatório final deve conter:

- commit-base e commit final;
- arquivos/áreas alteradas;
- decisões e desvios do plano;
- migrations executadas/testadas;
- testes e resultados exatos;
- limitações conhecidas;
- flags e estado de cada uma;
- passos de deploy ainda pendentes;
- riscos/itens futuros;
- checklist global atualizado.

---

## 27. Regras de execução para o Claude Code

1. Ler este arquivo inteiro antes de editar.
2. Confirmar a `main` remota e trabalhar em branch própria.
3. Inspecionar alterações do usuário e nunca sobrescrevê-las silenciosamente.
4. Implementar as fases na ordem e respeitar cada gate.
5. Atualizar neste arquivo o checklist das fases concluídas ou manter relatório equivalente rastreável.
6. Rodar testes relevantes após cada fase, não apenas no fim.
7. Corrigir regressões antes de avançar.
8. Se um teste falhar por ambiente, comprovar e documentar; não declarar sucesso sem execução.
9. Usar mocks para serviços externos.
10. Não usar credenciais reais em teste ou commit.
11. Não fazer deploy, alterar DNS ou tocar produção sem autorização explícita.
12. Não remover funcionalidade existente para simplificar o pivot.
13. Não substituir UX existente por placeholders.
14. Não criar um único arquivo monolítico de backend; separar domain, repository, service, routes, runtime e adapters.
15. Não continuar após uma migração inconsistente; parar, preservar evidências e corrigir.
16. Decisões pequenas podem ser tomadas autonomamente de acordo com este plano. Pedir intervenção somente quando faltar segredo, acesso externo, decisão irreversível ou requisito realmente ambíguo.
17. Ao terminar, entregar relatório completo, status do git e comandos de verificação.

---

## 28. Definição de pronto

O pivot não está pronto apenas porque os nomes da interface mudaram.

Ele estará pronto quando:

- o prédio e os andares existirem como escopos reais;
- o andar organizar salas, agentes e automações;
- tarefas não conversacionais puderem ser executadas pelo runtime genérico;
- automações possuírem versão, fila, histórico e entregáveis;
- agendamento continuar após reinícios;
- e-mail/Telegram puderem receber resultado;
- o usuário conseguir entender o que está rodando e por quê;
- o mapa puder refletir a operação sem controlá-la;
- atendimento existente continuar intacto;
- migração, segurança, observabilidade, responsividade e testes estiverem comprovados.

O resultado deve parecer uma evolução natural e ambiciosa da ComunicaçãoAI, não um segundo produto colado ao chatbot atual.

---

## 29. Próximas extensões após o MVP

Não implementar agora, mas preservar compatibilidade arquitetural para:

- criação de automação por linguagem natural usando o schema estruturado;
- aprovações humanas;
- gatilho por e-mail recebido;
- gatilho por mensagem de canal;
- Slack e WhatsApp outbound;
- branches/condições no workflow;
- colaboração entre andares;
- múltiplos prédios;
- memberships e RBAC;
- object storage;
- templates/marketplace;
- orçamento financeiro por andar;
- browser controlado com allowlists;
- API pública de execução;
- dashboards comparativos por período;
- cobrança baseada em runs/tokens.

Essas extensões não devem alterar a distinção fundamental entre Agente, Automação, Gatilho, Execução, Entregável, Canal e Conexão.

