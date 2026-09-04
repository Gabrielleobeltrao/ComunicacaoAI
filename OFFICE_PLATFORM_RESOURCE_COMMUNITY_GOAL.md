# /goal — Office Platform: Resources, Databases, Monitors e Community Marketplace

## Contrato de execução

Implementar este objetivo no repositório `Gabrielleobeltrao/ComunicacaoAI`, trabalhando **somente na branch `development`** e tomando como base o código real atual.

Base auditada para este documento:

- branch: `development`
- commit: `d0d2adeef66aa95228d9f00fa2c973b216fd0c92`
- data: `2026-09-01 23:01:39 -0400`
- frontend: React 19 + TypeScript + Vite
- backend: Express 5 + TypeScript + MongoDB
- estado da `main`: não alterar, não fazer merge

Antes de começar, buscar o estado remoto de `development`. Se ela tiver avançado, registrar as diferenças em `OFFICE_PLATFORM_RESOURCE_COMMUNITY_PROGRESS.md`, revalidar os pontos de integração descritos aqui e adaptar nomes de arquivos sem recriar módulos que já tenham sido implementados.

Este é um objetivo grande e multi-fase. Executar em commits pequenos e funcionais, deixando build e testes verdes ao final de cada fase. Se a sessão acabar antes do todo, não entregar stubs como concluídos: atualizar o arquivo de progresso com o último commit verde, o que foi implementado, testes executados, riscos e a próxima ação exata.

Não criar um produto paralelo. Evoluir e conectar os módulos atuais.

---

## 1. Resultado de produto

Transformar o sistema atual em uma plataforma de escritório extensível, organizada em quatro camadas compreensíveis:

1. **Organização** — Building, Floor, Sector e Agent: quem existe e onde trabalha.
2. **Recursos** — Knowledge, Apps, Databases e Tools: o que o escritório possui e o que cada agente pode usar.
3. **Operação** — Flows, Monitors e Activity: o que dispara, coordena e registra o trabalho.
4. **Plataforma** — Extensions, Marketplace, Runtime, Permissions e Secrets: como usuários criam, compartilham, instalam e executam capacidades com segurança.

Conservar a metáfora do escritório na linguagem do produto:

| Conceito técnico | Linguagem principal na interface |
|---|---|
| Building | Empresa / Escritório |
| Floor | Andar / Unidade |
| Sector | Setor / Departamento |
| Agent | Funcionário / Agente |
| Knowledge | Biblioteca, manuais e conhecimento curado |
| Memory | Anotações e fatos lembrados |
| Database/Data Store | Sistema interno de registros |
| App | Software conectado pela empresa |
| Tool | Ferramenta/capacidade de execução |
| Flow | Processo de trabalho |
| Monitor | Processo de plantão |
| Permission | Crachá e nível de acesso |
| Activity | Histórico operacional ao vivo |

O caso de trading deve ser uma composição comum da plataforma, não uma arquitetura especial:

`Market App → Market Database → Analysis Tools → Monitor → Flow → Agents → Notification`

A mesma estrutura precisa servir para atendimento, estoque, marketing, financeiro, servidor, lead, e-mail ou qualquer evento futuro.

---

## 2. Estado atual que deve ser preservado

O repositório já possui bases relevantes. Não duplicá-las:

- Knowledge/RAG em `knowledge_documents` e `knowledge_chunks`, com donos `building`, `floor`, `sector` e `agent`, política explícita por agente e resolução única em `knowledgeAccess.ts`/`knowledgeRetrieval.ts`.
- Context Manifest, lacunas, propostas, conflitos, links, mapa, impacto e evals do Knowledge Brain.
- memória determinística separada em `backend/src/memory/*`.
- Apps oficiais e privados por manifesto, `AppSource = system | private | community`, instalações em `connections`, grants por ação no agente e execução declarativa HTTP pelo executor canônico.
- ferramentas personalizadas HTTP na coleção `tools`, com JSON Schema, segredo cifrado, SSRF guard, limites e atribuição por agente.
- funções determinísticas registradas e executores `llm | function | tool`.
- histórico genérico em `backend/src/dataHistory/*` e dados de mercado especializados em `backend/src/marketData/*`.
- eventos internos duráveis em `backend/src/events/*`.
- automações, rotinas, condições, agenda, webhook, evento interno, DAG por `dependsOn`, fila, lease, retry e execução rastreável em `backend/src/automations/*`.
- raízes de execução, logs, auditoria, estado ao vivo dos agentes e tela de Execuções.
- arquitetura visual atual de prédio, andar, setor, agentes, Apps e Knowledge Map.

Regras de preservação:

- não transformar preço, candle, volume, mensagem WebSocket ou histórico em documento RAG;
- não transformar Memory em Database nem Database em Memory;
- não criar outro event bus, scheduler, worker, executor HTTP, sistema de secrets ou fila;
- não remover os adapters e endpoints antigos antes de todos os consumidores migrarem;
- não mudar o comportamento de agentes legados apenas porque um campo novo passou a existir;
- não quebrar bookmarks, deep links, mobile navigation, Chat Web, WhatsApp, widget, Knowledge Map ou Arquiteto.

---

## 3. Decisões arquiteturais obrigatórias

### 3.1 Resource é um contrato comum, não uma supercoleção

Criar uma camada de domínio comum para listar, referenciar, conceder acesso e mostrar recursos. **Não** mover todos os dados para uma coleção polimórfica gigante.

Cada tipo mantém sua fonte canônica e seu ciclo de vida:

- Knowledge continua no subsistema de Knowledge.
- App Definition, App Installation e App Grant continuam no subsistema de Apps.
- Database/Data Store usa armazenamento estruturado e adapters próprios.
- Tool continua no subsistema de Tools/Executors.
- Monitor continua sendo Operation, não um arquivo ou documento.

Criar tipos comuns, por exemplo:

```ts
type ResourceKind = 'knowledge' | 'app' | 'database' | 'tool'

type ResourceOwnerType =
  | 'platform'
  | 'account'
  | 'building'
  | 'floor'
  | 'sector'
  | 'agent'

type ResourceRef = {
  kind: ResourceKind
  id: string
}

type ResourceOwnerRef = {
  ownerType: ResourceOwnerType
  ownerId: string
}

type ResourceSubjectRef = {
  subjectType: 'building' | 'floor' | 'sector' | 'agent'
  subjectId: string
}
```

Uma projeção/index de catálogo pode existir para busca e UI, mas deve guardar somente metadados reconstruíveis e referência à fonte canônica. Nunca copiar credenciais, conteúdo RAG, registros, código ou configurações sensíveis para essa projeção.

### 3.2 Dono não é acesso

Todo recurso deve responder separadamente:

- quem é o dono administrativo;
- quais sujeitos conseguem encontrá-lo;
- quais capacidades cada sujeito possui;
- de onde a permissão veio;
- qual regra negou uma ação.

Criar um resolvedor server-side único, algo como:

```ts
resolveResourceAccess({
  accountId,
  actorAgentId,
  resource,
  executionContext,
  requestedCapability,
})
```

O resultado deve trazer `allowed`, capacidade efetiva, origem (`direct`, `sector`, `floor`, `building`, `specialized_policy`) e motivo seguro. Nunca confiar em owner, scope, subject ou capability enviados pelo cliente sem resolvê-los na conta atual.

O resolvedor comum deve delegar para políticas especializadas quando elas já são mais ricas:

- Knowledge usa `resolveKnowledgeOwnersForExecution` e `KnowledgeAccessPolicy` como fonte de verdade.
- Apps continuam exigindo instalação utilizável + ação concedida + autorização autônoma para escrita.
- Tool continua exigindo atribuição/capacidade e estado habilitado.
- Database usa capabilities próprias.

Não enfraquecer esses gates para fazer tudo caber numa abstração genérica.

### 3.3 Capacidades, não acesso binário

Definir catálogos de capabilities por tipo:

| Tipo | Capabilities iniciais |
|---|---|
| Knowledge | `discover`, `retrieve`, `curate`, `manage` |
| App | as ações declaradas no manifesto; risco continua `read`, `write`, `high_risk` |
| Database | `discover`, `query`, `insert`, `update`, `delete`, `manage_schema`, `manage_access` |
| Tool | `discover`, `execute`, `test`, `edit`, `publish`, `manage_access` |

Capabilities de agente são operacionais. Ações administrativas como schema, publicação, revisão, credenciais e concessão de acesso nunca devem ser oferecidas automaticamente à LLM.

Permissões herdadas precisam ser visíveis. Um grant para setor vale para os membros atuais do setor e pode alcançar futuros membros; a UI deve explicar esse impacto antes de salvar. Implementar precedência determinística e testada. Se houver `deny`, ele vence `allow` no mesmo recurso/capability. Não inferir acesso por mera proximidade visual.

### 3.4 Papel do agente versus ferramenta

Preservar a regra:

- se interpreta, decide, planeja, coordena ou conversa: Agent;
- se calcula, consulta, envia, salva ou executa algo determinístico: Function/Tool/App/Database;
- se coordena passos: Flow;
- se observa continuamente uma condição: Monitor.

Não criar agentes RSI, MACD, e-mail, insert ou webhook. Um Agente Técnico pode usar várias ferramentas sob uma responsabilidade principal.

### 3.5 Versionamento imutável no que é compartilhado

Rascunhos são editáveis. Toda versão instalada ou publicada é imutável e possui hash. Atualização cria nova versão; nunca altera em silêncio o que já está instalado.

Breaking changes exigem revisão explícita das novas permissões. Instalações ficam pinadas à versão até o dono aprovar update. Credenciais e configurações locais não entram no pacote compartilhado.

---

## 4. Arquitetura-alvo de domínio

### 4.1 Organization

Continuar usando os modelos atuais de Building, Floor, Sector e Agent. Adicionar somente referências/consultas necessárias para resolver recursos, operações e contexto.

Não duplicar membros de setor, floorId ou buildingId dentro de grants como fonte de verdade. Resolver a hierarquia real no momento da autorização e usar cache curto invalidado por mudança de membership.

### 4.2 Resource Catalog

Criar `backend/src/resources/` com responsabilidades pequenas:

- `types.ts` — tipos comuns e DTOs públicos;
- `registry.ts` — adapters por `ResourceKind`;
- `catalog.ts` — lista/busca/projeção de recursos;
- `access.ts` — resolução comum e explicável;
- `grants.ts` — grants genéricos somente onde não existe política especializada;
- `scope.ts` — validação owner-scoped de building/floor/sector/agent;
- `impact.ts` — dependências antes de mover, revogar, arquivar ou excluir;
- `migration.ts` — backfills retomáveis;
- `audit.ts` — eventos seguros de alteração de acesso.

Interface conceitual do adapter:

```ts
interface ResourceAdapter {
  kind: ResourceKind
  list(ctx: ResourceListContext): Promise<ResourceSummary[]>
  get(ctx: ResourceGetContext): Promise<ResourceDetail | null>
  capabilities(resourceId: string): Promise<ResourceCapability[]>
  resolveAccess(ctx: ResourceAccessContext): Promise<ResourceAccessDecision>
  impact(ctx: ResourceImpactContext): Promise<ResourceImpact>
}
```

Criar APIs de leitura comum sem substituir APIs de mutação específicas:

- `GET /api/resources?kind=&scopeType=&scopeId=&access=owned|available&q=`
- `GET /api/resources/:kind/:resourceId`
- `GET /api/resources/:kind/:resourceId/access`
- `GET /api/resources/:kind/:resourceId/impact`
- `GET /api/agents/:agentId/resource-access`

Para tipos que usam grants genéricos:

- `PUT /api/resources/:kind/:resourceId/grants`
- `DELETE /api/resources/:kind/:resourceId/grants/:grantId`

Mutação de Knowledge, Apps, Databases e Tools continua em rotas canônicas próprias.

### 4.3 Database / Data Store

Criar o conceito de **Database** na UI e `DataStore` no backend. Um Data Store é um recurso lógico que contém datasets estruturados e usa um adapter de armazenamento.

Modelo sugerido:

```ts
type DataStoreAdapterKind =
  | 'data_history'
  | 'market_data'
  | 'external_app'

interface DataStore {
  _id: ObjectId
  accountId: string
  buildingId: ObjectId
  name: string
  description: string
  owner: ResourceOwnerRef
  adapterKind: DataStoreAdapterKind
  adapterConfig: Record<string, unknown> // referências, nunca segredo
  status: 'active' | 'paused' | 'archived'
  retention: Retention
  version: number
  createdAt: Date
  updatedAt: Date
}

interface DataSetDefinition {
  _id: ObjectId
  dataStoreId: ObjectId
  key: string
  name: string
  schema: Record<string, unknown>
  primaryKey?: string[]
  mutability: 'append_only' | 'mutable' | 'read_only'
  timeField?: string
  createdAt: Date
  updatedAt: Date
}
```

Não criar um Mongo/SQL console para a LLM. Agentes acessam databases por ferramentas tipadas:

- `database_list_datasets`
- `database_query`
- `database_insert`
- `database_update`
- `database_delete`

As ferramentas recebem filtros em DSL segura e limitada, nunca JavaScript, Mongo operators arbitrários ou SQL livre. Validar filtros, campos, paginação, ordenação e tamanho no servidor. Validar insert/update contra o JSON Schema do dataset.

Regras:

- `market_data` é virtual/read-only e reutiliza `marketData`; não mover candles nem reimplementar indicadores.
- `data_history` reutiliza recorders e records existentes; introduzir referências `dataStoreId`/`datasetId` por migração compatível.
- `external_app` aponta para App Installation e ações declaradas; credencial continua em `connections`.
- `update/delete` são impossíveis em dataset `append_only` e `read_only`, mesmo com grant malformado.
- `manage_schema` e `manage_access` ficam apenas em APIs humanas/autorizadas.
- queries deixam log com store, dataset, agente, capacidade, duração e contagem; nunca conteúdo integral.

Criar índices, cotas por conta/store, retenção, paginação estável, exportação limitada e análise de impacto. Toda exclusão material precisa de preview/confirm e deve respeitar dependências de monitors/flows/tools.

### 4.4 Tools evolutivas

Evoluir a Tool atual sem quebrar ferramentas HTTP existentes.

Modelo lógico:

```ts
type ToolRuntimeKind =
  | 'http'
  | 'app_action'
  | 'registered_function'
  | 'code'

interface ToolDefinition {
  id: string
  owner: ResourceOwnerRef
  name: string
  description: string
  visibility: 'private' | 'organization' | 'community'
  runtimeKind: ToolRuntimeKind
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  risk: 'read' | 'write' | 'high_risk'
  status: 'draft' | 'testing' | 'active' | 'archived'
  currentDraftVersion: string
}
```

Ferramentas existentes migram como `runtimeKind: http`, versão inicial e owner `building`, preservando IDs e `customToolIds`. O runtime final continua passando pelo dispatcher/executor canônico e retornando `ExecutorResult`.

Criar editor com quatro origens:

1. HTTP manual.
2. Ação de App conectado.
3. Função registrada da plataforma.
4. Código Python/JavaScript, somente quando o runtime isolado estiver habilitado.

Todo tipo declara input/output schema, timeout, limites, risco, permissões requeridas e testes. Não usar LLM para consertar saída inválida de função determinística.

### 4.5 Flows

Promover a capacidade atual de automações para uma superfície explícita de Flow sem criar engine paralela.

Um Flow é uma `AutomationDefinition` versionada cujo grafo usa `dependsOn` para sequência e paralelismo. Reusar steps, condições, execution modes, run queue, leases, retries, roots, audit e deliveries.

Adicionar `operationKind: routine | flow | monitor` de modo compatível:

- rotina atual de agente → `routine`;
- automação standalone legada → `flow` quando não possuir semântica de monitor;
- monitor novo → `monitor`.

Ausência do campo conserva o comportamento legado por função de normalização. Não executar migração destrutiva no boot.

O editor visual deve permitir:

- agente/função/tool/app/database como steps;
- dependências múltiplas;
- caminhos paralelos;
- join explícito;
- condição `runIf` determinística;
- preview de input/output entre etapas;
- dry-run sem efeitos externos;
- publicação versionada;
- histórico por versão.

### 4.6 Monitors e State

Criar Monitor como operação de plantão: observa uma fonte e dispara um Flow quando uma condição determinística muda de estado.

Modelo sugerido:

```ts
interface MonitorDefinition {
  source: MonitorSourceRef
  observation: MonitorObservation
  condition: ConditionAst
  triggerMode: 'level' | 'enter' | 'exit' | 'cross_up' | 'cross_down' | 'change'
  debounceMs: number
  cooldownMs: number
  action: { flowId: string; version?: number }
  enabled: boolean
}

interface MonitorState {
  monitorId: ObjectId
  ownerId: string
  previousValue: unknown
  currentValue: unknown
  conditionWasTrue: boolean
  conditionIsTrue: boolean
  lastObservedAt: Date | null
  lastTriggeredAt: Date | null
  cooldownUntil: Date | null
  lastEventId: string | null
  status: 'watching' | 'paused' | 'degraded' | 'error'
  error: { code: string; message: string } | null
  version: number
}
```

Reutilizar `internal_event`, scheduler, `StepCondition`, data history, market events, App/WebSocket events e run queue. Não avaliar condição com LLM a cada evento.

Oferecer dois modos de criação:

- editor visual de fonte + condição + ação;
- linguagem natural que a IA traduz para um rascunho de `ConditionAst`, mostra a interpretação e exige confirmação antes de publicar.

Suportar detecção de borda real. `RSI cruzou 30 para cima` não é equivalente a `RSI está acima de 30`. Persistir estado de forma atômica, com dedupe e idempotência para não disparar o mesmo evento duas vezes.

O monitor não mantém balão de agente em “trabalhando”. O agente só muda de estado quando o Flow realmente começa.

### 4.7 Activity ao vivo

Criar uma projeção unificada e segura para atividade do escritório, reutilizando `ExecutionRoot`, automation runs, agent live state, event bus e tool/app action logs.

Mostrar:

- fontes conectadas e freshness;
- monitors `watching`, `paused`, `degraded`, `error`;
- último valor/indicador seguro;
- condição atual e distância para o limiar quando aplicável;
- evento que disparou;
- Flow iniciado;
- steps/agentes em fila, execução, sucesso, falha ou skip;
- entrega/notificação;
- links para a execução e para a configuração responsável.

Usar Socket.IO atual para atualização ao vivo. Persistir apenas eventos operacionais necessários para histórico e correlação; não copiar payload integral, prompt, resposta, credencial ou conteúdo RAG.

Uma timeline deve usar `executionRootId`/`correlationId` e evitar dupla contagem entre prédio, andar, setor, agente e step.

### 4.8 Extensions e Marketplace

Criar um pacote versionado comum para itens compartilháveis:

```ts
type ExtensionKind = 'app' | 'tool' | 'template'
type ExtensionVisibility = 'private' | 'organization' | 'community'
type ExtensionStatus =
  | 'draft'
  | 'testing'
  | 'submitted'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'published'
  | 'suspended'
  | 'deprecated'

interface ExtensionPackage {
  _id: ObjectId
  authorAccountId: string
  kind: ExtensionKind
  slug: string
  name: string
  summary: string
  categories: string[]
  visibility: ExtensionVisibility
  status: ExtensionStatus
  latestVersion: string | null
  createdAt: Date
  updatedAt: Date
}

interface ExtensionVersion {
  _id: ObjectId
  packageId: ObjectId
  version: string
  manifest: Record<string, unknown>
  permissionManifest: PermissionRequest[]
  artifactRef?: string | null
  sha256: string
  changelog: string
  compatibility: PlatformCompatibility
  review: ReviewResult | null
  immutable: boolean
  createdAt: Date
}
```

Separar pacote, versão e instalação. Uma instalação registra package/version, status, config local, grants locais e update disponível. Nunca colocar secrets dentro de package/version.

Usar o ciclo:

`Draft → Testing → Submitted → Review → Approved → Published`

Suspensão bloqueia novas instalações imediatamente e pode bloquear execuções conforme severidade, com motivo visível. Não apagar instalações ou histórico.

Marketplace inicial:

- busca, categoria, tipo e procedência;
- página do item com autor, versão, changelog, permissões, domínios, runtime, compatibilidade e conteúdo incluído;
- instalar em um escritório;
- versão pinada e update com diff de permissões;
- “Minhas criações”, “Instalados” e “Enviados para revisão”;
- reportar item;
- contagem real de instalações;
- sem pagamentos nesta fase.

Não executar HTML, React, script ou bundle de UI fornecido pela comunidade. Apps comunitários permanecem manifestos declarativos e usam superfícies nativas/declarativas aprovadas pela plataforma.

### 4.9 Templates comunitários

Template pode incluir:

- agentes com responsabilidades e contratos;
- setores e relações;
- Tools e Data Store schemas sem dados;
- Flows e Monitors em rascunho;
- dependências de Apps por `appKey` e capabilities;
- políticas recomendadas, nunca credenciais ou autorização já concedida.

Instalação de template deve reutilizar o Arquiteto/preview/diff/apply:

1. resolver compatibilidade e dependências;
2. mostrar o que será criado/reutilizado/alterado;
3. pedir conexão de Apps e grants ausentes;
4. criar tudo como draft/inativo quando houver efeito externo;
5. aplicar somente após aprovação;
6. guardar marcas de origem e permitir rollback apenas do que a instalação criou e ninguém editou.

Não copiar memória, conversas, execuções, conteúdo privado, dados de database ou secrets do autor.

---

## 5. Runtime seguro para Python e JavaScript

Esta seção é obrigatória para habilitar `runtimeKind: code`. Não usar `eval`, `new Function`, `vm`, `child_process`, `exec`, Python local ou container iniciado pelo processo principal.

### 5.1 Fronteira

Criar em `backend/src/extensionRuntime/` uma interface de provider remoto:

```ts
interface SandboxRuntimeProvider {
  testVersion(request: SandboxTestRequest): Promise<SandboxResult>
  execute(request: SandboxExecuteRequest): Promise<SandboxResult>
  health(): Promise<SandboxHealth>
}
```

O backend envia somente:

- código/artifact identificado por versão e hash;
- runtime e versão suportada;
- input JSON validado;
- limites efetivos;
- capability handles de curta duração;
- correlation id.

O runner devolve somente output JSON/text limitado, métricas e erro tipado. O provider precisa autenticar backend↔runner e recusar replay.

### 5.2 Isolamento mínimo obrigatório

O ambiente de cada execução deve ser novo e descartável, com:

- usuário não-root;
- filesystem raiz somente leitura;
- diretório temporário com cota;
- rede negada por padrão;
- CPU, memória, pids, tempo e tamanho de saída limitados;
- capabilities Linux removidas, `no-new-privileges`, seccomp e isolamento equivalente;
- nenhum socket do host, Docker socket, metadata de nuvem, rede privada ou volume da aplicação;
- cancelamento duro ao exceder limite;
- limpeza verificável depois da execução;
- logs sem source completo, input, output sensível ou secret.

Produção só pode habilitar código quando `SandboxRuntimeProvider.health()` comprovar o perfil esperado e a configuração de produção validar. Se o provider não estiver configurado, Tools de código podem ser editadas/testadas por validação estática, mas não ativadas, publicadas ou executadas.

Um runner local, se necessário para testes, deve ser explicitamente `test-only` e impossível de habilitar em produção.

### 5.3 Dependências, rede e secrets

Primeira versão:

- Python e JavaScript standard library + allowlist versionada;
- sem `pip install`, `npm install`, import remoto ou pacote arbitrário na execução;
- rede bloqueada;
- nenhum secret bruto em variável de ambiente, input ou source;
- acesso a App/Database somente por capability broker com token curto, escopo exato, uso limitado e vinculado à execução;
- cada chamada do broker passa novamente pelo resolvedor de permissão canônico;
- output é redigido e validado antes de persistir.

Se futuramente houver rede, usar egress broker com host/método/path declarados e revisados; nunca liberar internet geral.

### 5.4 Review e supply chain

Antes de publicar versão de código:

- validar AST/bytecode quando aplicável;
- procurar imports proibidos, tentativa de subprocesso, filesystem, rede, reflexão perigosa e payload ofuscado;
- gerar SBOM/manifesto de dependências;
- fixar runtime e dependências;
- calcular SHA-256;
- executar threat suite na sandbox;
- exigir revisão humana para primeira publicação e para mudança de permissões/runtime;
- manter kill switch por package/version/hash;
- registrar quem aprovou e qual scanner/regras foram usados.

Scanner não substitui sandbox. Sandbox não substitui grants. Review não transforma código em confiável.

---

## 6. Secrets Vault

Generalizar o padrão cifrado já usado por Apps sem expor valores.

Criar referências de secret com escopo e finalidade, por exemplo:

```ts
interface SecretRef {
  id: string
  ownerType: 'account' | 'building'
  ownerId: string
  name: string
  purpose: string
  createdAt: Date
  rotatedAt: Date | null
}
```

Regras:

- API nunca devolve o valor, apenas existência/metadata segura;
- App Installation continua dona das credenciais específicas de conexão;
- Vault serve a secrets reutilizáveis declarados por extensões, sem duplicá-los no manifesto;
- LLM nunca vê secret;
- ferramenta de código recebe handle, não valor;
- acesso é concedido por versão/purpose/capability, com audit;
- rotação não exige editar manifests;
- excluir secret mostra impacto e bloqueia enquanto conexão ativa depende dele, salvo confirmação explícita de interrupção;
- logs e erros passam por redaction central.

Não criar criptografia nova. Reusar `crypto.ts`, política de chave e processo de rotação existentes.

---

## 7. Organização da interface

### 7.1 Sidebar global

Reorganizar progressivamente, usando uma única fonte de navegação para desktop/mobile:

```text
OFFICE
  Overview
  Floors
  Sectors
  Agents

RESOURCES
  Knowledge
  Apps
  Databases
  Tools

OPERATIONS
  Flows
  Monitors
  Activity

COMMUNITY
  Marketplace
  My creations
  Installed

SETTINGS
```

Não adicionar quatro itens primários no bottom nav. Mobile deve manter os destinos principais e expor o restante no drawer, com safe area, foco, back e deep links.

Preservar rotas antigas com redirects/adapters:

- `/apps?tab=custom` continua abrindo Tools até a nova rota estabilizar;
- `/historicos` redireciona ou abre o Database/Data History correspondente;
- `/executions` continua sendo Activity/Execuções;
- rotas de floor/sector/agent existentes continuam resolvendo.

### 7.2 Visões por contexto

Existem duas formas de chegar ao mesmo recurso:

- visão global: “o que existe no escritório?”;
- visão contextual: “o que este andar/setor/agente possui ou consegue usar?”.

No andar e setor, criar seção `Resources` com contagens reais e tabs Knowledge, Apps, Databases e Tools. Não duplicar os recursos; filtrar o catálogo comum por contexto.

### 7.3 Página do agente

Reorganizar sem apagar componentes atuais:

- Overview
- Role & Instructions
- Knowledge
- Access
- Memory
- Flows
- Activity
- Advanced

`Access` deve mostrar matriz efetiva e editável:

- Apps e ações;
- Databases e capabilities;
- Tools;
- Knowledge e política resolvida;
- origem da permissão: direta, setor, andar ou building;
- denies e pendências;
- link para o recurso/instalação/conexão.

Não mostrar grant inválido como acesso funcional. Instalação pausada, versão incompatível, secret ausente ou App `coming_soon` devem aparecer como pendência com ação corretiva.

### 7.4 Databases

Página global:

- cards/lista com nome, owner, adapter, datasets, status, freshness, retenção, tamanho/cota e consumidores;
- criar Database;
- conectar fonte existente;
- abrir datasets, schema, consulta paginada e grants;
- preview antes de exclusão/alteração de retenção.

Não chamar Market Data de “memória” ou “conhecimento”. Mostrar origem e última atualização.

### 7.5 Monitors

Builder em linguagem de negócio:

- nome;
- fonte;
- campo/indicador;
- condição;
- trigger mode;
- debounce/cooldown;
- Flow acionado;
- preview em frase;
- teste com evento de exemplo;
- draft/published/paused.

Modo natural traduz para draft e mostra exatamente:

`Ativo CXSE3 · RSI(14) cross_down 30 · suporte <= 1.5% · executar Swing Trade`

Salvar nunca publica automaticamente.

### 7.6 Activity

Criar visão `Sistema ao vivo` com filtros por building/floor/sector/agent/source/monitor/flow/status. Usar dados reais, estados honestos e timestamps. Sem atividade, mostrar vazio — nunca eventos demonstrativos misturados com produção.

### 7.7 Marketplace

Criar páginas responsivas para catálogo, detalhe, instalar, update diff, criar/editar, testing, submissão, review status, instalados e reportar.

Antes de instalar, mostrar:

- conteúdo incluído;
- versão e compatibilidade;
- domínios externos;
- capabilities solicitadas;
- risco de ações;
- uso de runtime de código;
- secrets necessários;
- custo de terceiro quando declarado;
- mudanças em updates.

---

## 8. APIs e serviços esperados

Além das APIs de Resource Catalog, implementar de forma owner-scoped:

### Databases

- `GET/POST /api/databases`
- `GET/PATCH/DELETE /api/databases/:id`
- `GET/POST /api/databases/:id/datasets`
- `GET/PATCH/DELETE /api/databases/:id/datasets/:datasetId`
- `POST /api/databases/:id/datasets/:datasetId/query`
- endpoints humanos de insert/update/delete com confirmação/CSRF/origin checks
- `GET /api/databases/:id/impact`

### Flows e Monitors

- evoluir as rotas canônicas de automação; não criar segundo backend;
- `GET/POST /api/flows`
- `GET/PATCH /api/flows/:id`
- `POST /api/flows/:id/publish|pause|test|run`
- `GET/POST /api/monitors`
- `GET/PATCH /api/monitors/:id`
- `POST /api/monitors/:id/publish|pause|resume|test`
- `GET /api/monitors/:id/state`
- `GET /api/activity` e stream Socket.IO correlacionado.

### Extensions/Marketplace

- `GET /api/community/packages`
- `GET /api/community/packages/:slug`
- `POST /api/extensions`
- `PATCH /api/extensions/:id`
- `POST /api/extensions/:id/versions`
- `POST /api/extensions/:id/test`
- `POST /api/extensions/:id/submit`
- endpoints de reviewer protegidos por role server-side;
- `POST /api/community/packages/:id/install`
- `POST /api/community/installations/:id/update`
- `POST /api/community/installations/:id/uninstall`
- `GET /api/community/installations/:id/impact`
- `POST /api/community/packages/:id/report`.

Instalar/uninstall/update deve ser idempotente. Uninstall não apaga recursos que o usuário editou; mostrar impacto e arquivar/desvincular de forma segura.

### Sandbox Runtime

Rotas internas backend↔runner não devem ser públicas nem usar sessão de browser. Usar autenticação de serviço, nonce/timestamp, limite e allowlist de origem/rede. Não permitir que o cliente escolha URL do runner.

---

## 9. Migração e compatibilidade

Criar migrações idempotentes, retomáveis e auditáveis. Não fazer remoção destrutiva no startup.

### 9.1 Resources

- backfill/projeção de Knowledge Bases existentes sem copiar conteúdo;
- projetar App Installations existentes;
- migrar Tools existentes para `runtimeKind: http`, owner building e versão inicial preservando `_id`;
- grants antigos continuam sendo lidos durante dual-read;
- comparar decisão antiga e nova em shadow mode antes de trocar escrita.

### 9.2 Databases

- criar um Data Store padrão por conta/building para históricos existentes;
- associar recorders/datasets sem mover records em massa quando uma referência derivada ou lazy backfill for suficiente;
- expor Market Data como adapter virtual read-only;
- não apagar `retentionDays` até consumidores antigos migrarem.

### 9.3 Operations

- normalizar automações existentes para `routine` ou `flow` sem mudar trigger/status/version;
- Monitors são novos e não devem reclassificar rotina apenas por ela usar evento;
- manter scheduler e worker lendo versões legadas até backfill validado.

### 9.4 Extensions

- cada App privado existente pode ganhar um Extension Package privado por backfill, mantendo `app_definitions` como fonte durante dual-read;
- Apps oficiais ganham packages/projeções `platform` somente para catálogo, sem mudar adapters compilados;
- Tools privadas podem ganhar package apenas quando o autor escolher “Preparar para compartilhar”; não publicar automaticamente;
- `community` já presente nos tipos não significa que exista conteúdo confiável: só resolver package/version publicado, aprovado e compatível.

### 9.5 Rollout

Adicionar flags com gate real no backend e consumidor no frontend:

- `RESOURCE_PLATFORM_ENABLED`
- `DATABASES_ENABLED`
- `MONITORS_ENABLED`
- `COMMUNITY_MARKETPLACE_ENABLED`
- `CODE_TOOLS_ENABLED`

Flags de backend devem de fato negar rotas/execução, não só esconder UI. Produção deve falhar fechada para `CODE_TOOLS_ENABLED=true` sem runtime seguro saudável.

Usar etapas:

1. schema + dual-read;
2. shadow authorization com métricas sem conteúdo;
3. UI de leitura;
4. escrita nova;
5. migração;
6. desligar legado somente após fixture, contagens e rollback documentado.

---

## 10. Segurança obrigatória

- Toda consulta filtra `accountId/ownerId` no banco, não depois da leitura.
- Resposta negativa não diferencia id inválido, inexistente ou de outra conta.
- Nenhuma rota administrativa é concedida a agente/LLM por estar visível no catálogo.
- Grants nunca carregam secrets.
- Ações write/high-risk exigem autorização explícita e continuam sujeitas a políticas específicas imediatamente antes do efeito.
- Instalação, pin, visibilidade, ownership e grant são conceitos independentes.
- Community package nunca executa código no backend principal.
- Manifesto comunitário não aponta para import, module path, React component, script ou adapter nativo.
- URL HTTP passa pelo `safeHttp`/SSRF guard atual em cada redirect e resolução DNS.
- Código não possui internet, filesystem persistente, subprocesso, socket do host ou metadata.
- Inputs/outputs seguem tamanho/profundidade/schema e redaction.
- Rate limit por conta, autor, IP e operação sensível.
- CSRF/origin protection nas mutações autenticadas.
- Audit para grant, revoke, publish, review, install, update, execute, secret access, suspend e delete.
- Logs nunca contêm credencial, source completo de código, payload integral, documentos, prompts ou respostas completas.
- Content vindo de App/WebSocket/Database é não confiável e não amplia permissões.
- Package/version/artifact é verificado por hash antes de executar.
- Suspensão e kill switch são server-side.
- Não usar popularidade, rating ou autor como sinal de segurança.

Criar threat model em `docs/security/community-extensions-threat-model.md` e contrato de runtime em `docs/architecture/extension-runtime.md`.

---

## 11. Observabilidade e métricas

Medir sem conteúdo sensível:

- decisão de Resource Access por kind/capability/origem/motivo;
- consultas e mutações de Database, duração, linhas, bytes e falha;
- observações, transições e triggers de Monitor;
- runs de Flow por versão;
- execução de Tool por runtime, versão, duração, external calls e erro;
- fila/tempo/cancelamento da sandbox;
- install/update/uninstall de extensão;
- review duration e suspensões;
- falhas por versão/hash;
- cotas e throttling.

Activity de usuário e telemetria operacional usam os mesmos IDs de correlação. Não criar contadores apenas no frontend.

---

## 12. Fases de implementação e commits

### Fase 0 — Baseline e ADR

1. Criar `OFFICE_PLATFORM_RESOURCE_COMMUNITY_PROGRESS.md`.
2. Registrar commit base, inventário e diferenças para este plano.
3. Rodar build/test baseline relevante.
4. Criar ADR da separação Organization/Resources/Operations/Platform.
5. Criar matriz do que é canônico e do que é projeção.

Critério: nenhum comportamento alterado; baseline reproduzível.

### Fase 1 — Resource contracts e access facade

1. Criar `backend/src/resources/*` e testes puros.
2. Implementar adapters de leitura para Knowledge, Apps e Tools.
3. Implementar validação de scopes e decisões explicáveis.
4. Criar APIs de catálogo/access/impact.
5. Conectar auditoria e shadow comparison sem mudar runtime.

Critério: recursos atuais aparecem por uma API comum e nenhuma conta atravessa scope.

### Fase 2 — UI organizacional e Access do agente

1. Evoluir a navegação única.
2. Criar Resources global/contextual.
3. Criar matriz Access no agente usando decisões do servidor.
4. Preservar rotas e redirects.
5. Cobrir desktop, tablet, 390, 360 e 320 px.

Critério: usuário entende owner, acesso, origem e pendência sem abrir documentos técnicos.

### Fase 3 — Data Stores/Databases

1. Criar modelos, adapters, schemas, quotas e índices.
2. Adaptar data history e market data.
3. Implementar DSL segura e built-in tools.
4. Implementar grants/capabilities e impacto.
5. Criar UI completa de Database/datasets/query/access.
6. Migrar fixture legada em dual-read.

Critério: um agente autorizado consulta dados estruturados sem RAG; não autorizado é negado antes da leitura.

### Fase 4 — Tool model versionado

1. Generalizar runtime kinds e versões.
2. Migrar HTTP Tools preservando IDs.
3. Integrar App action, registered function e Database capabilities.
4. Exigir output schema em item publicável.
5. Evoluir editor/teste/access/impact.

Critério: HTTP Tools antigas executam igual; novas origens passam pelo dispatcher único.

### Fase 5 — Flows, Monitors e State

1. Introduzir `operationKind` compatível.
2. Criar Flow surface sobre Automation engine.
3. Criar MonitorDefinition, Condition AST e MonitorState.
4. Implementar transição atômica, edge detection, debounce, cooldown, dedupe e trigger do Flow.
5. Criar builder visual/natural com draft obrigatório.
6. Cobrir restart, concorrência e event replay.

Critério: condição dispara exatamente uma execução, inclusive após restart; zero token no caminho determinístico.

### Fase 6 — Activity unificada

1. Criar projeção/timeline correlacionada.
2. Ligar updates ao Socket.IO atual.
3. Criar filtros e links.
4. Garantir não duplicação hierárquica e TTL.

Critério: usuário vê fonte → monitor → flow → agentes/steps → entrega com dados reais.

### Fase 7 — Extension packages e versões

1. Criar packages, versions, installations, hashes e compatibility.
2. Backfill de Apps privados como package privado.
3. Implementar lifecycle, diff de permissões e audit.
4. Criar My creations/Installed e APIs.

Critério: rascunho editável; versão instalada imutável e pinada.

### Fase 8 — Marketplace declarativo

1. Catálogo comunitário, detalhe, busca, instalação, update e report.
2. Workflow de submissão/review/suspensão.
3. Publicar Apps declarativos, HTTP Tools e Templates sem código.
4. Integrar template installer ao Arquiteto/diff/apply.
5. Validar que credenciais/dados não entram no pacote.

Critério: um segundo usuário instala versão aprovada e fornece suas próprias conexões/permissões.

### Fase 9 — Sandbox Runtime

1. Criar provider contract, service auth, capability broker e config fail-closed.
2. Implementar/ligar runtime isolado aprovado.
3. Criar scanners, hashes, SBOM, threat suite e kill switch.
4. Habilitar Tool de código privada atrás de flag.
5. Fazer pentest automatizado e carga/limites.

Critério: tentativas de rede, filesystem, subprocesso, fork bomb, timeout, secret access e output excessivo são bloqueadas e auditadas.

### Fase 10 — Community code publishing

1. Permitir submissão de versão de código somente após Fase 9 verde.
2. Exigir review humano e diff de permissões.
3. Testar instalação/update/suspensão/kill switch.

Critério: código comunitário nunca roda sem package/version/hash aprovado e sandbox saudável.

### Fase 11 — Hardening, migração final e documentação

1. Rodar fixtures de migração e rollback.
2. Remover dual-write somente com evidência.
3. Rodar suíte completa, E2E, accessibility, responsive, threat e carga.
4. Atualizar README/env/compose/runbooks.
5. Produzir relatório final.

Critério: todos os gates deste plano verdes; nada marcado concluído por placeholder.

Cada fase deve ter um commit próprio ou pequeno conjunto lógico, com mensagem clara, e registrar hash/resultados no progress file. Push somente para `origin/development`; não fazer merge.

---

## 13. Testes obrigatórios

### Backend unitário

- `ResourceRef`, scope resolution e capability catalog.
- precedência de direct/sector/floor/building e deny.
- adapter especializado não perde regra de Knowledge/App.
- Data query DSL recusa operators/campos/profundidade/tamanho inválidos.
- schemas de dataset e tool input/output.
- operation kind legacy normalization.
- Condition AST, level, enter, exit, cross_up, cross_down, change.
- debounce, cooldown e edge cases numéricos.
- package semver, hash, immutability, permission diff e compatibility.
- manifestos comunitários recusam native adapter/surface code/import/script.
- sandbox request/response/redaction/config fail-closed.

### Integração

- isolamento entre duas contas para cada nova coleção/rota.
- grant por setor muda efetivamente com membership e mostra impacto.
- agente sem capability de Database não lê nem infere contagem.
- append-only recusa update/delete.
- Market Data adapter usa dados existentes e permanece read-only.
- Tool HTTP antiga funciona após migração.
- App action exige instalação + action grant + autonomous write.
- flow paralelo executa uma vez, faz join e respeita continueOnError.
- monitor concorrente recebe evento duplicado e dispara uma run.
- restart recupera monitor state e run lease.
- natural-language monitor não publica automaticamente.
- timeline não duplica uma execução em níveis diferentes.
- package version publicada não pode ser editada.
- update com capability nova exige nova aprovação.
- uninstall preserva recurso editado pelo usuário.
- template não copia secret, dados ou grants do autor.
- suspensão bloqueia nova instalação e execução conforme política.
- código recusado quando runtime não está saudável.
- capability broker recusa token vencido, replay, agente/package/capability diferente.

### Threat suite da sandbox

- ler env/secret bruto;
- ler filesystem do host;
- escrever fora do tmp;
- abrir socket externo/localhost/rede privada/metadata;
- executar subprocesso;
- fork bomb/thread bomb;
- loop infinito e sleep longo;
- alocação excessiva;
- output bomb e nested JSON bomb;
- import dinâmico/proibido;
- path traversal e symlink;
- exfiltração por erro/log/output;
- replay de token do capability broker;
- artifact hash diferente.

### Frontend/E2E

- sidebar/drawer/bottom nav e redirects antigos.
- Resources global, floor, sector e agent.
- Access matrix mostra origem, deny, pendência e links.
- criar Database, dataset, schema, query e grants.
- agente autorizado usa query; outro é recusado.
- criar Flow sequencial e paralelo; dry-run e publish.
- criar Monitor visual e por linguagem natural; confirmar draft; observar state/trigger.
- Activity mostra timeline ao vivo.
- criar App/Tool/Template privado, testar, submeter, revisar e publicar.
- segundo usuário busca, lê permissões, instala e configura suas próprias conexões.
- update mostra diff e não altera automaticamente.
- Tool de código mostra bloqueio honesto sem runtime.
- 320/360/390/768/1440 sem overflow de página.
- teclado, foco, aria, reduced motion, loading, vazio, erro, retry, sem permissão e suspended.

### Regressão

- Knowledge scopes/map/access/context manifest.
- Apps oficiais/privados/grants/connections.
- Tools HTTP e tool execution hardening.
- data history, market data e WebSocket.
- automations, scheduler, run recovery e execution roots.
- agent flows, sectors, floor, architect, widgets, chats e mobile parity.

Comandos mínimos antes de concluir:

```bash
npm ci
npm run build
npm run test -w backend
npm run test -w frontend
npm run lint -w frontend
npm run test:e2e -w frontend -- --project=chromium
npm run smoke
npm run secret-scan
```

Se os scripts mudarem durante a execução, reabrir os `package.json` e usar os nomes reais; não inventar resultado de comando inexistente. Registrar comando, exit code e resumo no progress/report.

---

## 14. Critérios de aceite finais

1. A UI distingue claramente Organization, Resources, Operations e Community.
2. Knowledge, Memory, Live Data e Database continuam mecanismos separados.
3. Recursos possuem owner e acesso independentes, com motivo/origem explicável.
4. A matriz Access do agente representa o backend real.
5. Apps continuam por capability/action, não acesso tudo-ou-nada.
6. Database é estruturado, tem datasets/schemas e não usa RAG.
7. Agentes acessam Database apenas por ferramentas tipadas e grants.
8. Market Data reutiliza o engine especializado.
9. Tools existentes não quebram e passam a ter runtime/versionamento coerentes.
10. Flow suporta sequência, paralelo, join, condição e versões sem engine paralela.
11. Monitor persiste estado e detecta transição, não apenas valor atual.
12. Monitor determinístico não gasta token por evento.
13. Activity mostra o escritório trabalhando com correlação real.
14. Usuários criam Apps, Tools e Templates privados.
15. Usuários submetem itens para Community com lifecycle de review.
16. Versões publicadas são imutáveis, hashadas e pinadas nas instalações.
17. Instalação mostra permissões, domínios, runtime, secrets e riscos antes de confirmar.
18. Update com novas capabilities exige aprovação.
19. Template usa diff/apply e não copia dados ou credenciais.
20. Código de usuário nunca roda no backend principal.
21. Código só roda em sandbox saudável, isolada, limitada e fail-closed.
22. LLM não recebe secret bruto.
23. Capability broker revalida autorização imediatamente antes de cada efeito.
24. Community App não injeta UI/script/import arbitrário.
25. Nenhuma conta infere recurso, pacote privado, dado, nome, ID ou contagem de outra.
26. Migrações são idempotentes, retomáveis e possuem rollback documentado.
27. Rotas e dados legados permanecem compatíveis durante a transição.
28. Mobile funciona em 320 px, teclado/foco/acessibilidade estão cobertos.
29. Métricas e Activity não inventam dados nem duplicam execuções.
30. Documentação e progress report permitem continuar sem reler toda a implementação.

---

## 15. Fora do escopo desta entrega

- pagamento, comissão, assinatura ou repasse financeiro no Marketplace;
- execução irrestrita de pacote npm/pip escolhido pelo autor;
- internet geral dentro da sandbox;
- UI React/HTML/JavaScript fornecida pela comunidade;
- SQL/Mongo query livre enviado por agente;
- credencial dentro de template, manifest, código, input ou output;
- múltiplos prédios por conta se o produto atual ainda assume um;
- apagar sistemas legados antes da migração comprovada;
- transformar monitor em agente permanente;
- transformar indicador determinístico em agente;
- usar LLM para cada tick/evento;
- auto-publicação sem review;
- auto-update com mudança de permissão;
- afirmar que Docker simples, scanner ou review isoladamente tornam código confiável.

---

## 16. Restrições de execução

- Trabalhar apenas em `development`.
- Não fazer merge, deploy, mudança de DNS/Coolify ou ação externa de produção.
- Não ler, imprimir, copiar ou commitar `.env` real.
- Não trocar `ENCRYPTION_KEY`.
- Não apagar dados existentes.
- Não rodar migração destrutiva em produção.
- Não expor segredo em log, fixture, screenshot ou relatório.
- Não fazer bypass de policy por endpoint legado, playground, direct call, worker ou retry.
- Não criar mock permanente em tela de produção.
- Não marcar fase concluída se existe somente type/interface/placeholder.
- Não habilitar `CODE_TOOLS_ENABLED` por padrão.
- Não publicar código comunitário antes de todos os gates da Fase 9.
- Não esconder decisão de produto/segurança relevante em default silencioso.
- Não reduzir testes existentes para fazer a suíte passar.

---

## 17. Entrega esperada do executor

Ao finalizar, produzir `OFFICE_PLATFORM_RESOURCE_COMMUNITY_REPORT.md` com:

- resumo por fase e commits;
- arquitetura final e ADRs;
- coleções, índices, contratos e APIs;
- matriz canônica versus projeção;
- estratégia e resultado das migrações com contagens seguras;
- compatibilidade e redirects preservados;
- flags e variáveis adicionadas, sem valores secretos;
- provider/runtime de sandbox usado e evidência dos controles;
- threat suite e resultados;
- comandos de build/test/E2E e exit codes;
- screenshots/checklist desktop/mobile somente com dados de teste;
- métricas antes/depois de autorização, monitor e runtime;
- riscos restantes e itens fora do escopo;
- procedimento de rollback por fase;
- checklist manual completo de criação → teste → submissão → review → publicação → instalação → grant → execução → update → suspensão → uninstall.

Atualizar também README, `.env.example`, compose de desenvolvimento/teste e runbooks. O relatório não substitui testes nem progress file.

O objetivo só está concluído quando a plataforma consegue demonstrar, com duas contas isoladas e dados de teste:

1. um autor cria e publica uma extensão declarativa;
2. outro usuário instala e concede somente capacidades escolhidas;
3. um agente usa uma Database e uma Tool dentro de um Flow;
4. um Monitor detecta uma transição e dispara o Flow uma única vez;
5. Activity mostra a execução completa;
6. revogar o grant bloqueia a próxima execução antes de qualquer efeito;
7. uma Tool de código maliciosa é bloqueada pela sandbox/threat suite;
8. nenhum secret, dado privado ou conteúdo de outra conta aparece em API, log, UI ou pacote.
