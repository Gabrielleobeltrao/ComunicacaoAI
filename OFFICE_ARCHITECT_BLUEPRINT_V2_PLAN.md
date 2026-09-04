# Plano de implementação — Arquiteto Central e Office Blueprint V2

## 1. Resultado esperado

Transformar **Montar operação** na principal porta de entrada e de manutenção do produto.
O usuário deve poder conversar com um único Arquiteto em qualquer tela para:

1. fazer uma pergunta sem alterar o escritório;
2. montar uma operação nova;
3. expandir ou reorganizar o que já existe;
4. diagnosticar uma falha e propor o conserto;
5. executar uma ação autorizada;
6. arquivar ou excluir uma parte do escritório com impacto conhecido.

O Arquiteto não substitui os agentes. Ele é a camada administrativa que entende a intenção,
consulta o estado real da conta, propõe um `OfficeBlueprintV2`, mostra o diff, pede as
aprovações necessárias, aplica pelos serviços canônicos e prova que o resultado funciona.

Exemplos que precisam funcionar:

> Qual é o valor do dólar hoje?

Resposta direta, com fonte e instante da consulta. Nenhum projeto ou recurso é criado.

> Observe CXSE3 e me avise quando o RSI ficar abaixo de 30.

Proposta de fonte de dados da B3, armazenamento de candles, ferramenta de RSI, monitor,
Flow de análise, agentes necessários e entrega. Nada é ativado antes de conexão, teste e
confirmação.

> Adicione reservas pelo WhatsApp ao meu restaurante.

Reutiliza o que já existe, propõe somente o delta e testa mensagem → agente → agenda →
confirmação.

## 2. Baseline e regras de trabalho

Baseline obrigatória: `development` no commit `7215e21` ou seu descendente direto.

Antes de implementar:

- ler este arquivo inteiro;
- ler `MONITORING_CENTER_PROGRESS.md` e o relatório final, quando existir;
- ler `AGENTS.md`/`CLAUDE.md`, se existirem;
- confirmar `git status`, branch e commit;
- criar uma branch/worktree exclusiva para o V2;
- não alterar `main` e não misturar correções sem relação com este plano;
- preservar APIs e dados V1 durante a migração.

Não reimplementar Agents, Sectors, Floors, Apps, Databases, Knowledge, Monitoring,
Monitors, Flows/Automations, Activity ou Extensions. O Blueprint apenas orquestra os
serviços canônicos desses domínios.

## 3. Estado atual que deve ser preservado

O Arquiteto V1 já possui boas garantias:

- projeto e mensagens owner-scoped;
- `OperationBrief` separado do desenho técnico;
- perguntas escolhidas por impacto;
- classificação agente/função/ferramenta/rotina;
- compilação determinística;
- validação, crítico e simulação sem efeitos;
- camadas Essencial, Recomendado e Completo;
- preview, hash canônico e aprovação explícita;
- saga idempotente, lock, retomada e rollback conservador;
- conhecimento só é escrito com conteúdo fornecido;
- Apps não são conectados automaticamente;
- rotinas nascem em rascunho;
- preview visual e chat flutuante dentro do projeto.

Essas propriedades são invariantes do V2.

## 4. Lacunas confirmadas no V1

O V2 só pode ser marcado como concluído quando resolver estes pontos:

1. `OfficeBlueprintV1` descreve apenas prédio, andares, agentes, setores, rotinas,
   requisitos de Apps e Knowledge. Não representa Databases, datasets, Tools, Sources,
   Live, Monitors, Flows, canais vinculados, entregas e grants dos novos recursos.
2. `liveDataNeeds` existe no Brief, mas não é compilado em fonte + destino + monitor.
3. `loadExistingResources` e `ResourceLinks` só permitem reaproveitar floor, agent,
   sector e routine.
4. `compileBrief` cria um único andar genérico e uma “Mesa de trabalho”; não modela uma
   empresa com múltiplas áreas nem escolhe corretamente entre expandir e criar.
5. requisitos de Apps compilados recebem `actionKeys: []`. Um grant sem ações resolve
   para zero ferramentas.
6. a escolha do canal pode usar o primeiro canal conectado em vez do canal solicitado.
7. declarar um App de canal não cria necessariamente o vínculo operacional entre canal,
   agente de entrada e conversa.
8. revisão de recursos existentes não atualiza toda a topologia: membros, coordenadores,
   stages, mudanças de andar e vínculos podem permanecer antigos.
9. um trabalho condicionado por dado pode virar rotina com cron padrão, quando deveria
   virar Source + Monitor + Flow.
10. a simulação atual é estrutural; não prova integração ponta a ponta.
11. a visualização de Flow pode mostrar responsabilidade vazia.
12. “Montar operação” está escondido no seletor de andares na navegação V2.
13. a exclusão de andar só considera agentes/setores e não produz impacto completo sobre
    recursos e operações relacionados.

Criar testes de caracterização para cada lacuna antes de substituir o comportamento.

## 5. Modelo mental do produto

O Arquiteto trabalha sobre três camadas:

### Organização — quem existe

- Building
- Floor
- Sector
- Agent

### Recursos — o que o escritório possui

- Knowledge
- Memory policy
- App installation e capacidades
- Database/Data Store e datasets
- Tool/Function e versão publicada
- Connection/Secret apenas por referência

### Operação — o que acontece

- Channel binding
- Monitoring Source
- Live destination e History recorder
- Monitor
- Flow/Automation
- Delivery/Notification
- Acceptance test

Um catálogo comum pode listar e explicar esses elementos, mas **não pode substituir as
regras específicas de autorização**. App continua usando instalação + ação + escrita
autônoma; Knowledge continua usando sua política de escopo; Database e Source continuam
com seus grants próprios. O Arquiteto consulta os adapters canônicos e nunca inventa uma
herança genérica de permissão.

## 6. O Arquiteto em quatro modos

Criar um roteador de intenção determinístico com saída estruturada e confirmação de modo.

```ts
type ArchitectIntent =
  | { mode: 'answer'; query: string; freshness: 'static' | 'current' }
  | { mode: 'propose'; changeKind: 'create' | 'expand' | 'repair' | 'reorganize'; objective: string }
  | { mode: 'operate'; action: string; targetRef?: string; risk: 'read' | 'write' | 'high_risk' }
  | { mode: 'explain'; targetRef?: string; question: string }
```

Regras:

- pergunta não cria projeto;
- consulta atual usa uma Tool/App/Fonte real e informa origem + horário;
- pedido de mudança cria/reabre um projeto e produz proposta;
- ação de leitura pode executar se já autorizada;
- escrita exige permissão; escrita autônoma segue o grant específico;
- ação sensível ou destrutiva exige preview e confirmação contextual;
- ambiguidade entre responder e modificar resulta em uma pergunta curta;
- texto da LLM nunca é comando e nunca escolhe ObjectId;
- toda execução aparece em Activity.

## 7. Chat global e navegação

### 7.1 Superfície global

Criar um único `ArchitectAssistantProvider` montado no `AppLayout`, com:

- botão flutuante persistente em desktop e mobile;
- abrir, minimizar e fechar sem perder o rascunho;
- conversa preservada ao navegar;
- painel redimensionável no desktop;
- sheet/tela inteira no mobile, sem cobrir teclado ou navegação;
- streaming/cancelamento quando suportado pelo provider;
- estados: respondendo, consultando, preparando proposta, esperando aprovação,
  aplicando, testando, concluído e falhou;
- foco, teclado, leitor de tela e alvo de toque mínimo;
- nenhuma segunda instância concorrente do chat na página de projeto.

O contexto enviado ao backend deve ser uma referência validável, não o conteúdo da tela:

```ts
interface ArchitectUiContext {
  pathname: string
  buildingId?: string
  floorId?: string
  sectorId?: string
  agentId?: string
  resource?: { kind: string; id: string }
}
```

O servidor reconfirma ownership. A rota não pode confiar em IDs do cliente.

### 7.2 Navegação principal

- renomear a experiência para **Montar e ajustar escritório**;
- torná-la CTA principal do estado vazio e ação de destaque do escritório;
- retirar o único acesso escondido dentro do seletor de andares;
- manter `/architect` como central de projetos, propostas anteriores e auditoria;
- manter editores manuais como modo avançado, nunca removê-los.

## 8. Office Blueprint V2

Criar `OfficeBlueprintV2` versionado. Não mudar silenciosamente o significado do V1.

```ts
interface BlueprintItemBaseV2 {
  key: string
  action: 'create' | 'reuse' | 'update' | 'archive'
  resourceId?: string | null
  layer: 'essential' | 'recommended' | 'complete'
  rationale: string
  dependsOn: string[]
}

interface OfficeBlueprintV2 {
  version: 2
  title: string
  objective: string
  changeKind: 'create' | 'expand' | 'repair' | 'reorganize'
  organization: {
    buildingPatch?: BlueprintBuildingPatch
    floors: BlueprintFloorV2[]
    sectors: BlueprintSectorV2[]
    agents: BlueprintAgentV2[]
  }
  resources: {
    knowledge: BlueprintKnowledgeV2[]
    memoryPolicies: BlueprintMemoryPolicyV2[]
    appRequirements: BlueprintAppRequirementV2[]
    databases: BlueprintDatabaseV2[]
    datasets: BlueprintDatasetV2[]
    tools: BlueprintToolRequirementV2[]
  }
  operations: {
    channels: BlueprintChannelBindingV2[]
    sources: BlueprintMonitoringSourceV2[]
    liveDestinations: BlueprintLiveDestinationV2[]
    histories: BlueprintHistoryV2[]
    monitors: BlueprintMonitorV2[]
    flows: BlueprintFlowV2[]
    routines: BlueprintRoutineV2[]
    deliveries: BlueprintDeliveryV2[]
  }
  access: BlueprintGrantV2[]
  acceptanceTests: BlueprintAcceptanceTestV2[]
  assumptions: ArchitectAssumption[]
  warnings: ArchitectWarning[]
  checklist: ArchitectChecklistItem[]
}
```

Cada referência interna usa `key`. `resourceId` só pode ser anexado pelo inventário do
servidor ou por escolha owner-scoped na UI. Segredos nunca entram no Blueprint.

### 8.1 Agentes

Todo agente precisa declarar e exibir:

- nome humano;
- papel/responsabilidade;
- gatilho de entrada;
- contrato de entrada;
- julgamento que realiza;
- ação que executa;
- contrato de saída;
- limites: o que não faz;
- executor;
- Apps/Tools/Knowledge/Databases usados;
- quem pode acioná-lo e quem ele pode acionar;
- fallback/handoff;
- memória e grounding.

Agente sem responsabilidade ou entrega é erro bloqueante, não warning.

### 8.2 Apps e Tools

`BlueprintAppRequirementV2` deve conter ações exatas:

```ts
interface BlueprintAppRequirementV2 extends BlueprintItemBaseV2 {
  appKey: string
  installationRef?: string | null
  agentKeys: string[]
  actionKeys: string[]
  autonomousWriteActionKeys: string[]
  resourceConfig: Record<string, string>
  required: boolean
}
```

- ação precisa existir no manifesto atual;
- `actionKeys` vazio não satisfaz requisito de ferramenta;
- leitura e escrita são mostradas separadamente;
- escrita autônoma começa vazia e exige aprovação por ação;
- App desconectado vira checklist com link de conexão;
- o Arquiteto nunca recebe, grava ou reexibe a credencial.

### 8.3 Databases, Sources, Monitors e Flows

- Database define owner/scope, adapter/schema, datasets e retention;
- Source usa exatamente a união discriminada da Central de Monitoramento;
- destino Live e History aponta para os subsistemas canônicos;
- Monitor usa a AST canônica, trigger mode, debounce, cooldown e stale policy;
- Monitor que dispara trabalho aponta para Flow publicado ou cria Flow draft dependente;
- Flow usa o contrato atual de automations/steps, incluindo paralelismo e dependências;
- tudo nasce draft/paused quando ainda depende de conexão ou teste;
- somente recursos que passaram em teste podem ser ativados/publicados.

## 9. Inventário e grafo do escritório

Substituir o contexto parcial por um inventário paginado e resumido de:

- prédio, andares, setores, agentes e topologia;
- Knowledge e políticas de acesso;
- Databases, datasets e grants;
- Apps, instalações, versões, ambientes e grants por ação;
- Tools, funções registradas e versões publicadas;
- canais e destinos atuais;
- Sources, estado Live, recorders e saúde;
- Monitors e Flows relacionados;
- rotinas, entregas e últimas falhas relevantes.

Não enviar todo o banco ao modelo. Criar duas representações:

1. `OfficeInventory`: completo, owner-scoped, usado pelo código determinístico;
2. `OfficeInventorySummary`: mínimo necessário para a rodada atual.

Criar um `DependencyGraph` comum apenas para impacto e ordem de aplicação:

```ts
interface ResourceNode { kind: string; id: string; ownerScope: string; label: string }
interface ResourceEdge { from: string; to: string; relation: string; required: boolean }
```

Esse grafo não decide autorização. Cada adapter continua decidindo acesso.

## 10. Descoberta, classificação e compilação

### 10.1 Brief V2

Estender o Brief com:

- estrutura organizacional desejada;
- eventos e condições que iniciam trabalho;
- dados atuais versus históricos;
- tolerância de atraso/freshness;
- destino das respostas/notificações;
- registros que precisam ser guardados;
- ações externas e risco;
- política de aprovação humana;
- recursos que devem ser reutilizados;
- critérios de aceitação observáveis.

### 10.2 Classificação

Classificar cada trabalho em uma ou mais peças compatíveis:

- julgamento/conversa → agent;
- cálculo → function/tool;
- ação externa → app action;
- estado estruturado → database/dataset;
- entrada contínua → source;
- condição no tempo → monitor;
- coordenação de etapas → flow;
- horário → routine;
- entrega → channel/delivery.

Não classificar “quando RSI < 30” como simples cron. É Source + cálculo + Monitor; o Flow
só começa na borda verdadeira.

Heurísticas por regex podem sugerir, mas não podem ser a decisão final. Validar contra o
manifesto real, schemas, risco e disponibilidade da conta. Recurso não resolvido vira
pendência explícita.

### 10.3 Compilação determinística

Mesmo Brief + mesmo inventário + mesma versão da constituição deve produzir o mesmo
Blueprint e as mesmas keys. A LLM descreve o negócio e propõe intenções; o compilador
seleciona tipos e contratos existentes.

Para revisão de projeto aplicado:

- partir do `resourceMap` e do inventário atual;
- marcar o existente como reuse/update;
- criar somente o delta;
- detectar drift e edição manual;
- nunca duplicar por mudança de nome ou modelo;
- não sobrescrever edição humana sem aprovação individual.

## 11. Flow do setor e responsabilidades vazias

Tratar este defeito como regressão bloqueante.

Backend:

- validador exige `role` ou responsabilidade normalizada, `inputContract` e
  `outputContract` para cada agente operacional;
- setor orquestrado exige coordenador, membros, rotas e fallback;
- pipeline exige stages, dependências sem ciclo, expected output e onError;
- aplicação preserva membros, coordinator, stages, routingDescription e contratos em
  create **e update**;
- mover agente/setor atualiza referências ou bloqueia com impacto.

Frontend:

- Flow mostra nome, responsabilidade, entrada, decisão, entrega e conexões;
- usa `objective` apenas como fallback visual para dados legados;
- exibe “não definido” como erro acionável, nunca espaço vazio;
- arestas distinguem recebe, delega, executa em paralelo, depende e entrega;
- preview e recurso aplicado devem produzir a mesma topologia.

Testes obrigatórios:

- restaurante orquestrado com responsabilidades visíveis;
- pipeline com três stages e dependências;
- atualização de setor preservando/mudando membros;
- fixture legada sem `role` aparece com fallback e pendência;
- nenhuma ficha ou linha do Flow pode renderizar vazia.

## 12. Aplicação, aprovação e teste real

Estender a saga existente; não criar uma segunda engine.

Ordem recomendada:

1. validar hash, ownership, versão e inventário;
2. adquirir lease da operação;
3. aplicar organização;
4. criar/reusar recursos sem ativá-los;
5. configurar topologia e grants de leitura;
6. criar Sources/destinos;
7. testar conexões e Sources;
8. criar Monitors/Flows/Routines como draft;
9. conceder ações de Apps aprovadas;
10. publicar/ativar somente o que passou e foi aprovado;
11. executar acceptance tests;
12. recalcular checklist/readiness;
13. concluir e publicar links em Activity.

Cada step registra status, resourceMap e compensação. Resume continua da mesma operação.
Rollback remove somente o que a operação criou e que não foi alterado depois. Dados e
recursos compartilhados não são apagados por compensação automática.

“Pronto” exige teste observável, não apenas documento existente.

## 13. Testes de aceitação do Arquiteto

Criar tipos de teste sem efeitos e com efeitos controlados:

- source test: conexão, schema, mapping e freshness;
- channel test: entrada chega ao agente certo;
- agent contract test: entrada e saída válidas;
- flow test: rota, dependências e handoff;
- app dry-run quando suportado;
- database permission test;
- monitor simulation com anterior/agora;
- delivery test com destino de teste ou confirmação humana.

O resultado entra em Activity e no checklist. Teste com mock não substitui pelo menos um
caminho de integração real de cada domínio canônico.

## 14. Exclusão e arquivamento de andar

### 14.1 Princípio

Arquivar é o padrão recuperável. Purge é separado, explícito e só acontece após análise de
impacto atualizada. O último andar ativo continua protegido conforme a regra do domínio.

### 14.2 API proposta

- `GET /api/floors/:id/deletion-impact` — análise owner-scoped;
- `POST /api/floors/:id/archive` — desativa entrada e preserva dados;
- `POST /api/floors/:id/restore` — restaura sem ativar automaticamente operações;
- `POST /api/floors/:id/purge` com `{ impactHash, confirmationName, choices }`;
- rota DELETE legada: somente andar vazio ou `409 impact_required`, sem cascade oculto.

O impacto deve listar contagens, nomes relevantes e ação prevista para:

- setores e agentes;
- conhecimentos e memórias;
- Databases/datasets;
- Sources, Live e recorders;
- Monitors, Flows e rotinas;
- canais;
- grants e vínculos entre andares;
- Apps/installations;
- histórico e auditoria;
- dependências vindas de outros andares.

Calcular `impactHash` sobre IDs, versões/updatedAt e escolhas. Se algo mudar antes da
confirmação, devolver conflito e exigir nova revisão.

### 14.3 Regra de propriedade e compartilhamento

- recurso exclusivo e pertencente ao andar: arquivar/desativar; purge somente se a pessoa
  escolher e não houver dependente externo;
- recurso compartilhado: manter e remover apenas grant/vínculo daquele andar;
- App instalado na empresa: preservar instalação por padrão e revogar grants dos agentes
  removidos;
- conexão dedicada ao andar: oferecer remoção somente se nenhum outro recurso a usa;
- Database corporativo: preservar dados e remover acesso;
- histórico/auditoria: preservar pela retenção e anonimizar referências quando necessário;
- dependência externa: bloquear purge ou marcar “será mantido” com motivo.

Nunca inferir que uma conexão pertence ao andar só porque os agentes dele a usam.

### 14.4 Confirmação na UI

O diálogo deve dizer, antes do clique:

> Excluir “Atendimento” afetará 3 setores, 8 agentes, 4 Flows, 2 monitores, 2 fontes,
> 1 Database e 6 permissões de Apps.

Separar visualmente:

- será arquivado;
- será excluído;
- será desvinculado;
- continuará existindo;
- bloqueia a exclusão.

Exigir digitar o nome do andar para purge. Não usar confirmação genérica “tem certeza?”.
Depois, mostrar resultado real com removidos, mantidos e falhas retomáveis.

## 15. APIs do assistente e Blueprint V2

Preservar `/api/architect/projects` V1 e adicionar versão explícita ou negociação segura:

- `POST /api/architect/assistant/turn` — classifica e responde/projeta/opera;
- `GET /api/architect/context` — resumo do contexto atual;
- `POST /api/architect/projects` com `blueprintVersion: 2`;
- `GET/PATCH /api/architect/projects/:id/blueprint`;
- `GET /api/architect/projects/:id/inventory-diff`;
- `POST /api/architect/projects/:id/validate`;
- `POST /api/architect/projects/:id/simulate`;
- `POST /api/architect/projects/:id/apply`;
- `POST /api/architect/projects/:id/resume`;
- `POST /api/architect/projects/:id/rollback`;
- `POST /api/architect/projects/:id/acceptance-tests`;
- `POST /api/architect/projects/:id/recheck`.

Usar códigos de erro estáveis, rate limit, budget gate, cancelamento e auditoria. Conversa,
prompt, payload externo e segredos não entram em logs integrais.

## 16. Migração e compatibilidade

- leitores aceitam V1 e V2;
- V1 aplicado permanece explicável e editável;
- criar conversor V1 → V2 que preserve keys/resourceMap e marque o que não pode inferir;
- não converter projeto aplicado automaticamente sem backup/version stamp;
- projetos novos usam V2 após feature flag;
- rollout por conta e rollback da flag;
- índices e backfills idempotentes;
- nenhuma instalação, grant ou fonte ativa é alterada pelo backfill;
- links e bookmarks atuais continuam funcionando;
- atualizar templates da Comunidade para instalar como proposta V2, nunca aplicação direta.

## 17. Segurança e governança

- ownerId em toda consulta e mutação;
- IDs do modelo sempre recusados/removidos;
- secrets apenas no Vault/instalação e injetados na execução;
- capability e grant reconferidos imediatamente antes do uso;
- deny continua vencendo conforme cada domínio;
- ações write/high-risk nunca ampliadas por fallback;
- destructive proposal exige impacto atual e confirmação;
- páginas/URLs passam pelo Browser Worker e visão somente com gate;
- código comunitário passa pelo runtime isolado e kill switch;
- limites de tokens, recursos, profundidade, nós, chamadas e tempo;
- proteção contra duas rodadas/aplicações simultâneas;
- auditoria sem conteúdo sensível;
- provenance em resposta atual: fonte, instante e transformação.

## 18. Observabilidade

Registrar métricas e eventos para:

- modo escolhido pelo roteador;
- perguntas diretas versus propostas;
- tokens, reparos e falhas do provider;
- inventário e diff calculados;
- validações e issues por tipo;
- cada step da saga;
- acceptance tests;
- alterações destrutivas e impacto;
- recursos criados/reusados/atualizados;
- tempo até operação pronta;
- drift detectado após aplicação.

Activity deve correlacionar assistant turn → project → apply operation → resource → test →
execução real.

## 19. Fases executáveis

### Fase 0 — caracterização e ADRs

- testes que reproduzem as 13 lacunas da seção 4;
- ADR de intent routing, Blueprint V2, inventário e exclusão;
- mapa dos serviços canônicos e seus contratos atuais;
- nenhuma mudança funcional nesta fase.

### Fase 1 — inventário e dependências

- `OfficeInventory`, summary, adapters e DependencyGraph;
- owner scope e paginação;
- testes de conta cruzada, recurso compartilhado e limites.

### Fase 2 — contratos V2

- tipos, validação, hash, diff, limites e conversor V1;
- schemas para Resources/Operations/Access/Tests;
- testes unitários de referências, ciclos e compatibilidade.

### Fase 3 — Brief, intenção e compilador

- roteador dos quatro modos;
- Brief V2;
- classificação composta;
- compilador determinístico;
- resolução exata de App actions e canais;
- testes de dólar, restaurante, salão e CXSE3.

### Fase 4 — Flow e atualização estrutural

- responsabilidade obrigatória;
- topologia completa;
- update de membros/coordenador/stages/movimentos;
- correção do preview vazio;
- testes backend, frontend e E2E.

### Fase 5 — saga ampliada

- resources/operations/grants;
- approvals por item/ação;
- idempotência, resume e rollback;
- falhas injetadas em cada fronteira.

### Fase 6 — acceptance tests e readiness

- testes reais por domínio;
- readiness baseado em prova;
- Activity correlacionada;
- ativação/publicação somente após gates.

### Fase 7 — chat global

- provider único no AppLayout;
- UI flutuante desktop/mobile;
- contexto da tela;
- central de projetos e histórico;
- acessibilidade e 320 px.

### Fase 8 — exclusão de andar

- impacto completo e hash;
- archive/restore/purge;
- tratamento de recursos compartilhados;
- diálogo e resultado detalhados;
- concorrência, falha parcial e retomada.

### Fase 9 — migração e rollout

- backfill/conversor;
- feature flag;
- templates da Comunidade;
- documentação operacional e rollback.

### Fase 10 — hardening final

- full suite, segurança, performance, acessibilidade e deploy;
- remover flag apenas após critérios de saída;
- relatório final baseado no estado real.

Não marcar uma fase como concluída se um caminho essencial estiver mockado ou se a UI
afirmar uma criação que o backend não realizou.

## 20. Cenários obrigatórios de aceitação

### A. Pergunta atual, sem mutação

Entrada: “Qual o valor do dólar hoje?”

- modo `answer`;
- usa ferramenta/fonte atual autorizada;
- informa valor, par/moeda, fonte e horário;
- não cria projeto, agente, Source, Monitor ou Flow;
- falha honestamente sem fonte atual.

### B. Trading

Entrada: “Observe CXSE3 e me avise quando o RSI ficar abaixo de 30.”

- identifica que precisa de provedor B3;
- pergunta timeframe e canal somente se não inferíveis;
- reutiliza provider/candles/tool existentes quando compatíveis;
- propõe Source + history/live + RSI + Monitor + Flow + agentes + delivery;
- campo ausente nunca vira zero;
- fonte testada antes de ativar;
- simulação mostra disparo e não disparo;
- evento real dispara um único Flow e aparece em Activity.

### C. Restaurante

Entrada: “Automatize atendimento e reservas pelo WhatsApp.”

- Knowledge de cardápio/políticas fica pendente se não fornecido;
- seleciona ações exatas de WhatsApp e Calendar;
- recepcionista, reserva e handoff têm responsabilidades visíveis;
- teste ponta a ponta confirma entrada, disponibilidade, criação controlada e resposta;
- escrita no Calendar exige o grant correto.

### D. Salão existente

Entrada: “Adicione recepção e agenda ao meu salão.”

- inventaria e reutiliza andar/agentes/Calendar existentes;
- não duplica cliente, agenda ou canal;
- propõe Database de serviços/clientes apenas se ausente;
- regras de duração, profissional, intervalo e aprovação aparecem como pendência;
- mudança posterior atualiza a mesma estrutura.

### E. Flow de setor

- nenhum agente aparece com função vazia;
- coordenador e membros têm arestas corretas;
- paralelismo e pipeline aparecem distintos;
- preview e estrutura aplicada coincidem.

### F. Exclusão de andar

- impacto lista organização, recursos, operações e grants;
- shared App/Database é preservado;
- grants do andar são removidos;
- conexão exclusiva só é removida com escolha explícita;
- hash velho é recusado;
- falha no meio é retomável;
- resultado informa removidos e mantidos;
- outra conta nunca é afetada.

## 21. Testes e comandos obrigatórios

### Backend unitário

- intent router;
- Brief/Blueprint V2 normalization e limites;
- compilação determinística;
- referências/ciclos;
- App action resolution;
- channel binding;
- dependency graph;
- hash/diff;
- floor impact;
- conversão V1/V2;
- segredo e payload hostil.

### Backend integração

- ownership em todas as novas rotas;
- inventário completo;
- apply/reapply/resume/rollback;
- Sources/Monitors/Flows reais;
- grants exatos;
- acceptance tests;
- purge concorrente e recurso compartilhado;
- Activity correlacionada.

### Frontend/E2E

- chat global em rotas diferentes;
- persistência ao navegar;
- resposta simples sem projeto;
- proposta completa e diff;
- responsabilidades do Flow;
- aprovações por ação;
- conexão pendente;
- falha retomável;
- diálogo de exclusão e impacto;
- teclado, leitor de tela, contraste e 320 px;
- pelo menos os cenários A–F contra API real de teste, sem stub genérico escondendo erro.

Executar ao final:

```bash
npm ci
npm run build
npm run test -w backend
npm run test:runner
npm run test:browser-worker
npm run test -w frontend
npm run lint -w frontend
npm run test:e2e -w frontend
npm run smoke
npm run secret-scan
git diff --check
```

Registrar números reais. Corrigir a causa de qualquer falha; não reduzir assertions,
adicionar retry ou substituir integração por mock para obter verde.

## 22. Entregáveis e critérios de conclusão

Entregar:

- ADRs;
- contratos V2 e compatibilidade V1;
- migrações/índices com rollback;
- APIs e UI global;
- inventário/diff/impact;
- saga e acceptance tests;
- documentação de segurança/deploy;
- `OFFICE_ARCHITECT_BLUEPRINT_V2_PROGRESS.md` atualizado por fase;
- `OFFICE_ARCHITECT_BLUEPRINT_V2_REPORT.md` somente na conclusão.

O trabalho só termina quando:

1. o Arquiteto é a porta principal sem remover editores avançados;
2. responde perguntas sem criar estrutura desnecessária;
3. cria/expande/corrige toda a cadeia Organization + Resources + Operations;
4. usa ações exatas e permissões reais;
5. não duplica recursos existentes;
6. Flow nunca mostra responsabilidade vazia;
7. CXSE3 produz proposta tecnicamente completa e testável;
8. restaurante e salão passam nos testes ponta a ponta;
9. exclusão de andar mostra e respeita impacto completo;
10. recursos compartilhados e dados históricos são preservados;
11. todas as suites passam no commit final;
12. o relatório final descreve limitações verdadeiras, sem declarar como pronto o que
    ficou parcial.
