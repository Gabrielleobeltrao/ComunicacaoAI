# ComunicacaoAI — Plano integrado de Apps, Agentes, Setores e Andares

> Repositório-alvo: `Gabrielleobeltrao/ComunicacaoAI`
>
> Branch de trabalho: `development`
>
> Referência analisada: `0fddb735e749f6d3185a83a0ae86f077b3f75146`
>
> Este plano organiza o que já existe. Não recrie o runtime de agentes, o executor de ferramentas, o motor de rotinas, os webhooks ou o sistema de conexões do zero.

## 1. Objetivo

Transformar as integrações atuais em um sistema simples e coerente no qual:

1. o usuário encontra um **App** em um catálogo;
2. conecta uma conta ou informa suas próprias credenciais uma única vez;
3. o App passa a disponibilizar uma ou várias **Ações** prontas;
4. o usuário escolhe quais agentes podem usar quais ações;
5. o agente recebe somente as ações autorizadas e realmente disponíveis;
6. Custom Tools continuam existindo como opção avançada;
7. a arquitetura fica preparada para Apps declarativos criados pela comunidade, sem permitir código arbitrário dentro do servidor.
8. a página do agente ganha workspace completo e exclusão protegida em Avançado;
9. o fluxo visual do setor passa a ser vertical e sua aba Execuções mostra telemetria real do trabalho coletivo;
10. o andar pode ser apenas organizacional ou coordenado por um agente, sem criar um runtime paralelo;
11. agentes sem setor continuam válidos e podem atuar como coordenadores ou especialistas independentes;
12. setores podem proteger seus agentes internos e exigir que chamadas externas passem pelo fluxo completo;
13. o prédio controla se e em qual direção seus andares podem colaborar;
14. o seletor de andar e as configurações do prédio ficam claros e separados no topo do sidebar;
15. execuções podem ser analisadas do prédio ao agente com métricas comparáveis e identificação de gargalos.
16. Chat Web e WhatsApp tornam-se Apps nativos ativáveis, com páginas próprias, sem ocupar o sidebar de quem não os utiliza;
17. Apps ativos podem ser fixados como um único item expansível que revela todas as suas páginas, sem confundir ativação, conexão, permissão do agente e preferência de navegação.
18. o escritório mostra uma segunda camada de animação por balões operacionais, refletindo a execução real sem interferir no movimento, socialização ou pose de telefone dos personagens.

O sistema deve continuar genérico. Não criar lógica específica para trading, CRM, e-commerce ou qualquer nicho. Uma corretora, uma loja, um calendário ou um sistema interno são apenas Apps que oferecem ações e, futuramente, fontes de eventos.

## 2. Linguagem do produto

Usar estes termos de forma consistente:

- **App:** pacote de integração, por exemplo Google, Slack, Stripe ou um App privado criado pelo usuário.
- **Conexão:** conta/credencial daquele App pertencente ao usuário. Um App pode permitir mais de uma conexão.
- **Ação:** capacidade individual que o App oferece ao agente. No runtime, uma ação é resolvida como `ResolvedTool`.
- **Ferramenta personalizada:** ação HTTP avançada criada manualmente pelo usuário.
- **Página do App:** superfície interna segura oferecida por um App, como Conversas, Widgets ou Números conectados.
- **Fixar no sidebar:** preferência visual individual que cria acesso rápido a páginas de um App já ativo. Fixar nunca concede ações ao agente.
- **Skill:** não usar como sinônimo de App. Reservar “Skill” para um futuro pacote de instruções, conhecimento ou playbook. Skill não deve guardar credencial.

Nome recomendado no sidebar: **Apps**. Dentro da página, usar as abas **Catálogo**, **Conectados** e **Personalizados**. “Conexões” é um conceito apresentado dentro de cada App.

## 3. Diagnóstico do estado atual

Preservar e evoluir estas bases já implementadas:

- `BUILTIN_APPS` já funciona como catálogo interno.
- Google OAuth já guarda tokens criptografados na collection `integrations`.
- Google Agenda e Google Sheets já geram várias ferramentas prontas.
- Slack, Mercado Pago, RD Station, HubSpot, Stripe e Nuvemshop já têm adapters nativos.
- E-mail e Telegram já usam `connections` com configuração criptografada.
- Custom Tools já são reutilizáveis, owner-scoped, têm schema, teste, SSRF protection, domínio permitido, limite, segredo criptografado e autorização autônoma.
- `resolveAgentTools` já reúne ferramentas legadas, Custom Tools, Apps nativos e delegação.
- O agente já possui `toolIds` e `builtinTools`.
- O agente já possui políticas e listas para delegar a agentes/setores; isso deve ser reutilizado na coordenação do andar.
- `SectorFlow` hoje cresce horizontalmente e a aba Execuções do setor contém apenas o playground.
- O andar hoje guarda missão e apresentação, mas não declara se é livre ou coordenado.
- `BuildingSwitcher` mistura avatar/letra do prédio, troca de andar, início, criação e configurações no mesmo botão/popover.
- `/executions` já é building-wide e filtra por andar/setor/agente, mas ainda não possui visão analítica completa nem rota fixa para o andar.
- `floorMetrics` mede somente alguns contadores de automações em 24h; não representa toda a execução autônoma, setores, canais ou delegações.
- `Widgets.tsx` mistura Widget Web e WhatsApp em abas; `Chats.tsx` mostra todas as conversas; `Canais` e `Conversas` ficam sempre no `NAV_V2`, mesmo quando o usuário não usa comunicação.
- canais WhatsApp já são persistidos em `widgets` com `channel: 'whatsapp'` e suas mensagens usam o armazenamento unificado de conversas; a migração deve preservar ids, histórico, filtros e webhooks existentes.

Problemas que a implementação deve resolver:

- conexão, credencial e atribuição ao agente estão misturadas;
- vários Apps guardam token/webhook no `agent.builtinTools[].config`, repetindo configuração por agente;
- essa configuração pertence à conta, não ao agente, e não deve voltar ao navegador;
- Google fica em Configurações, e-mail/Telegram em Conexões, Apps no formulário do agente e Custom Tools em Ferramentas;
- o usuário pode ver “Conectar” dentro do agente antes de instalar o App na conta;
- não existe um manifesto versionado e seguro para Apps declarativos da comunidade;
- o catálogo não diferencia claramente leitura, escrita e ação sensível.

## 4. Princípios obrigatórios

1. Credencial é configurada na conta, nunca no agente.
2. Agente guarda somente referências e configuração não secreta de recurso.
3. Desconectar um App remove imediatamente suas ações do runtime de todos os agentes.
4. Atribuir uma ação ao agente é uma permissão; não atribuído significa inacessível.
5. Ações de escrita começam sem autorização autônoma.
6. Apps da comunidade são declarativos. Nunca executar JavaScript, shell, pacote npm ou código enviado por usuário dentro da API/worker.
7. Toda ação HTTP passa por `runResolvedTool` e `executeToolCall`; não criar executor paralelo.
8. Owner isolation, allowlist de domínio, proteção SSRF, timeout, limite de resposta, limite de chamadas, redaction e auditoria são obrigatórios.
9. Nenhum segredo pode aparecer em resposta da API, agente, prompt, log, evento, preview ou frontend.
10. Migração deve ser aditiva, idempotente e reversível durante a transição.
11. Ativar/conectar um App, fixar o App no sidebar e conceder ações a um agente são operações independentes.
12. Apps da comunidade não podem injetar componentes React, rotas, HTML ou JavaScript arbitrário no dashboard.
13. Estado físico do personagem e estado operacional do balão são fontes independentes; nenhum balão pode mudar caminho, pose, direção, cadeira ou sprite.

## 5. Modelo de domínio

### 5.1 AppDefinition

Criar um contrato comum de manifesto:

```ts
type AppSource = 'system' | 'private' | 'community'
type AppAuthKind = 'none' | 'oauth2' | 'api_key' | 'bearer' | 'basic' | 'webhook'
type ActionRisk = 'read' | 'write' | 'high_risk'

interface AppDefinition {
  key: string
  version: string
  source: AppSource
  name: string
  description: string
  icon?: string
  categories: string[]
  documentationUrl?: string
  auth: AppAuthDefinition
  allowedDomains: string[]
  supportsMultipleConnections: boolean
  actions: AppActionDefinition[]
  surfaces?: AppSurfaceDefinition[]
  sidebar?: {
    pinnable: boolean
    defaultSurfaceKey: string
  }
  status: 'draft' | 'review' | 'published' | 'suspended'
}

type AppSurfaceKind = 'native' | 'declarative'
type AppSurfaceScope = 'account' | 'building' | 'floor'

interface AppSurfaceDefinition {
  key: string
  label: string
  description: string
  icon?: string
  kind: AppSurfaceKind
  scope: AppSurfaceScope
  routeSegment: string
  requiredActionKeys?: string[]
}
```

Cada ação deve declarar nome estável, descrição que ensina quando usar, JSON Schema de entrada, método/endpoint ou adapter nativo, risco, scopes, timeout e limite de resposta. Nome oferecido ao modelo deve ser namespaced e previsível, evitando colisões.

Apps `system` podem usar adapters TypeScript versionados no repositório. Apps `private/community` só podem usar ações HTTP declarativas validadas.

`routeSegment` é um identificador interno validado, não URL livre. Superfícies `native` são resolvidas por um registry estático compilado no frontend. Apps privados/comunitários não podem apontar para módulos, imports ou scripts; nesta rodada só podem declarar superfície se existir renderer declarativo seguro e versionado. Caso contrário, suas ações funcionam para agentes, mas `sidebar.pinnable` deve ser `false`. `defaultSurfaceKey` precisa existir em `surfaces` e é a rota aberta ao clicar no nome do App.

### 5.2 AppInstallation/Connection

Usar a collection existente `connections` como base evolutiva, sem criar uma segunda verdade concorrente. Torná-la capaz de representar e-mail, Telegram, Google e demais Apps:

```ts
interface AppInstallation {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId | null
  appKey: string
  appVersion: string
  name: string
  status: 'connected' | 'error' | 'revoked' | 'needs_reauth'
  encryptedConfig: string
  publicMetadata: Record<string, string>
  grantedScopes: string[]
  createdAt: Date
  updatedAt: Date
  lastTestedAt?: Date | null
}
```

Manter compatibilidade com `provider` enquanto as rotinas antigas ainda referenciam conexões de entrega. Não quebrar `connectionId` existente. A migração pode preencher `appKey` a partir de `provider` e o serviço deve aceitar documentos antigos até a conclusão.

### 5.3 Permissão do agente

Adicionar um binding explícito:

```ts
interface AgentAppGrant {
  installationId: string
  actionKeys: string[]
  resourceConfig: Record<string, string>
  autonomousWriteActionKeys: string[]
}
```

`resourceConfig` guarda apenas valores não secretos, como `calendarId`, `spreadsheetId`, nome da aba ou carteira selecionada. Credenciais ficam somente na instalação.

Manter `toolIds` para Custom Tools. `builtinTools` passa a ser legado read-only durante a migração e deixa de receber novos segredos.

### 5.4 Forma de trabalho do andar

O andar continua sendo uma área organizacional; quem raciocina e executa é sempre um agente. Adicionar somente dois modos:

```ts
type FloorWorkMode = 'organization' | 'coordinated'

interface FloorWorkConfig {
  workMode: FloorWorkMode
  coordinatorAgentId: ObjectId | null
  instruction: string
}
```

- `organization`: **Livre / somente organizar**. Agentes e setores continuam funcionando pelos próprios canais, rotinas, gatilhos e chamadas.
- `coordinated`: **Coordenado por um agente**. Um gerente/secretário do andar funciona como porta de entrada e decide quais agentes ou setores autorizados consultar.

Não copiar tools, Apps, gatilhos ou listas de permissão para o documento do andar. `coordinatorAgentId` apenas aponta para um agente existente; ferramentas, conexões, contratos e gatilhos permanecem no agente. A política de delegação do agente continua sendo a fonte de verdade dos alvos que ele pode chamar.

Evoluir `DelegationPolicy` de forma compatível para aceitar `floor`, além de `none`, `selected` e `all`:

- `floor`: pode descobrir/chamar somente agentes e setores executáveis do mesmo andar;
- `selected`: usa as listas explícitas já existentes;
- `all`: mantém o comportamento atual de todo o prédio;
- `none`: não delega.

Documentos antigos de andar recebem `workMode: 'organization'`, `coordinatorAgentId: null` e `instruction: ''` no read/default e na migração idempotente.

### 5.5 Política de entrada do setor

Adicionar uma fronteira explícita para impedir que outro agente contorne a orquestração ou entre no meio de um pipeline:

```ts
type SectorEntryPolicy = 'sector_only' | 'selected_members' | 'open_members'

interface SectorAccessConfig {
  entryPolicy: SectorEntryPolicy
  exposedAgentIds: ObjectId[]
}
```

- `sector_only` — **Sempre pelo setor / Núcleo fechado**: chamadas externas enxergam e chamam somente o setor. Coordenador, membros e etapas não podem ser chamados diretamente.
- `selected_members` — **Setor + agentes selecionados**: o setor completo continua disponível e somente os agentes de `exposedAgentIds` podem receber chamada direta.
- `open_members` — **Setor + qualquer agente**: mantém o comportamento flexível atual, sujeito às permissões normais do agente.

`sector_only` só é válido para setores executáveis (`orchestrated` ou `pipeline`). Setores `organization` não executam como unidade e devem usar `selected_members` ou `open_members`. Considerar protegidos todos os agentes envolvidos como membro, coordenador ou etapa, não apenas `members`.

Para compatibilidade, setores existentes recebem `open_members`. Novos setores orquestrados/pipeline sugerem `sector_only`; novos setores somente organizacionais usam `open_members`. Não alterar silenciosamente o comportamento de setores existentes.

### 5.6 Comunicação entre andares

A comunicação entre andares pertence ao prédio, pois define a rede de colaboração entre suas áreas:

```ts
type FloorCommunicationMode = 'isolated' | 'all' | 'selected'
type FloorLinkDirection = 'one_way' | 'both'

interface FloorCommunicationConfig {
  mode: FloorCommunicationMode
  links: Array<{
    fromFloorId: ObjectId
    toFloorId: ObjectId
    direction: FloorLinkDirection
  }>
}
```

- `isolated` — **Andares isolados**: nenhuma chamada cruza andares.
- `all` — **Todos colaboram**: qualquer andar ativo do prédio pode se comunicar, ainda sujeito às permissões de agentes e setores.
- `selected` — **Conexões escolhidas**: somente links explícitos permitem comunicação; cada link pode ser de mão única ou nos dois sentidos.

O link apenas abre o caminho entre andares. Ele não concede sozinho acesso a agente/setor, não adiciona tools e não ignora `delegationPolicy`, `callerPolicy` ou `SectorEntryPolicy`.

Para preservar comportamento, prédios existentes com mais de um andar recebem `mode: 'all'`. Novos prédios começam em `isolated`; ao criar o segundo andar, perguntar se ele ficará isolado ou conectado. Links usam ids owner-scoped do mesmo prédio, não podem apontar para o próprio andar e não podem se repetir.

### 5.7 Raiz de execução e hierarquia de métricas

Para que prédio, andar, setor e agente mostrem números conciliáveis, toda tarefa real deve possuir uma única raiz:

```ts
interface ExecutionRoot {
  _id: ObjectId
  executionKey: string
  ownerId: string
  buildingId: ObjectId
  originFloorId: ObjectId | null
  source: 'schedule' | 'webhook' | 'channel' | 'manual' | 'delegation'
  sourceRefId: ObjectId | null
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  errorKind: string | null
}
```

Adicionar `rootExecutionId` aos registros operacionais existentes (`automation_runs`, `agent_execution_events`, execuções de setor e delegações) sem duplicar o payload. Uma raiz representa o pedido completo; agentes/setores são participações filhas. Tokens vêm da soma idempotente das inferências folha, nunca da soma simultânea de parent e children.

Testes/playgrounds são marcados `environment: 'test'` e ficam fora das métricas de produção por padrão. Histórico legado só é correlacionado quando existir evidência determinística; o restante mantém a indicação de telemetria parcial.

### 5.8 Páginas e preferências de navegação dos Apps

Guardar pins como preferência do usuário, separada da instalação compartilhada e das permissões do agente:

```ts
interface UserNavigationPreferences {
  ownerId: string
  userId: string
  pinnedApps: Array<{
    appKey: string
    order: number
  }>
}
```

- um App pode estar ativo sem estar fixado e continuar acessível em `/apps`;
- só App ativo, `sidebar.pinnable: true` e com ao menos uma superfície navegável pode ser fixado;
- existe um único pin por `appKey`, mesmo quando o App possui múltiplas conexões;
- um App fixado vira item pai recolhível no sidebar e revela automaticamente todas as superfícies disponíveis do manifesto; não existe pin nem seleção individual de subpágina;
- usar um único grupo **Apps fixados** no sidebar, não criar sidebars independentes nem permitir que Apps substituam a navegação principal;
- limitar inicialmente a 6 Apps fixados, permitir ordenar e impedir duplicatas;
- no mobile, mostrar os mesmos pins no drawer; eles não podem expulsar itens essenciais da navegação inferior;
- se todas as conexões estiverem em `needs_reauth`, manter o pin com badge/CTA de reconexão; App revogado ou desativado deixa de aparecer;
- fixar/desafixar nunca instala, conecta, concede scope, habilita ação ou altera grants de agentes;
- remover/desativar uma instalação limpa pins inválidos de forma idempotente, sem apagar dados operacionais.

Criar um `appSurfaceRegistry` estático no frontend para mapear `(appKey, surfaceKey)` de Apps nativos a componentes conhecidos. Toda rota deve passar por guard de ownership, status da instalação e requisitos da superfície. Acesso por URL direta não pode contornar esses checks.

### 5.9 Duas camadas independentes de estado visual do agente

Preservar a simulação física já implementada. Ela continua sendo puramente visual/efêmera:

```ts
type AgentMotionState =
  | 'seated'
  | 'standing-up'
  | 'walking'
  | 'pausing'
  | 'waiting'
  | 'returning'
  | 'sitting-down'
  | 'socializing'

type AgentPhysicalPose = 'normal' | 'phone'
```

`phone` representa **Em ligação** e deve permanecer uma pose física independente de `motion`: o personagem pode estar sentado, parado ou caminhando com telefone conforme os sprites suportados. Não converter telefone em balão. Não remover nem renomear os estados atuais do simulador; adaptar `AgentVisualMode` para o nome/contrato acima somente se isso não quebrar assets e testes.

Adicionar uma segunda camada, operacional e oriunda do backend:

```ts
type AgentBubbleState =
  | 'queued'
  | 'thinking'
  | 'researching'
  | 'reading_knowledge'
  | 'using_tool'
  | 'delegating_agent'
  | 'delegating_sector'
  | 'waiting_external'
  | 'waiting_input'
  | 'responding'
  | 'generating_output'
  | 'validating_output'
  | 'delivering'
  | 'retrying'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'canceled'

interface AgentLiveVisualState {
  agentId: string
  floorId: string
  rootExecutionId: string
  state: AgentBubbleState
  safeDetail?: { appKey?: string; actionLabel?: string; targetType?: 'agent' | 'sector' | 'channel' }
  startedAt: string
  updatedAt: string
  expiresAt: string
}
```

Sem execução real não existe `idle` no balão: simplesmente não renderizar balão. Agente com rotina agendada ou gatilho armado, mas sem run em andamento, também fica sem balão. O estado decorativo retornado hoje por `statusFor(id)` não pode alimentar esta camada.

Catálogo visual obrigatório:

> Os nomes de ícones abaixo descrevem a semântica. A fonte visual de verdade é o projeto já existente no **Cloud/Claude Design**, conforme a seção 7.10. Não redesenhar nem substituir os assets aprovados por emoji ou biblioteca genérica.

| Estado | Significado | Ícone sugerido | Comportamento |
| --- | --- | --- | --- |
| `queued` | execução criada, aguardando worker | relógio | ícone + 3 pontos |
| `thinking` | LLM raciocinando/planejando | cérebro | ícone + 3 pontos |
| `researching` | busca externa, RSS, HTTP ou pesquisa | lupa | ícone + 3 pontos |
| `reading_knowledge` | consultando memória/RAG do agente ou setor | livro/banco | ícone + 3 pontos |
| `using_tool` | executando uma ação de App/Custom Tool | ferramenta/engrenagem | ícone do App allowlisted ou fallback + 3 pontos |
| `delegating_agent` | chamando outro agente | pessoa com seta | ícone + 3 pontos |
| `delegating_sector` | chamando o fluxo completo de um setor | grupo | ícone + 3 pontos |
| `waiting_external` | aguardando resposta de API/provider | ampulheta | ícone + 3 pontos lentos |
| `waiting_input` | precisa de dado, confirmação ou aprovação humana | interrogação/mão | ícone estático com pulso suave |
| `responding` | produzindo resposta para chat/canal | balão de mensagem | ícone + 3 pontos |
| `generating_output` | montando documento, JSON ou artefato final | arquivo/lápis | ícone + 3 pontos |
| `validating_output` | validando schema, grounding ou guardrail | escudo com check | ícone + 3 pontos |
| `delivering` | enviando resultado por e-mail, Telegram, WhatsApp etc. | enviar | ícone + 3 pontos |
| `retrying` | repetindo etapa após falha recuperável | seta circular | ícone + 3 pontos |
| `completed` | execução concluída | check | somente ícone, 2–3 segundos e fade |
| `blocked` | impedido por permissão, orçamento, política ou dado ausente | cadeado | ícone estático até resolver/expirar |
| `failed` | erro final da execução | alerta | somente ícone, 4–6 segundos e fade |
| `canceled` | execução cancelada | X | somente ícone, 2–3 segundos e fade |

Não criar estados permanentes para “monitorando”, “aguardando agenda” ou “aguardando webhook”: isso poluiria o mapa apesar de não existir trabalho ativo. Quando o gatilho disparar, a execução começa em `queued`.

## 6. Catálogo nativo inicial

Converter o catálogo existente sem retirar funcionalidades:

- **Google** como um único App conectado por OAuth, oferecendo ações de Agenda e Sheets. Permitir escolher ações individualmente e configurar agenda/planilha por agente.
- **Slack**, **Mercado Pago**, **RD Station**, **HubSpot**, **Stripe** e **Nuvemshop** como Apps conectados uma vez na conta.
- **E-mail** e **Telegram** aparecem em Apps/Conectados, mas continuam compatíveis com o fluxo de entregas das rotinas.
- **Chat Web** (`web_chat`) passa a ser App nativo sem credencial externa. Ativar cria instalação idempotente e libera as páginas Visão geral, Widgets e Conversas Web.
- **WhatsApp** (`whatsapp`) passa a ser App nativo com múltiplas conexões/números. Conectar preserva providers, webhooks, roteamento e histórico existentes e libera Visão geral, Números e Conversas WhatsApp.
- **Ferramenta HTTP personalizada** continua no editor avançado e pode futuramente ser agrupada em um App privado.

Cada App precisa mostrar antes da conexão:

- quais dados acessa;
- quais ações oferece;
- quais ações leem ou alteram dados;
- domínios externos acessados;
- credenciais/scopes necessários;
- se suporta uso autônomo;
- documentação oficial.
- páginas internas que o App libera e se o App completo pode ser fixado no sidebar;
- como os dados e históricos são armazenados e o impacto exato de desconectar/desativar;
- custos que pertencem ao provedor externo, sem insinuar que a plataforma controla a cobrança dele.

## 7. Fluxo de UX

### 7.1 Página Apps

Criar rota canônica `/apps` e item no sidebar. Manter `/tools` funcionando com redirect para `/apps?tab=custom`, preservando favoritos.

**Catálogo**:

- busca e filtros por categoria;
- cards com ícone, nome, descrição, origem (`Sistema`, `Privado`, futuramente `Comunidade`), quantidade de ações e estado;
- botão `Conectar` ou `Ver conexão`;
- detalhe do App com ações, permissões, risco e guia.

Abrir o detalhe em modal/drawer responsivo antes de ativar ou conectar. Ele deve mostrar, em blocos curtos: Sobre, o que será liberado, ações, páginas, permissões/scopes, dados acessados/armazenados, domínios, requisitos, passos de configuração, status/versão/origem, política de desconexão e eventual custo do provedor. Diferenciar CTA `Ativar` para App sem autenticação de `Conectar` para App com credencial. Após sucesso, oferecer um único toggle `Fixar App no sidebar`; ao fixar, todas as páginas do App ficam no submenu automaticamente.

**Conectados**:

- uma linha/card por instalação, inclusive múltiplas contas do mesmo App;
- nome amigável, conta mascarada, status, scopes, quantidade de agentes usando;
- testar, reconectar, renomear e desconectar;
- desconexão deve avisar quais agentes/rotinas serão afetados;
- segredo nunca é reexibido; valor omitido mantém o atual.

**Personalizados**:

- incorporar a página atual de Custom Tools;
- criar, editar, duplicar, testar, habilitar/desabilitar e excluir;
- opção `Agrupar como App privado` ou criar um App privado com várias ações HTTP;
- importar/exportar manifesto sem credenciais.

Configurações deve remover o card isolado do Google e substituí-lo por um link para Apps. Chaves de LLM continuam em Configurações porque são infraestrutura da IA, não ações de agentes.

### 7.2 Página do agente

Em `Como trabalha`, substituir os editores separados por uma seção **Apps e ferramentas**:

- mostrar somente Apps já conectados na conta;
- selecionar a conexão correta quando houver várias;
- escolher ações individualmente;
- configurar recursos não secretos por agente;
- mostrar badge `Leitura`, `Escrita` ou `Alto risco`;
- exigir confirmação explícita para permitir ação de escrita autônoma;
- mostrar Custom Tools em subseção separada;
- se não houver Apps, CTA `Conectar um App` leva a `/apps`;
- nunca pedir token/API key dentro do agente.

O formulário de contratação não deve exibir o catálogo completo nem solicitar credenciais. Ele pode apenas sugerir Apps necessários pelo preset e concluir a contratação com pendência clara: `Conecte/atribua o App X`.

### 7.3 Layout da página do agente e Zona de perigo

Reorganizar `frontend/src/pages/AgentDetail.tsx` para que o workspace com as abas **Visão geral**, **Como trabalha**, **Fluxos**, **Atividade** e **Avançado** ocupe toda a largura útil do conteúdo. Hoje esse card está preso à coluna direita do grid `lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]`, o que comprime e corta formulários, fluxos e informações longas.

Implementação obrigatória:

- manter perfil, colegas, setor, uso e métricas como resumo superior responsivo;
- colocar o card das abas em uma nova linha com `grid-column: 1 / -1` (ou estrutura equivalente), abaixo do resumo, usando `width: 100%`, `min-width: 0` e sem `max-width` artificial;
- não usar `100vw` nem deslocamentos negativos, pois isso criaria rolagem horizontal fora do `AppLayout`;
- manter exatamente a mesma largura do painel para todas as abas e impedir saltos de layout na troca;
- permitir scroll horizontal somente na barra de abas quando necessário no mobile; o conteúdo da aba não pode ficar escondido pelo `overflow: hidden` do card;
- campos, grids, tabelas, URLs, JSON, schemas e nomes longos devem quebrar linha ou ter scroll interno localizado, sem cortar a tela inteira;
- em tablet/mobile, empilhar resumo, métricas e workspace em uma coluna, com todos os controles acessíveis por toque e sem perda funcional;
- preservar rotas, deep links, estado das abas, carregamento, formulários e comportamento existente.

Mover `DangerZone` de **Visão geral** para **Avançado**, depois de todo o conteúdo de configuração avançada, como o último bloco da página. Ela deve ser montada somente quando `active === 'avancado'`; remover a renderização e qualquer duplicata nas demais abas.

Proteções obrigatórias para exclusão:

- separação visual clara, título e explicação das consequências;
- botão destrutivo não pode ser a ação primária nem receber foco automático;
- abrir confirmação explícita exibindo o nome do agente e exigir digitação exata do nome antes de habilitar a exclusão;
- cancelar deve ser a opção segura/padrão e fechar sem efeito;
- impedir duplo envio enquanto a requisição estiver em andamento;
- manter o usuário na página e mostrar erro compreensível se a API falhar;
- redirecionar para a lista correta do andar somente após sucesso;
- diálogo acessível por teclado, com foco controlado, rótulos e retorno de foco ao fechar.

### 7.4 Página do setor: fluxo vertical e execuções reais

#### Fluxo de cima para baixo

Alterar `frontend/src/components/SectorFlow.tsx`: o fluxo que hoje cresce da esquerda para a direita com setas `→` e `overflowX: auto` deve passar a crescer **de cima para baixo**, preservando os mesmos blocos, textos, links, tons e ordem lógica.

- usar coluna vertical centralizada ou alinhada ao container, com `width: 100%` e `min-width: 0`;
- trocar os conectores por setas `↓` acessíveis apenas visualmente;
- remover a rolagem horizontal estrutural do fluxo;
- pipeline: `Entrada ↓ Etapa 1 ↓ Etapa 2 ↓ ... ↓ Saída`;
- orquestrado: `Entrada ↓ Coordenador ↓ grupo de especialistas ↓ Saída`; deixar visualmente claro que os especialistas são acionados conforme necessidade e não fingir que formam uma sequência obrigatória;
- organização: manter apenas a lista vertical de agentes, sem inventar Entrada/Saída para um setor que não executa;
- manter cada bloco clicável para abrir o agente e preservar estados de agente removido/etapa vazia;
- em mobile, os blocos usam a largura disponível; em desktop, podem ter largura máxima legível, sem desperdiçar a tela;
- nomes, descrições e condições longas quebram linha e nunca causam overflow global.

#### Aba Execuções do setor

A aba **Execuções** hoje contém apenas `SectorPlayground`. Transformá-la em uma visão operacional do setor, sem remover o teste. Organizar em três áreas claras: **Desempenho**, **Histórico** e **Testar setor**. O playground deve ficar no final, identificado como teste, e seus envios não entram nas métricas de produção.

No topo, adicionar período `7 dias`, `30 dias` e `Todo o período`, usando o mesmo padrão visual da página do agente. Mostrar somente métricas derivadas de telemetria real:

- execuções do setor, contando cada fluxo completo uma vez;
- execuções em andamento, concluídas, falhas e canceladas;
- taxa de sucesso;
- tokens totais e média de tokens por execução;
- duração média ponta a ponta do fluxo;
- tempo ativo somado dos agentes, com rótulo diferente da duração do fluxo;
- quantidade média de agentes/etapas percorridos por execução.

Adicionar detalhamento **Por agente/etapa** com nome, papel ou etapa, quantidade de participações, sucesso, tokens, tempo ativo e duração média. Um agente chamado duas vezes na mesma execução pode ter duas participações, mas a execução do setor continua contando uma vez.

Adicionar histórico paginado, do mais recente para o mais antigo, com filtros por período, status, agente/etapa e origem. Cada linha mostra horário, status, origem/gatilho, duração total, tokens totais e agentes percorridos. Ao expandir/abrir uma execução, mostrar uma timeline vertical na ordem real:

- agente/etapa, horário, duração, status, tentativas, tokens e quantidade de tools concluídas;
- falha sanitizada e ponto em que o fluxo parou ou continuou;
- distinção entre coordenador, especialista e etapa de pipeline;
- link para o agente correspondente;
- nunca exibir prompt, segredo, payload, resposta completa ou argumento sensível.

Estados obrigatórios: loading estável, vazio honesto, erro com tentar novamente, execução ainda em andamento, telemetria parcial e membro removido. Não fabricar zeros históricos: quando não houver dados antigos suficientes, informar `Telemetria disponível desde ...`.

### 7.5 Página do andar: Como trabalha

Na `FloorView`, adicionar uma seção visível e de largura total **Como este andar trabalha**, sem criar novo item no sidebar. Não esconder toda a decisão dentro do diálogo pequeno de configurações.

No modo **Livre / somente organizar**, explicar: `Este andar organiza visualmente agentes e setores. Cada um trabalha pelos próprios gatilhos e chamadas.`

No modo **Coordenado por um agente**:

- permitir escolher como coordenador qualquer agente ativo daquele andar, esteja ele sem setor ou dentro de um setor;
- sugerir presets Gerente/Orquestrador e Secretário, mas não bloquear outros presets;
- oferecer política `Tudo deste andar` (`delegationPolicy: floor`) ou `Escolher agentes e setores` (`selected`);
- no modo selecionado, reutilizar `callableAgentIds` e `callableSectorIds` do agente, sem lista paralela no andar;
- listar somente setores realmente executáveis para chamada; setores `organization` aparecem apenas como organização e não podem ser escolhidos como trabalho;
- permitir agente sem setor como alvo ou coordenador;
- mostrar missão/instrução do andar separada do objetivo individual do coordenador;
- exibir readiness: sem coordenador, coordenador removido/movido/arquivado, sem alvos, alvo pendente e possível ciclo;
- mostrar CTA para abrir o agente coordenador nas abas Como trabalha/Fluxos;
- identificar o coordenador no mapa e nos resumos com badge `Coordena o andar`, sem duplicar o personagem;
- mostrar preview vertical: `Entrada ↓ Coordenador ↓ agentes/setores disponíveis ↓ Resposta`, sem sugerir que todos serão chamados;
- permitir voltar para Livre sem apagar o agente nem suas configurações; apenas remover o papel de coordenador do andar.

Ao escolher um coordenador que participa de um setor que o chamaria novamente como coordenador ou etapa, detectar o ciclo antes de salvar/ativar e explicar qual vínculo precisa ser alterado.

Gatilhos continuam no agente coordenador: para executar às 7h, por webhook ou por canal, o usuário configura isso no agente. O andar não ganha cron, webhook, tools, credenciais ou consumo próprio. Canais/rotinas que quiserem usar a coordenação devem apontar para o agente coordenador.

Não adicionar `pipeline` ao andar. Uma sequência fixa entre agentes pertence ao setor pipeline. Uma futura sequência entre setores deverá ser tratada como workflow explícito, não como novo modo implícito do andar nesta rodada.

### 7.6 Acesso do setor e comunicação entre andares

Na aba **Equipe e fluxo** do setor, adicionar o bloco **Como este setor pode ser chamado** com três opções descritas em linguagem simples. Mostrar um preview do que agentes externos descobrirão:

- Núcleo fechado: somente o card do setor;
- Selecionado: setor + agentes expostos;
- Aberto: setor + todos os agentes envolvidos.

Ao escolher `selected_members`, exibir seletor dos membros/coordenador/etapas e uma explicação de que expor uma etapa de pipeline permite chamá-la sem executar as etapas anteriores. Em pipeline, destacar `Sempre pelo setor` como recomendado. Em setor orquestrado, explicar que chamar o setor já passa pelo coordenador. Em setor somente organizacional, desabilitar Núcleo fechado com a orientação para converter o setor em executável.

Quando uma alteração fechar o acesso de um agente atualmente referenciado por outro agente/rotina, mostrar impacto antes de salvar e manter a referência registrada como pendência — não apagar configuração alheia silenciosamente.

No pop-up **Configurações do prédio** descrito abaixo, criar a seção **Comunicação entre andares**, sem ressuscitar uma página “Prédio” confusa no sidebar. Exibir:

- Isolados, Todos colaboram ou Conexões escolhidas;
- lista visual `Origem → Destino` ou `Andar A ↔ Andar B`;
- criar, alterar direção e remover conexão;
- resumo por andar: `Pode pedir trabalho a` e `Aceita pedidos de`;
- impacto antes de isolar/remover link, listando coordenadores e referências que ficarão indisponíveis;
- estados de único andar, andar arquivado/removido, link inválido e configuração legada.

Na seção **Como este andar trabalha**, mostrar também o estado da comunicação externa e um link direto para essa configuração. Não misturar comunicação entre andares com a escolha do coordenador: são controles complementares.

### 7.7 Sidebar, seletor de andar e configurações do prédio

Refatorar `BuildingSwitcher` e os equivalentes mobile sem alterar a navegação restante:

- remover completamente o avatar/letra azul derivado do nome do prédio (hoje o `M` em “Meu prédio”);
- manter um controle de seleção de andar ocupando o espaço principal da linha;
- usar apenas o ponto/cor do andar, nome atual e chevron como informação do seletor, sem novo avatar decorativo do prédio;
- colocar imediatamente à direita um botão independente de engrenagem, com tooltip e `aria-label="Configurações do prédio"`;
- o seletor abre somente troca/criação/gestão rápida de andares; remover dele o item duplicado `Configurações do prédio`;
- a engrenagem abre o pop-up do prédio sem navegar para `/settings`;
- a engrenagem do rodapé continua sendo **Configurações da conta**, com rótulo/tooltip explícito para não confundir os dois níveis;
- no rail recolhido, manter controles reconhecíveis e clicáveis sem depender da letra removida; ao expandir, mostrar nome do prédio acima ou como texto secundário do seletor;
- preservar a seção atual ao trocar de andar usando `switchFloorPath`.

Criar `BuildingSettingsDialog` de largura confortável no desktop e bottom/full-screen sheet no mobile, com URL opcional `?buildingSettings=1` para back/reload acessíveis. Abas:

1. **Geral** — nome, descrição, idioma e timezone padrão;
2. **Andares** — criar, renomear, ordenar, arquivar/restaurar e abrir configurações específicas, respeitando proteções existentes;
3. **Comunicação** — modo isolado/total/selecionado, links direcionais e análise de impacto;

Não mover para esse pop-up configurações da conta, usuário, cobrança, chave de LLM ou Apps. Não adicionar exclusão do prédio nesta rodada. Salvar cada aba independentemente, preservar alterações não salvas ao trocar de aba mediante confirmação e mostrar erro sem fechar o diálogo.

Garantir paridade mobile: botão de configurações ao lado do acionador do andar no topbar/drawer, foco preso no diálogo, Escape/backdrop, retorno de foco, safe areas e apenas um overlay interativo por vez.

### 7.8 Execuções do prédio e do andar

Evoluir a Central atual para um componente reutilizável por escopo:

- `/executions` — **Execuções do prédio**, sem filtro fixo;
- `/floors/:floorId/executions` — **Execuções do andar**, com `floorId` fixo e sem seletor redundante de andar;
- páginas de setor e agente mantêm as visões já planejadas, usando a mesma raiz/timeline.

No sidebar, usar rótulos inequívocos:

- grupo do andar: **Execuções do andar**;
- grupo Controle: **Execuções do prédio**.

Não colocar os dois como atalhos primários idênticos no bottom navigation. Manter a visão do prédio como item global e a visão do andar acessível no drawer/área do andar. Rotas antigas `/runs` continuam redirecionando sem quebrar bookmarks.

Adicionar a aba inicial **Visão geral** antes de Agendadas, Gatilhos, Em andamento e Histórico. Períodos `7 dias`, `30 dias` e `Todo o período`, com comparação opcional ao período anterior quando houver amostra equivalente.

Métricas do prédio:

- tarefas iniciadas, concluídas, em andamento, falhas e canceladas;
- taxa de sucesso;
- tokens totais e média por tarefa;
- duração média e P95 ponta a ponta;
- espera média em fila;
- tempo ativo somado dos agentes;
- quantidade média de agentes, setores e andares envolvidos;
- transferências entre andares;
- próximas 24h e gatilhos ativos continuam visíveis como métricas operacionais separadas.

Adicionar comparação por andar com: tarefas originadas, tarefas em que participou, sucesso, falhas, tokens, tempo ativo, duração média das tarefas originadas, espera e P95. Clicar abre `/floors/:floorId/executions`.

Na visão do andar, mostrar:

- **Originadas aqui**: tarefas cuja raiz começou neste andar e sua duração ponta a ponta;
- **Participações**: tarefas de qualquer origem que utilizaram agentes/setores deste andar;
- tokens e tempo ativo consumidos no andar;
- duração média de permanência no andar, do primeiro ao último span daquele andar;
- taxa de sucesso das tarefas originadas e taxa de sucesso das participações;
- breakdown por setor e por agente independente;
- chamadas recebidas/enviadas para outros andares;
- fila, falhas, agentes/etapas lentos e execuções paradas.

Histórico e detalhe devem abrir uma timeline única do pedido completo com andares, setores, agentes e tools em ordem, oferecendo links para cada nível. Se uma execução atravessar dois andares, o prédio conta uma tarefa; cada andar conta uma participação, e somente o andar de origem conta a tarefa como originada.

Criar bloco **Possíveis gargalos** por regras determinísticas e transparentes, nunca por texto inventado por LLM:

- maior P95/duração com amostra mínima;
- maior espera em fila;
- maior taxa de falha com denominador visível;
- maior média de tokens;
- etapa/agente com maior tempo ativo;
- execução em andamento acima do limite esperado.

Cada alerta mostra período, amostra, valor, motivo e link para o filtro correspondente. Sem amostra mínima, mostrar `Dados insuficientes`, não classificar como ruim. Não estimar custo em dinheiro sem tabela real de preço/modelo registrada.

### 7.9 Chat Web, WhatsApp e Apps fixáveis com subpáginas

Remover **Canais** e **Conversas** da configuração estática de navegação. O sidebar deve montar o grupo **Apps fixados** a partir das instalações ativas, superfícies do manifesto e preferências do usuário. Se nada estiver fixado, o grupo não existe. Cada App fixado aparece uma única vez como item pai com disclosure/accordion: clicar no chevron expande e recolhe todas as subpáginas; clicar no nome abre a página padrão. App de uma página pode abrir direto sem submenu redundante. Não permitir escolher, ocultar ou fixar subpáginas individualmente. Incluir `Fixar/Desafixar App` no modal e no menu contextual do item.

Rotas nativas canônicas:

- `/apps/web-chat/overview`, `/apps/web-chat/widgets` e `/apps/web-chat/conversations`;
- `/apps/whatsapp/overview`, `/apps/whatsapp/channels` e `/apps/whatsapp/conversations`.

Manter `/widgets` e `/chats` como redirects compatíveis. Se houver filtro/canal em query string, preservá-lo. Um App ativo e não fixado continua abrindo suas páginas a partir de Apps > Conectados; o pin é só atalho.

#### App Chat Web

Reaproveitar `WidgetManager`, embeds, roteamento para agente/setor, handoff e armazenamento atuais. Não recriar um segundo sistema de chat.

- **Visão geral:** estado, widgets ativos, conversas abertas, volume, tempo de resposta e atalhos;
- **Widgets:** criação, aparência, domínio permitido, script de instalação, status e roteamento;
- **Conversas:** `ConversationsPanel` filtrado obrigatoriamente por `channel=web`, com busca, período, widget, andar, setor, agente, status e handoff;
- ativação usa `auth: none`, é idempotente e não solicita segredo;
- o modal explica que ativar libera páginas e capacidade de incorporar o widget; mostra o que ocorre ao desativar.

#### App WhatsApp

Reaproveitar `WhatsAppManager`, adapters/provider catalog, criptografia, validação de webhook, roteamento e mensagens persistidas. O histórico já existente deve continuar acessível.

- **Visão geral:** status por número/conexão, conversas abertas, falhas recentes e volume;
- **Números:** conectar provider/conta, escolher agente ou setor, testar, reconectar e pausar/desconectar;
- **Conversas:** `ConversationsPanel` filtrado obrigatoriamente por `channel=whatsapp`, com busca, período, provider, número/conexão, andar, setor, agente, status e handoff;
- o modal informa credenciais/scopes, endpoints de webhook, dados armazenados, recursos liberados, limitações e custos externos do provider;
- suportar múltiplas conexões sem misturar credenciais; a página pode filtrar por uma ou todas as conexões do owner.

Desativar/pausar deve interromper novas entradas e envios depois de confirmação, mas preservar widgets/canais, conversas e mensagens. Desconectar credencial não pode apagar conversas por efeito colateral. Exclusão permanente de dados, se mantida, fica separada na Zona de perigo do App, lista contagens afetadas, exige confirmação forte e não faz parte da ação padrão desta rodada.

Estados obrigatórios das páginas: loading, vazio, erro, sem permissão, App inativo e `needs_reauth`. Quando faltar conexão/scope, mostrar CTA para o modal correto. Em desktop e mobile, pin, unpin, expansão/recolhimento, indicador da rota ativa, foco, teclado, safe area, back e deep link devem funcionar sem overflow. Persistir apenas o pin e a ordem; o estado aberto/fechado pode ser local, mas deve abrir automaticamente quando uma de suas subpáginas estiver ativa.

### 7.10 Balões operacionais sobre os personagens

Criar `AgentActivityBubble` e usá-lo no `SimAgent` e no fallback estático `MapAgent`. O componente se ancora acima da cabeça, acompanha zoom/pan/posição e nunca participa do cálculo de colisão ou z-index de móveis. Visual de quadrinho: fundo de papel, contorno/sombra do design system, pequena cauda apontando para o agente, um ícone central e três pontos animados apenas nos estados ativos definidos na tabela.

#### Fonte visual obrigatória: Cloud/Claude Design

Os balões, ícones, sprites/frames e especificações visuais desta camada operacional **ainda não estão no repositório**. Antes de criar o componente, localizar no próprio projeto a referência/link já salvo para o Cloud/Claude Design e abrir a seção que contém os balões de atividade dos agentes. O executor já possui esse contexto; não pedir ao usuário um novo link enquanto a referência existente estiver acessível.

Procedimento obrigatório:

1. inventariar no design cada estado de `AgentBubbleState`, nome do frame/asset, variante com pontos, variante estática, dimensões, `viewBox`, espaçamentos, cauda, sombra, cores e tempos de animação;
2. antes de exportar, inspecionar os personagens, animações e cenários que estão na branch atual e identificar o padrão real de asset, frames, loader e pastas. Os balões devem usar **exatamente o mesmo formato e pipeline visual já adotados pelo projeto**, sem escolher uma tecnologia nova;
3. na referência analisada, `frontend/public/illustrations` usa arquivos SVG individuais — inclusive cada frame dos personagens — e `officeAssets` resolve esses caminhos. Portanto, enquanto esse continuar sendo o padrão no momento da execução, exportar os novos balões/ícones/frames como SVG individual, preservar a mesma convenção e integrar pelo mesmo resolver. Não rasterizar para PNG/WebP, não criar sprite sheet novo, não desenhar em CSS/canvas e não tratar CSV como asset visual;
4. seguir a organização e o naming já usados em `public/illustrations`, `officeAssets` e frames dos personagens. Criar uma subpasta clara como `frontend/public/illustrations/agent-activity/` somente se não houver pasta equivalente;
5. não fazer hotlink para o design: os arquivos finais precisam estar versionados no projeto e funcionar offline/no build de produção;
6. preservar transparência, proporção, nitidez pixel-perfect, `viewBox` e sequência de frames. Não esticar, recortar ou recolorir fora das variantes aprovadas;
7. sanitizar os assets pelo mesmo processo atual, sem alterar o resultado visual; em SVG, remover scripts, eventos, links externos, fontes remotas e metadados desnecessários;
8. criar um manifesto tipado único, por exemplo `agentActivityAssets.ts`, mapeando todos os `AgentBubbleState` para asset/frames/label/variant. `AgentActivityBubble` consome esse manifesto, sem caminhos espalhados pelos componentes;
9. não introduzir formato misto. Se o repositório tiver mudado de padrão até a execução, seguir o padrão então vigente de personagens/cenários e documentar a constatação; nunca converter os novos assets isoladamente para outro formato;
10. comparar visualmente a implementação com o design em sentado, andando, telefone, zoom e mobile. Registrar screenshots de QA, sem adicionar imagens temporárias ao bundle;
11. se a referência estiver realmente ausente ou inacessível, concluir backend/DTO/testes que não dependem dela, manter a UI protegida pela flag e reportar o bloqueio. Não inventar ícones substitutos e não declarar a parte visual concluída.

Os ícones existentes no design prevalecem sobre as sugestões semânticas da tabela. Se o design agrupar dois estados no mesmo ícone, manter o asset aprovado e diferenciar pelo `aria-label`; se faltar exatamente um dos novos estados, registrar a lacuna antes de criar qualquer extensão visual coerente com o sistema.

Regras de UX:

- balão e `NamePill` podem coexistir sem sobreposição; ao hover/foco, o nome sobe acima do balão;
- o balão não captura clique; clicar continua abrindo o agente;
- tooltip/`aria-label` usa rótulo humano, por exemplo `Nina: pesquisando`, sem expor prompt, URL, query, telefone ou resultado;
- para `using_tool`, mostrar somente nome público/ícone allowlisted do App ou `Usando ferramenta`; nunca domínio, endpoint ou argumento;
- para delegação, rótulo pode dizer `Chamando agente` ou `Chamando setor`, sem revelar o objetivo;
- três pontos usam a animação existente do design system e respeitam `prefers-reduced-motion`; nesse modo ficam estáticos;
- não empilhar balões. Se houver execuções concorrentes, mostrar um estado escolhido por prioridade e opcional badge `+N`, sem alternância frenética;
- aplicar debounce mínimo de 300 ms para estados intermediários e permanência mínima visual de 700 ms, evitando piscadas; `completed`, `failed` e `canceled` respeitam seus tempos transitórios;
- ao perder conexão/poll, manter o último estado por no máximo o TTL recebido e depois remover silenciosamente;
- pausar a simulação física não pausa nem falsifica o estado operacional: o personagem fica parado, mas o balão continua acompanhando o backend;
- **Em ligação** continua usando sprite/pose `phone`. Pode coexistir com qualquer balão relevante, e nenhum `AgentBubbleState` liga ou desliga o telefone;
- `socializing` continua sendo a interação visual entre dois personagens; não confundir com `delegating_agent`, que representa uma chamada real no runtime.

Substituir o badge azul `⚙` atual por este componente quando a feature estiver habilitada. Manter rollout por flag, mas usar uma única flag documentada para backend/frontend e apresentar fallback sem balão quando desabilitada.

## 8. Resolução no runtime

Atualizar `resolveAgentTools` para:

1. carregar grants do agente;
2. resolver instalações sempre com `{ ownerId, _id }`;
3. recusar instalação ausente, revogada, de outro owner ou com versão incompatível;
4. carregar a versão do manifesto instalada;
5. materializar somente as ações presentes em `actionKeys`;
6. injetar credenciais internamente, nunca nos argumentos visíveis ao modelo;
7. combinar credencial da instalação com `resourceConfig` não secreto;
8. aplicar autorização autônoma por ação;
9. passar ações HTTP pelo executor canônico;
10. oferecer ao modelo apenas nome, descrição e input schema;
11. retornar `capability_unavailable` estruturado quando conexão/ação estiver indisponível;
12. registrar apenas appKey, actionKey, status, duração e contagem — sem args sensíveis ou resposta integral.

Adapters nativos antigos podem continuar existindo, mas devem receber uma instalação resolvida em vez de ler credenciais do documento do agente.

### 8.1 Correlação das execuções de setor

Criar uma identidade canônica e idempotente para cada execução completa de setor. Reutilizar a hierarquia já existente em `agent_delegations` quando aplicável, mas não inferir histórico pela composição atual do setor.

Registrar um root seguro de execução de setor com: `executionKey` único, `ownerId`, `sectorId`, snapshot mínimo de nome/modo/andar, origem, correlação, status, início/fim, duração ponta a ponta e erro categorizado. Cada evento de agente participante deve referenciar `sectorExecutionId` e guardar, quando aplicável, `stageId`, `stageName`, `stageOrder` e papel (`coordinator`, `specialist`, `pipeline_stage`).

Regras:

1. iniciar o root antes do primeiro agente e finalizá-lo em sucesso, falha ou cancelamento;
2. agregar tokens e tools a partir dos eventos filhos, sem cobrar ou contar novamente;
3. usar chave idempotente para retry/redelivery não duplicar root nem participação;
4. registrar também falha ocorrida antes do primeiro agente;
5. instrumentar todos os caminhos reais que executem setor: delegação agente→setor, rotina/webhook que invoque setor e canais atendidos pelo setor;
6. excluir `SectorPlayground` das métricas de produção ou marcá-lo como `test` e ocultá-lo por padrão;
7. armazenar `sectorId` no momento da execução; mover um agente depois não reatribui o passado;
8. remoção ou renomeação futura preserva snapshots mínimos legíveis;
9. central de execuções filtrada por setor deve usar o `sectorId` registrado na execução, nunca apenas os membros atuais;
10. dados legados sem correlação permanecem como telemetria parcial; não estimar tokens, duração ou vínculo retroativo sem evidência.

### 8.2 Coordenação do andar no runtime

Reutilizar `resolveAgentTools`, `delegate_to_agent`, `delegate_to_sector`, orçamento compartilhado, limite de profundidade, detecção de ciclos, contratos de saída e telemetria existentes. Não criar `FloorRuntime` ou uma segunda implementação de orquestração.

Quando o coordenador usa política `floor`, descoberta e autorização devem filtrar por `officeId === coordinator.officeId`, mesmo que o prédio possua outros andares. Quando usa `selected`, validar os ids owner-scoped e manter apenas alvos do mesmo prédio. `all` continua abrangendo o prédio e deve exigir escolha explícita do usuário, nunca ser ativado silenciosamente pela configuração do andar.

Estender a descoberta disponível ao gerente para retornar agentes **e setores executáveis**, com id, nome, competência/objetivo, contratos, modo e readiness, respeitando a política efetiva. O modelo escolhe por competência e não por ids inventados. Setores apenas organizacionais não entram como ferramentas executáveis.

O papel do andar não concede Apps/tools adicionais ao coordenador e não ignora `callerPolicy` dos alvos. Arquivar o andar, remover/mover o coordenador ou deixá-lo sem permissão coloca a coordenação em estado não pronto; nunca escolher substituto automaticamente.

### 8.3 Gate único de colaboração

Centralizar a decisão de chamada em um serviço puro/testável usado por `delegate_to_agent`, `delegate_to_sector`, descoberta, readiness e validação de configuração. A ordem obrigatória é:

1. owner e prédio são iguais;
2. se os andares diferem, a política/link do prédio permite a direção origem→destino;
3. a política de saída do chamador permite o agente/setor alvo;
4. em chamada direta a agente, a política de entrada (`callerPolicy`) do alvo permite o chamador;
5. se o alvo participa de setor protegido, `entryPolicy` permite chamada direta;
6. profundidade, ancestralidade, orçamento e cancelamento permitem continuar;
7. somente então o alvo é apresentado ao modelo ou executado.

Para `sector_only`, uma chamada direta externa deve falhar antes de qualquer LLM com código `sector_entry_required` e referência pública ao setor que deve ser chamado. `selected_members` permite somente ids expostos. Chamadas internas criadas pelo runtime de uma execução daquele próprio setor usam `sectorExecutionId`/grant contextual e não são bloqueadas; estar apenas na lista de membros não basta para simular contexto interno.

Descoberta deve ocultar alvos indisponíveis, não apenas deixar a execução falhar depois. Um coordenador de outro setor/andar verá o núcleo fechado como um único setor com competência, contratos e readiness, nunca suas etapas internas.

Uma chamada setor A→setor B acontece por um agente autorizado de A usando `delegate_to_sector`. Estender a ancestralidade para incluir ids de setores e bloquear ciclos como `A → B → A`, inclusive quando há agentes intermediários. Se um agente estiver ligado simultaneamente a mais de um núcleo fechado de forma ambígua, bloquear a configuração e orientar que ele tenha um núcleo responsável ou seja exposto como especialista independente.

### 8.4 Agregação hierárquica sem contagem dupla

Criar um serviço único de analytics que recebe `ownerId`, período e escopo (`building`, `floor`, `sector`, `agent`). Prédio, andar, setor e agente não podem implementar fórmulas diferentes no frontend.

Definições obrigatórias:

- **duração ponta a ponta**: `finishedAt - startedAt` da raiz;
- **tempo em fila**: `startedAt - createdAt`;
- **tempo ativo**: soma das durações de inferências/agentes folha; pode superar a duração ponta a ponta quando há paralelismo e deve ser rotulado assim;
- **permanência no andar**: último fim menos primeiro início de spans daquele andar;
- **tokens**: soma de input/output dos eventos folha idempotentes;
- **tarefa originada**: `originFloorId` da raiz;
- **participação**: raiz possui ao menos um evento daquele escopo;
- **sucesso da raiz** e **sucesso da participação** são métricas diferentes e não devem ser misturadas.

Calcular média, P95 e comparação no backend usando a mesma janela e filtros. Evitar N+1; usar aggregations/indexes por owner, root, período, floor, sector e agent. Execuções `test`, dados sem timestamp válido e eventos duplicados ficam fora conforme regras documentadas.

### 8.5 Resolução das superfícies e navegação dinâmica

As páginas de App não entram em `resolveAgentTools`: elas pertencem à UI e não são ferramentas da LLM. Criar serviço próprio que combine catálogo publicado, instalações owner-scoped e preferências do usuário, retornando DTO sanitizado de navegação.

Regras do guard de superfície:

1. validar `appKey` e `surfaceKey` contra manifesto/registry conhecidos;
2. validar usuário, owner/building e instalação ativa;
3. validar scopes/actions exigidos pela superfície, sem concedê-los;
4. impedir route segment externo, path traversal, componente dinâmico ou import por URL;
5. permitir acesso não fixado a partir de `/apps`, pois pin não é autorização;
6. retornar estado `needs_reauth` acionável em vez de tela quebrada;
7. filtrar consultas de conversas no backend por canal e conexão, sem confiar só no filtro do frontend;
8. manter Apps inativos fora do sidebar e impedir seus endpoints de operação, preservando leitura administrativa de dados existentes quando autorizada.

Para Apps comunitários futuros, usar renderer declarativo com componentes allowlisted, schema de props, endpoints owner-scoped e limites de consulta. Até esse renderer existir, rejeitar manifesto comunitário com `surfaces` e jamais executar código de UI fornecido pelo publisher.

### 8.6 Projeção do estado operacional para os balões

O runtime é a fonte de verdade. Não salvar `status` mutável no documento do agente e não inferir atividade por hash. Instrumentar as transições reais já existentes em runs, steps, LLM, RAG, tools, delegações, validação e deliveries e projetá-las em um estado efêmero por agente.

Mapeamento mínimo:

- run criada/sem lease → `queued`;
- chamada ao modelo antes de tool → `thinking`;
- `source.rss`, `source.http` ou adapter de busca → `researching`;
- retrieval/memória/RAG → `reading_knowledge`;
- `runResolvedTool`/`executeToolCall` → `using_tool`;
- `delegate_to_agent` → `delegating_agent`;
- `delegate_to_sector` → `delegating_sector`;
- request externa iniciada e ainda sem resposta → `waiting_external` quando distinguível;
- pausa por confirmação/dado obrigatório → `waiting_input` somente se existir esse estado real;
- geração de resposta para canal → `responding`;
- montagem de contrato/artefato → `generating_output`;
- JSON Schema, grounding/guardrail → `validating_output`;
- `delivery.send` → `delivering`;
- retry/backoff → `retrying`;
- término → `completed`, `failed` ou `canceled`.

Criar projeção `agent_live_states` owner-scoped com índice único por `(ownerId, agentId, rootExecutionId)` e TTL em `expiresAt`, ou reutilizar uma projeção operacional equivalente se já existir ao implementar. Atualizações precisam ser idempotentes, monotônicas por timestamp/sequence e removidas/finalizadas em `finally`, inclusive sob timeout, crash recuperado, cancelamento e retry.

Quando um agente tiver mais de uma execução ativa, selecionar para o mapa pela prioridade: `failed/blocked` transitórios > `waiting_input` > `retrying` > `delivering/validating_output/generating_output` > `delegating_*` > `using_tool/researching/reading_knowledge/responding` > `thinking` > `waiting_external` > `queued` > `completed`. Desempatar pelo `updatedAt` mais recente. Não somar nem misturar fases de roots diferentes.

Evoluir o endpoint atual de `Record<agentId, 'working'>` para um DTO versionado de estados ricos. Usar polling curto e visível apenas enquanto a página do escritório estiver aberta (sugestão: 2 s), com `ETag`/`updatedSince` para resposta leve; manter fallback de 5 s em erro. Não criar websocket obrigatório nesta rodada. Estados finais devem permanecer na projeção pelo tempo de exibição antes do TTL.

## 9. Migração e compatibilidade

Criar migração idempotente e coberta por testes:

1. preencher `appKey` nas conexões atuais de e-mail/Telegram;
2. converter a integração Google existente em instalação, preservando tokens, e-mail e scopes criptografados;
3. manter fallback temporário de leitura da collection `integrations` até confirmar migração;
4. localizar configurações secretas em `agent.builtinTools`;
5. criar instalações criptografadas por owner e credencial/configuração equivalente;
6. substituir no agente por grants + `resourceConfig` não secreto;
7. nunca devolver `builtinTools.config` secreto na API durante a transição;
8. manter aliases para nomes de ferramentas existentes, evitando quebrar prompts e testes;
9. não apagar dados legados na primeira versão; marcar como migrados e remover somente em rodada futura;
10. gerar relatório de migração apenas com ids/contagens, nunca valores.
11. preencher `entryPolicy: 'open_members'` em setores existentes e `exposedAgentIds: []` sem mudar o acesso atual;
12. preencher a configuração de comunicação de prédios existentes como `all`, preservando colaboração cross-floor atual;
13. não tentar inferir automaticamente quais setores deveriam ser fechados; apenas sinalizar recomendação de revisão para pipeline/orquestrado.
14. registrar `web_chat` como App ativo para owners que já possuem widget web, sem alterar `widgetId`, embed, domínio ou roteamento;
15. registrar `whatsapp` e suas conexões a partir dos canais existentes, preservando ids, provider config criptografada, webhook, número, vínculo agente/setor e histórico;
16. criar preferências iniciais equivalentes à navegação legada somente para owners que já usavam esses recursos, evitando que percam acesso após o rollout; novos usuários começam sem pins;
17. manter dual-read/aliases de `/widgets`, `/chats` e endpoints WhatsApp até validar migração; redirects preservam query/filtro;
18. substituir exclusão acoplada de conversas ao remover canal por pausa/desconexão não destrutiva; qualquer limpeza definitiva exige ação separada;
19. não duplicar conversas nem copiar mensagens: preencher referências como `appKey`, `channel` e `installationId` quando determinístico;
20. migração repetida não pode criar duas instalações, dois pins ou duas referências para o mesmo canal.

Adicionar feature flag de rollout para a interface nova, mas manter dual-read no backend. Documentar como ativar e reverter sem perda de dados.

## 10. Apps privados e preparação da comunidade

Entregar nesta rodada a fundação segura, não um marketplace social completo.

### App privado

O usuário pode criar um App privado contendo várias ações HTTP. O manifesto deve ser validado, versionado e exportável sem credenciais. Outro usuário pode importar o manifesto e fornecer suas próprias credenciais.

### Comunidade futura

Preparar o schema para publisher, versões imutáveis, changelog, categorias, instalação fixada em versão e origem `community`. Não ativar publicação pública sem moderação.

Regras obrigatórias para futuros pacotes comunitários:

- nenhum segredo no manifesto;
- nenhum código arbitrário;
- domínios fixos e visíveis antes da instalação;
- validação de schema e templates;
- versão instalada não muda silenciosamente;
- atualização exige revisão das novas permissões;
- App suspenso deixa de aceitar novas instalações, sem apagar dados do usuário;
- ações de escrita/alto risco ficam desabilitadas por padrão;
- importação não concede automaticamente acesso a agente algum;
- auditoria de instalação, atualização, conexão, grant e revogação;
- possibilidade futura de revisão, denúncia e assinatura/verificação do publisher.

Reservar no manifesto uma seção opcional de `triggers`, mas não acoplar esta rodada ao monitoramento RSS/HTTP. Ações de saída e gatilhos de entrada são conceitos diferentes. O trabalho de monitoramento será um plano separado.

## 11. APIs

Criar controllers/services separados do `index.ts`, seguindo os padrões atuais:

- `GET /api/apps/catalog`
- `GET /api/apps/catalog/:appKey`
- catálogo/detalhe deve retornar `surfaces` sanitizadas, estado de ativação/conexão e requisitos, nunca componente/import interno;
- `GET /api/app-installations`
- `POST /api/app-installations`
- `GET /api/app-installations/:id`
- `PATCH /api/app-installations/:id`
- `POST /api/app-installations/:id/test`
- `POST /api/app-installations/:id/reconnect`
- `DELETE /api/app-installations/:id`
- endpoints OAuth por App usando state assinado/expirável e callback owner-scoped;
- `GET/PATCH /api/agents/:agentId/app-grants`
- CRUD de Apps privados e import/export de manifesto.
- `GET /api/me/navigation-preferences` e `PATCH /api/me/navigation-preferences/pinned-apps` para fixar, desafixar e ordenar com validação server-side;
- `GET /api/apps/navigation` para retornar somente Apps/superfícies efetivamente navegáveis pelo usuário atual;
- filtros de conversas devem aceitar `channel=web|whatsapp`, `installationId`, `widgetId`, `provider`, `agentId`, `sectorId`, `floorId`, status, período e cursor, aplicando ownership no backend;
- manter endpoints existentes de widget/WhatsApp como compatibilidade, extraindo controllers/services do `index.ts` sem trocar contratos de webhook durante a migração;
- evoluir `GET /api/floors/:floorId/agent-states` para `{ version, generatedAt, states[] }`, retornando somente agentes do owner/andar, enum, timestamps e `safeDetail` allowlisted;
- aceitar `updatedSince`/`If-None-Match` no estado ao vivo e responder `304` quando nada mudou; não retornar histórico, prompt, input, output ou erro bruto;
- `GET /api/sectors/:sectorId/executions/summary?period=7d|30d|all`;
- `GET /api/sectors/:sectorId/executions?period=&status=&agentId=&stageId=&source=&cursor=`;
- `GET /api/sectors/:sectorId/executions/:executionId` para a timeline sanitizada;
- reutilizar DTOs e formatadores da Central de execuções quando o significado for igual, sem duplicar regras no frontend.
- evoluir `GET/PATCH /api/floors/:floorId` para retornar/salvar `workMode`, `coordinatorAgentId` e `instruction` com validação atômica;
- `GET /api/floors/:floorId/work-overview` com coordenador, alvos efetivos, readiness e preview sanitizado;
- manter gatilhos, rotinas e Apps nos endpoints do agente; não criar endpoints duplicados de automação no andar.
- evoluir `GET/PATCH /api/sectors/:sectorId` para retornar/salvar `entryPolicy` e `exposedAgentIds` com validação por modo/participação;
- `GET /api/sectors/:sectorId/access-impact` antes de fechar ou remover exposição;
- `GET/PATCH /api/building/floor-communication` para modo e links, com update atômico;
- `GET /api/building/floor-communication/impact` para referências que seriam bloqueadas;
- DTO de descoberta/readiness deve explicar `sector_entry_required`, `floor_link_required` e `cross_floor_blocked` sem vazar configuração sensível.
- `GET /api/executions/analytics?period=7d|30d|all` para o prédio;
- `GET /api/floors/:floorId/executions/analytics?period=` para o andar;
- `GET /api/executions/breakdown?groupBy=floor|sector|agent&period=&floorId=`;
- `GET /api/executions/:executionId` para detalhe/timeline hierárquica owner-scoped;
- listas existentes de Agendadas/Gatilhos/Em andamento/Histórico devem reutilizar o mesmo escopo fixo/opcional e os mesmos filtros.

Todas as respostas usam DTOs públicos. Nunca serializar `encryptedConfig`, access token, refresh token, API key, webhook secreto ou configuração legada sensível.

## 12. Segurança

- Reutilizar `ENCRYPTION_KEY` e a criptografia existente; não inventar segredo novo no `.env`.
- Validar ownership em toda instalação, grant e ação.
- OAuth state deve ser autenticado, expirar e ser de uso único.
- Aplicar least privilege e mostrar scopes ao usuário.
- Testar conexão sem revelar corpo que possa ecoar credenciais.
- Bloquear URLs privadas, loopback, metadata endpoints e redirects SSRF.
- Validar templates para impedir interpolação de credencial em URL/log.
- Redigir headers, query params, body, resposta e erros.
- Limitar chamadas por execução e por instalação.
- Não repetir automaticamente escrita.
- Para `high_risk`, manter arquitetura genérica, mas exigir autorização explícita adicional; não tratar nome do App como garantia de segurança.
- Desconectar/revogar deve invalidar o uso imediatamente, inclusive em runs iniciadas posteriormente.
- Nenhum `delegationPolicy: all` pode atravessar andar quando a comunicação do prédio estiver isolada ou sem link na direção correta.
- Nenhuma `callerPolicy: all` pode abrir agente protegido por Núcleo fechado.
- Toda alteração de link, modo de comunicação, política de entrada ou exposição deve ser owner-scoped, auditada e validada atomicamente.
- Revalidar permissões antes de cada chamada de uma cadeia longa; remover um link ou fechar um setor bloqueia novas etapas sem cancelar trabalho já concluído.
- Configurações do prédio só aceitam o único building do owner autenticado; ids de andar são validados dentro dele.
- Analytics e timeline nunca retornam prompt, resposta completa, argumento de tool, segredo ou erro bruto.
- Pin e superfície nunca funcionam como grant. Endpoints de navegação não podem alterar instalação, scope, tool, política autônoma ou permissão de agente.
- Registrar superfícies nativas em allowlist compilada; rejeitar manifesto com caminho absoluto, URL externa, protocolo, `..`, script ou componente desconhecido.
- Consultas Web/WhatsApp aplicam owner/building/channel/connection no servidor; editar query string não pode atravessar contas ou misturar canais indevidamente.
- Desativar/desconectar App invalida entradas/saídas novas, mas não executa deleção em cascata. Deleção de histórico exige endpoint e confirmação separados.
- `safeDetail` dos balões deve ser montado no backend por allowlist. Nunca aceitar label arbitrário vindo de tool/provider nem expor objetivo, consulta, argumento, URL, payload, destino completo ou mensagem de erro.
- endpoint de estado ao vivo é read-only, autenticado, owner/floor-scoped e limitado; TTL impede agente preso eternamente em atividade após crash.

## 13. Observabilidade

Registrar eventos seguros:

- app instalado/desinstalado/reconectado/testado;
- grant de ação adicionado/removido;
- ação chamada, sucesso/falha, duração e risco;
- conexão indisponível ou scope insuficiente;
- versão instalada/atualizada.
- App ativado/desativado e conexão pausada;
- página de App aberta e pin adicionado/removido/reordenado, sem registrar conteúdo de conversa;

Não registrar credencial, payload integral, argumento sensível, prompt, resposta completa ou conteúdo de documento.

Na página do App, mostrar uso agregado e agentes vinculados. Na página do agente, mostrar no histórico qual App/ação foi utilizado, com resultado sanitizado.

Para setores, registrar início/fim do fluxo e as participações dos agentes com a mesma correlação. Índices devem cobrir `{ ownerId, sectorId, startedAt }`, a chave idempotente e a busca de filhos por `sectorExecutionId`. Métricas agregadas e timeline precisam vir da mesma fonte para nunca apresentarem totais divergentes.

Auditar alteração de modo do andar, atribuição/remoção do coordenador e mudança da política/lista de alvos. Registrar somente ids, nomes seguros e contagens; não registrar instruções completas, prompts ou resultados.

Auditar mudança de `entryPolicy`, agentes expostos, modo de comunicação e links entre andares. Registrar negações com códigos seguros (`sector_entry_required`, `cross_floor_blocked`, `floor_link_required`) e ids envolvidos, sem prompt/input. Telemetria de uma execução entre andares deve registrar andar de origem e destino para investigação e custos, sem duplicar tokens.

Toda execução real recebe `rootExecutionId` e cada transição relevante preserva a correlação. A UI mostra `telemetria desde` e cobertura parcial quando aplicável. Registrar mudanças gerais do prédio/andares pelo pop-up usando a auditoria existente, sem registrar valores secretos ou conteúdo integral de instruções.

Para Chat Web e WhatsApp, registrar métricas por `appKey`, canal e conexão com ids seguros: mensagens recebidas/enviadas, falhas, latência, handoff e conversas abertas/encerradas. Não registrar texto, mídia, telefone completo, credencial ou payload bruto de webhook nos eventos analíticos.

Emitir transições dos balões a partir da mesma telemetria da execução, sem criar uma segunda contabilidade de tokens ou resultados. Medir apenas enum, duração, agent/root/step ids e categoria pública do App. Registrar estado anterior/novo somente quando necessário para diagnóstico e aplicar sampling a heartbeats repetidos.

## 14. Testes obrigatórios

### Backend/unitários

- validação de manifesto e versionamento;
- nomes de ações, schemas, templates e domínios inválidos;
- criptografia e DTO público sem segredo;
- owner isolation em instalações e grants;
- conexão revogada não gera ferramenta;
- ação não atribuída não chega ao modelo;
- escrita autônoma sem autorização é recusada;
- cada ação HTTP passa pelo dispatcher/executor canônico;
- múltiplas conexões do mesmo App;
- colisão de nomes e namespacing;
- migração idempotente de Google, connections e builtinTools;
- aliases das ações existentes;
- App privado importado sem credenciais;
- atualização de versão sem concessão silenciosa de nova permissão.
- Chat Web sem autenticação ativa uma única instalação mesmo sob retry;
- owner com widgets/canais existentes recebe instalações e referências sem duplicar ou perder dados;
- WhatsApp conserva conversas/mensagens e vínculos depois da migração e da desconexão não destrutiva;
- filtro `channel=web` nunca retorna WhatsApp e vice-versa; filtros por conexão continuam owner-scoped;
- Apps inativos não aparecem na navegação nem recebem novas mensagens/operações;
- pin só aceita App ativo com `sidebar.pinnable` e superfícies allowlisted, rejeita `appKey` duplicada, excesso e App de outro owner;
- fixar/desafixar/reordenar não altera grants, scopes, ações ou conexão;
- URL direta passa pelo guard; `needs_reauth` produz estado acionável e não executa operação protegida;
- manifesto privado/comunitário com JS, componente, import, URL ou superfície não suportada é rejeitado;
- `/widgets` e `/chats` redirecionam preservando filtros e bookmarks;
- root de execução do setor criado/finalizado uma única vez sob retry;
- tokens dos filhos somados uma vez e separados da duração ponta a ponta;
- execução com três agentes conta como uma execução e três participações;
- falha antes do primeiro agente continua aparecendo no histórico;
- mover/remover agente não altera a atribuição histórica do setor;
- playground não contamina métricas de produção;
- filtros por setor usam o vínculo gravado no momento da execução;
- owner isolation nos endpoints de resumo, lista e detalhe do setor.
- andar legado permanece `organization` sem mudar comportamento;
- coordenador pode estar sem setor ou em setor somente organizacional;
- política `floor` descobre apenas agentes/setores do mesmo andar;
- política `selected` aceita somente ids owner-scoped e do mesmo prédio;
- modo coordenado não concede tool/App nem cria gatilho;
- mover/remover/arquivar coordenador deixa readiness pendente sem substituição automática;
- ciclos coordenador→setor→coordenador são bloqueados antes da execução;
- setor organization nunca aparece como alvo executável do coordenador.
- Núcleo fechado bloqueia chamada direta a membro/coordenador/etapa antes da LLM;
- chamada ao próprio setor continua funcionando e libera somente chamadas internas contextuais;
- exposição seletiva aceita somente agentes realmente envolvidos naquele setor;
- migração mantém setores existentes abertos e idempotentes;
- modo isolado bloqueia ida e volta entre andares;
- link unidirecional permite A→B e bloqueia B→A;
- link bidirecional permite ambos sem ignorar políticas de agente/setor;
- `all` do agente não ultrapassa bloqueio entre andares;
- prédio/andar de outro owner nunca entra em links ou impacto;
- ciclos entre setores são detectados mesmo com agentes intermediários.
- raiz de execução é idempotente em retries/redelivery;
- tokens de parent/child não são somados duas vezes;
- tarefa com paralelismo pode ter tempo ativo maior que wall-clock sem alterar duração ponta a ponta;
- tarefa que cruza dois andares conta uma vez no prédio, uma originada no primeiro e uma participação em cada;
- P95, média e período usam somente amostras válidas e documentadas;
- playground/test não entra no dashboard de produção;
- analytics e timeline aplicam owner isolation e redaction.
- `AgentBubbleState` aceita somente os enums documentados e expira por TTL;
- cada caminho real produz a sequência esperada: LLM, RAG, tool, agente, setor, validação, entrega, retry, sucesso, falha e cancelamento;
- falha/timeout/cancelamento limpa estado ativo em `finally`; retry não deixa duas projeções concorrentes;
- owner/floor isolation impede visualizar estado de agente alheio;
- múltiplos roots escolhem estado pela prioridade e timestamp documentados;
- `safeDetail` não contém prompt, query, URL, argumento, output, telefone, e-mail completo ou erro bruto;
- endpoint suporta `304`/delta e não consulta N+1 por agente.

### Integração

- conectar/testar/desconectar;
- OAuth Google com mocks, refresh e revogação;
- criar App privado com duas ações e instalar em outra conta usando credencial própria;
- atribuir ações diferentes a dois agentes;
- agente executa somente a ação autorizada;
- disconnect durante nova execução produz falha estruturada;
- logs e auditoria sem segredo;
- rotinas antigas de e-mail/Telegram continuam entregando.
- pipeline registra etapas na ordem real, inclusive retry, continue-on-error e interrupção;
- setor orquestrado diferencia coordenador e especialistas acionados;
- execução por rotina, webhook, delegação e canal aparece com origem correta;
- resumo, lista e detalhe retornam os mesmos totais de tokens/status;
- histórico legado sem correlação não recebe números inventados.
- secretário do andar descobre um setor pela competência e executa via `delegate_to_sector` existente;
- agente sem setor coordena o andar e chama setor/standalone agent autorizados;
- execução independente do coordenador usa suas permissões normais e não recebe autoridade extra oculta do andar;
- troca de modo coordenado para livre não apaga nem altera agentes/setores.
- agente do setor A chama setor B pelo núcleo completo quando todas as camadas permitem;
- tentativa de chamar etapa interna de pipeline fechado retorna `sector_entry_required` e gasta zero tokens;
- fechar um setor durante uma cadeia impede novas chamadas externas sem repetir etapas concluídas;
- comunicação entre andares selecionada respeita direção e atualiza descoberta/readiness imediatamente;
- arquivar/remover andar invalida links sem deixar ids executáveis órfãos.
- totais do prédio conciliam com raízes únicas e breakdowns por andar;
- métricas fixas do andar não podem ser ampliadas removendo filtro pelo cliente;
- timeline combina automação, setor, agente e tool sem duplicar consumo;
- gargalos apontam para filtros reais e não aparecem sem amostra mínima.

### Frontend/E2E

- catálogo responsivo desktop/mobile;
- fluxo conectar → testar → atribuir ao agente → remover;
- Google conectado uma vez e usado por mais de um agente;
- app desconectado não aparece como utilizável;
- seleção granular de ações e avisos de risco;
- Custom Tools preservadas na aba Personalizados;
- rotas antigas redirecionam corretamente;
- nenhum campo secreto reaparece depois de salvar;
- estados loading/empty/error/revoked/needs_reauth.
- página do agente em desktop, tablet e mobile sem conteúdo cortado ou rolagem horizontal global;
- workspace das cinco abas ocupa toda a largura útil e mantém a mesma dimensão ao alternar abas;
- textos, URLs, schemas e controles longos continuam legíveis e operáveis;
- Zona de perigo não aparece em Visão geral, Como trabalha, Fluxos ou Atividade;
- Zona de perigo é o último bloco de Avançado;
- cancelar ou digitar um nome incorreto não exclui o agente;
- confirmação correta exclui uma única vez, trata erro sem navegar e redireciona apenas no sucesso.
- fluxo do setor cresce de cima para baixo em todos os breakpoints e não gera scroll horizontal global;
- pipeline mantém a ordem Entrada → etapas → Saída e o orquestrado não aparenta uma cadeia falsa entre especialistas;
- aba Execuções mostra métricas do período, detalhamento por agente e histórico paginado;
- expansão de uma execução apresenta timeline vertical na ordem registrada;
- filtros atualizam métricas e lista com o mesmo escopo;
- playground permanece utilizável, aparece como teste e não altera números de produção;
- estados vazio, parcial, em andamento, falha e agente removido são compreensíveis.
- seção Como este andar trabalha funciona em desktop/mobile e diferencia claramente Livre de Coordenado;
- seletor aceita agente sem setor, mostra apenas agentes do andar e recomenda gerente/secretário;
- preview vertical distingue alvos disponíveis de sequência obrigatória;
- badge do coordenador aparece sem duplicar personagem no mapa;
- readiness e links levam à configuração exata que falta.
- bloco Como este setor pode ser chamado mostra corretamente os três modos e o impacto da alteração;
- agentes internos de núcleo fechado desaparecem dos seletores/descoberta externos, mas permanecem visíveis na administração do setor;
- Configurações permite visualizar e editar links direcionais entre andares em desktop/mobile;
- resumos `Pode pedir trabalho a`/`Aceita pedidos de` refletem exatamente o gate do backend;
- erros de acesso oferecem CTA para abrir a configuração correta sem prometer acesso inexistente.
- avatar/letra azul do prédio não existe mais no desktop ou mobile;
- seletor de andar e engrenagem do prédio são controles separados e acessíveis;
- pop-up Geral/Andares/Comunicação salva, trata erro e funciona em todos os breakpoints;
- configurações da conta continuam distintas das configurações do prédio;
- sidebar diferencia Execuções do andar e Execuções do prédio;
- escopo prédio/andar preserva filtros, paginação, reload e deep link;
- cards, breakdowns e gargalos têm loading/empty/error/partial sem layout quebrado.
- sidebar não mostra Canais/Conversas estáticos; mostra Apps fixados somente após ativação + pin;
- App com várias páginas aparece uma vez, abre submenu com todas elas, destaca a rota ativa e preserva ordem/reload;
- Chat Web e WhatsApp têm modal completo, estados Ativar/Conectar, páginas próprias e filtros corretos;
- mobile drawer oferece os mesmos pins sem quebrar navegação primária, safe area ou acessibilidade;
- desativar/pausar explica impacto e preserva histórico; exclusão permanente não ocorre pelo fluxo comum.

### Frontend/visual dos balões

- nenhum balão aparece quando não há execução, inclusive para agenda/gatilho apenas armado;
- todos os estados renderizam ícone/rótulo corretos; pontos aparecem somente nos estados ativos;
- `completed`, `failed` e `canceled` permanecem e desaparecem nos tempos definidos;
- hover/foco, nome e balão não se sobrepõem em personagens sentados, andando ou próximos da borda;
- balão acompanha zoom/pan/caminhada sem participar de colisão ou causar reflow global;
- pause/recall da simulação não alteram o estado operacional;
- pose `phone` funciona durante `thinking`, `using_tool`, `responding`, `delivering`, falha e ausência de balão;
- `socializing` não produz delegação falsa e delegação real não força os personagens a socializarem;
- reduced motion remove pulso/movimento dos pontos sem esconder significado;
- flag desligada mantém o mapa atual sem badge `⚙` nem regressão.
- todos os enums possuem entrada no manifesto e asset existente com path case-sensitive válido em build Linux;
- implementação usa os assets exportados do Cloud/Claude Design, sem emoji, placeholder, hotlink ou recriação aproximada;
- assets seguem o mesmo formato/pipeline dos personagens e cenários; SVGs não contêm script/event handler/referência externa e frames respeitam transparência e proporção aprovadas;
- teste visual compara balão, ícone, pontos, cauda, sombra e espaçamento com a referência do design.

Executar typecheck, lint, builds, testes backend/frontend e E2E relevantes. Atualizar testes antigos em vez de simplesmente removê-los.

## 15. Critérios de aceite

1. O usuário conecta Google na página Apps uma vez.
2. A conexão libera Agenda e Sheets como conjuntos de ações.
3. Dois agentes podem usar a mesma conexão com recursos e ações diferentes.
4. Um agente não vê Apps desconectados como ferramentas executáveis.
5. Slack/Stripe/etc. não pedem token dentro do agente.
6. Tokens existentes são migrados para armazenamento criptografado e deixam de sair pela API.
7. Custom Tools continuam funcionando e podem ser atribuídas aos agentes.
8. Um App privado pode agrupar múltiplas ações HTTP, ser exportado sem segredo e importado por outra conta.
9. O importador precisa fornecer sua própria credencial e atribuir ações explicitamente.
10. Nenhuma App comunitária executa código arbitrário.
11. Ações de escrita não ganham autorização autônoma por instalação/importação.
12. Desconectar uma instalação interrompe o uso por todos os agentes sem apagar os agentes.
13. E-mail/Telegram e rotinas existentes continuam compatíveis.
14. Logs explicam App/ação/status sem expor conteúdo sensível.
15. Interface mobile tem paridade funcional com desktop.
16. O workspace de configuração do agente ocupa toda a largura útil, sem cortar conteúdo em nenhum breakpoint.
17. A Zona de perigo existe somente no final de Avançado e exige confirmação pelo nome exato do agente.
18. Falha ou cancelamento da exclusão preserva o agente e a página; somente sucesso redireciona.
19. O diagrama de fluxo do setor é vertical, responsivo e preserva a semântica de cada modo.
20. A aba Execuções do setor exibe consumo, tempo, sucesso e volume reais do fluxo para 7d, 30d e todo o período.
21. Uma execução do setor conta uma vez, enquanto sua timeline mostra separadamente cada agente/etapa percorrido.
22. Tokens, duração, origem e vínculo histórico do setor são idempotentes, owner-scoped e não dependem da equipe atual.
23. Testes do playground não contaminam indicadores de produção.
24. Andares antigos continuam em modo Livre sem alteração funcional.
25. Um agente sem setor pode coordenar o andar e escolher setores/agentes autorizados por competência.
26. O modo Coordenado reutiliza o runtime do agente e não cria ferramentas, credenciais ou gatilhos no andar.
27. `Tudo deste andar` nunca alcança outro andar; acesso ao prédio inteiro exige `all` escolhido explicitamente.
28. Setores organizacionais não são executados e ciclos são bloqueados com mensagem acionável.
29. Pipeline permanece responsabilidade do setor, não do andar.
30. Um setor pode funcionar como núcleo fechado: chamadas externas executam o setor completo e não entram diretamente em seus agentes.
31. Exposição seletiva e aberta funcionam sem ignorar permissões individuais.
32. Agentes e setores indisponíveis não são apresentados pela descoberta da LLM.
33. Comunicação cross-floor é controlada no prédio como isolada, total ou por links direcionais.
34. Uma permissão ampla do agente nunca supera bloqueio de andar ou proteção do setor.
35. Chamadas setor→setor respeitam direção, orçamento, profundidade e prevenção de ciclos.
36. Migrações preservam o comportamento atual de setores e prédios existentes.
37. O topo do sidebar possui seletor de andar sem avatar/letra e engrenagem independente para o prédio.
38. O pop-up do prédio organiza Geral, Andares e Comunicação sem misturar configurações da conta.
39. Existem visões canônicas de execuções do prédio e do andar, além das visões de setor e agente.
40. Uma tarefa é contada uma vez no prédio mesmo quando percorre vários agentes, setores ou andares.
41. Métricas distinguem duração ponta a ponta, fila, tempo ativo e permanência no andar.
42. Comparações e gargalos usam dados reais, amostra visível e links para investigação.
43. Métricas e histórico nunca expõem conteúdo ou segredo das execuções.
44. Chat Web e WhatsApp aparecem no catálogo como Apps nativos e não mais como itens estáticos obrigatórios do sidebar.
45. O modal de cada App explica o que libera, páginas, permissões, dados, configuração, estado e impacto antes de ativar/conectar.
46. Somente App ativo com `sidebar.pinnable` pode ser fixado; pin não concede ação ou acesso ao agente.
47. Um App aparece uma única vez e expõe automaticamente todas as páginas em grupo recolhível, com ordem e paridade mobile, sem pins por subpágina.
48. Chat Web oferece Visão geral, Widgets e Conversas Web; WhatsApp oferece Visão geral, Números e Conversas WhatsApp.
49. Conversas são filtradas no backend por canal/conexão e permanecem owner-scoped.
50. Migração preserva widgets, embeds, canais, webhooks, providers, vínculos, conversas e mensagens existentes sem duplicação.
51. Pausar/desconectar não apaga histórico; deleção definitiva é separada, explícita e fortemente confirmada.
52. Apps comunitários não conseguem registrar ou executar UI arbitrária; superfície declarativa só funciona por renderer allowlisted.
53. Rotas legadas continuam válidas por redirect e o acesso direto às novas rotas respeita status, ownership e scopes.
54. O personagem mantém movimento e pose física independentes do balão operacional.
55. **Em ligação** é pose física `phone`, pode coexistir com qualquer balão e nunca é ativada pelo estado do balão.
56. O mapa mostra balões somente a partir de execuções reais e diferencia fila, LLM, pesquisa, conhecimento, tool, delegação, espera, resposta, geração, validação, entrega, retry e resultados.
57. Não há balão permanente para rotina agendada, monitor ou webhook apenas aguardando disparo.
58. Balões nunca expõem conteúdo sensível e somem de forma previsível após término, erro, cancelamento, perda de conexão ou TTL.
59. O badge genérico `⚙` é substituído pelo balão de quadrinho acessível, responsivo e compatível com reduced motion.
60. Os balões e ícones são importados da referência Cloud/Claude Design já salva no projeto, versionados localmente e mapeados por manifesto tipado.
61. Nenhum asset aprovado é substituído por emoji, ícone genérico ou desenho aproximado; formato, loader, frames e organização seguem exatamente o padrão visual vigente dos personagens e cenários.

## 16. Sequência de implementação

1. Criar contratos/manifestos e testes puros.
2. Evoluir `connections` e criar serviços/DTOs de instalação.
3. Implementar migração e dual-read.
4. Converter catálogo/adapters nativos para manifests.
5. Implementar grants e resolução no runtime.
6. Fechar vazamento de configurações legadas antes de ligar a UI.
7. Criar APIs e auditoria.
8. Criar página Apps e redirects.
9. Adicionar surfaces/registry, preferências de pins, APIs/guards e navegação dinâmica.
10. Converter Chat Web e WhatsApp em Apps nativos reutilizando componentes, storage, webhooks e providers atuais.
11. Implementar modais, páginas próprias, filtros por canal/conexão e redirects legados.
12. Migrar instalações/pins/referências existentes e validar desconexão não destrutiva em fixture.
13. Definir enums/DTO/projeção TTL dos estados operacionais e instrumentar transições reais do runtime.
14. Abrir a referência Cloud/Claude Design já salva, inventariar/exportar os balões e ícones e criar o manifesto tipado local dos assets.
15. Evoluir o endpoint de estados, substituir o badge `⚙` por `AgentActivityBubble` usando os assets aprovados e validar independência da pose `phone`.
16. Reestruturar a página do agente em largura total, mover/proteger a Zona de perigo e validar todos os breakpoints.
17. Converter o diagrama do setor para fluxo vertical e validar os três modos.
18. Implementar correlação/telemetria idempotente de execução de setor e seus endpoints.
19. Construir Desempenho, Histórico, timeline e Testar setor na aba Execuções.
20. Evoluir o schema do andar e a política `floor` com migração/default compatível.
21. Implementar descoberta de agentes/setores e validações da coordenação do andar reutilizando delegação existente.
22. Criar a seção Como este andar trabalha, preview vertical, readiness e badge do coordenador.
23. Implementar `SectorEntryPolicy`, impacto, migração compatível e UI do núcleo.
24. Implementar comunicação entre andares, links direcionais, impacto e UI em Configurações.
25. Centralizar descoberta/autorização no gate único e cobrir chamadas agente→agente, agente→setor e setor→setor.
26. Introduzir `ExecutionRoot`/correlação em todos os caminhos reais e migrar somente dados determinísticos.
27. Implementar analytics hierárquico e timeline única com testes de não duplicação.
28. Refatorar seletor do sidebar e criar `BuildingSettingsDialog` com paridade mobile.
29. Criar visão geral do prédio, rota/visão do andar, breakdowns e gargalos.
30. Implementar Apps privados e import/export declarativo.
31. Rodar todas as migrações em fixture/cópia de teste.
32. Executar toda a validação e atualizar documentação de deploy/env.

## 17. Restrições de execução

- Trabalhar somente na `development`.
- Não fazer merge, deploy ou alterar DNS/Coolify.
- Não ler, imprimir, copiar ou commitar `.env` real.
- Não substituir `ENCRYPTION_KEY`.
- Não apagar dados existentes.
- Não criar marketplace com pagamento, ranking ou publicação irrestrita nesta rodada.
- Não executar UI, JavaScript, HTML, pacote ou import fornecido por App privado/comunitário.
- Não apagar conversas, mensagens, widgets ou canais ao desativar/desconectar App.
- Não usar pin do sidebar como autorização, grant, conexão ou ativação.
- Não substituir, reiniciar ou acoplar a simulação física aos estados do balão.
- Não usar `statusFor(id)` decorativo, texto da LLM ou payload externo como fonte de estado operacional.
- Não manter balão de agente parado apenas porque existe agenda, monitor ou gatilho ativo.
- Não redesenhar balões/ícones já aprovados no Cloud/Claude Design, não usar emoji/Lucide como substituto, não introduzir formato visual diferente do projeto e não depender de URL remota em produção.
- Não declarar a UI dos balões concluída sem importar os assets, criar o manifesto e validar paridade visual com a fonte de design.
- Não implementar monitoramento RSS/HTTP neste plano.
- Não criar componentes específicos de trading.
- Não criar pipeline de setores, runtime paralelo ou gatilhos próprios do andar.
- Não permitir bypass por endpoint legado, playground, chamada direta por id ou ferramenta de delegação antiga.
- Não calcular métricas críticas no browser nem somar coleções sem uma raiz de correlação.
- Não tratar tempo ativo somado como duração real da tarefa.
- Não declarar concluído enquanto migração, segurança, compatibilidade e testes não estiverem verdes.

## 18. Entrega esperada do executor

Ao terminar, informar:

- resumo por fase e por arquivo;
- modelo final de dados e decisões de compatibilidade;
- como dados antigos foram migrados;
- variáveis de ambiente adicionadas ou alteradas, sem valores secretos;
- comandos e resultados de typecheck/lint/build/test/E2E;
- riscos restantes e itens deliberadamente adiados para a comunidade pública;
- checklist manual para conectar Google, conectar um App por API key, atribuir ações a um agente, revogar e confirmar que ele perdeu acesso.
- checklist visual da página do agente nos breakpoints mobile/tablet/desktop e da confirmação segura de exclusão em Avançado.
- checklist do fluxo vertical nos modos organização/orquestrado/pipeline e da aba Execuções com um fluxo real de múltiplos agentes.
- checklist do andar Livre/Coordenado usando um secretário sem setor, um setor executável, um setor apenas organizacional e tentativa de acesso a outro andar.
- checklist de Núcleo fechado/Selecionado/Aberto e de links isolado/A→B/A↔B, confirmando descoberta, bloqueio antes da LLM, logs e consumo zero nas negações.
- checklist do seletor/engrenagem e pop-up do prédio em rail fechado/aberto, mobile e troca de andar preservando rota.
- fixture de uma tarefa que cruza dois andares e três agentes, reconciliando prédio, andar, setor e agente sem dupla contagem.
- checklist de Chat Web/WhatsApp: modal, ativar/conectar, múltiplas páginas, pin/unpin/ordem, desktop/mobile, filtro por canal e redirect legado.
- relatório de migração com contagens de widgets, canais, instalações, pins e conversas preservadas, sem conteúdo ou segredo.
- teste manual provando que pausar/desconectar bloqueia novas operações, mantém histórico e não altera grants por causa de um pin.
- checklist visual de todos os balões em sentado/andando/socializando/telefone, zoom, bordas, desktop/mobile e reduced motion.
- fixture de execução completa demonstrando transições reais, prioridade concorrente, TTL, falha e limpeza sem conteúdo sensível.
- inventário dos assets trazidos do Cloud/Claude Design, localização final, manifesto estado→asset/frame e confirmação de que nenhum arquivo usa referência remota.
- screenshots/checklist de paridade com o design para variantes animadas/estáticas, sem incluir material temporário no bundle final.
