# Office Platform — Resources, Databases, Monitors e Community

Progresso da execução de `OFFICE_PLATFORM_RESOURCE_COMMUNITY_GOAL.md`. Este arquivo é o
que permite continuar sem reler a implementação inteira: cada fase registra o commit
verde, o que foi feito, o que foi conferido e qual é a próxima ação exata.

## Baseline

- branch: `development`
- commit base: `d0d2ade` (2026-09-01) — igual ao `origin/development` no início; a base
  auditada pelo objetivo confere, sem diferenças a registrar
- `main` permanece em `0393b20` e não é tocada

### Comandos do baseline (nomes reais do repositório)

| comando | exit | resultado |
|---|---|---|
| `npm run secret-scan` | 0 | 2106 arquivos, nada encontrado |
| `npm run lint -w frontend` (`oxlint`) | 0 | só avisos de fast-refresh pré-existentes em `i18n/index.tsx` |
| `npm run test -w backend` | 0 | 1354 + 1617 testes |
| `npm run test -w frontend` (vitest) | 0 | 286 testes |
| `npm run build` | 0 | frontend + backend |
| `npm run test:e2e -w frontend` | 0 | 615 passaram, 17 pulados |
| `npm run smoke` | 0 | 6 casos + prontidão + SIGTERM |

`npm ci` não foi executado: as dependências já estão instaladas e reinstalar não faz
parte de conferir a base — se algum comando falhasse por dependência, aí sim.

## ADR 001 — Quatro camadas, uma fonte canônica por tipo

**Contexto.** O produto cresceu por subsistemas independentes (Knowledge, Apps, Tools,
histórico, automações). Cada um resolve dono e acesso do seu jeito, e a interface mistura
"o que existe" com "quem pode usar".

**Decisão.** Separar em Organization, Resources, Operations e Platform, e criar uma camada
de contrato comum para LISTAR, REFERENCIAR e EXPLICAR acesso — sem mover dado nenhum.

**O que NÃO fazemos, e por quê.** Uma supercoleção polimórfica de recursos parece
simplificar e cobra depois: cada tipo tem ciclo de vida, validação e política próprios, e
uma tabela comum vira um `if` por tipo em todo lugar, com o agravante de ter duas verdades
sobre o mesmo objeto. A projeção de catálogo guarda só metadado reconstruível.

**Consequência.** Toda regra de acesso continua morando no subsistema que a entende. A
camada comum delega — e delegar é o ponto: uma abstração que enfraquece o gate do App para
caber no formato genérico é pior que não ter abstração.

## Matriz canônico versus projeção

| Domínio | Fonte canônica | Projeção/derivado | Nunca copiado |
|---|---|---|---|
| Knowledge | `knowledge_documents`, `knowledge_chunks`, `knowledgeAccess.ts` | resumo no catálogo (id, título, dono, estado) | conteúdo, chunks, embeddings |
| App | `app_definitions`, `connections` (instalação), grants no agente | resumo (appKey, nome, risco das ações) | credenciais, tokens, config de conexão |
| Tool | coleção `tools` | resumo (nome, risco, runtime, estado) | segredo cifrado, headers, corpo |
| Database | (Fase 3) `data_stores`, `dataset_definitions` + adapters | resumo (nome, adapter, datasets, freshness) | registros, séries, credencial da fonte |
| Monitor/Flow | `automations` + `automation_versions` | estado ao vivo | payload integral, prompt, resposta |
| Extension | (Fase 7) `extension_packages`, `extension_versions` | catálogo | secret, dado do autor, config local |

## Fases

### Fase 0 — Baseline e ADR ✅ `c9e4bfe`

Baseline reproduzido, ADR e matriz acima registrados. Nenhum comportamento alterado.

### Fase 1 — Resource contracts e access facade ✅

`backend/src/resources/`: `types.ts` (contratos, catálogos de capacidade e a trava
`agentCapabilitiesOnly`), `scope.ts` (sujeito resolvido pelo servidor, com a hierarquia
lida agora e não copiada para dentro de grant), `registry.ts`, `catalog.ts`, `access.ts`,
`audit.ts` e adapters de LEITURA para Knowledge, App e Tool.

Decisões que valem registro:

- a camada comum **delega**. Knowledge decide pela política de conhecimento (a mesma que
  roda quando o agente responde), App pelos três gates (instalação utilizável + ação
  concedida + escrita autônoma), Tool por atribuição + habilitada + escrita autônoma. Uma
  regra genérica de herança por cima disso só poderia afrouxá-los;
- `database` está no contrato e **não** tem adapter: um adapter vazio responderia "nada
  encontrado" como se fosse verdade. Ele chega na Fase 3;
- escopo de outra conta responde 404 na rota, e não 200 com lista vazia — a diferença
  entre "não é seu" e "está vazio" é o que um inventário de contas alheias precisa;
- pendência ≠ acesso: conexão pausada, versão incompatível, App "em breve" e ferramenta
  desligada aparecem com código e ação corretiva, nunca como acesso funcional;
- `RESOURCE_PLATFORM_ENABLED=0` **nega a rota** (404), não só esconde a tela.

Rotas (leitura; mutação continua nas rotas canônicas de cada tipo):
`GET /api/resources`, `/:kind/:id`, `/:kind/:id/access`, `/:kind/:id/impact` e
`GET /api/agents/:id/resource-access`.

Testes: 22 em `backend/test/resources.integration.test.mjs` — isolamento entre contas nas
quatro entradas, recusa idêntica para id inválido/inexistente/alheio, delegação de
Knowledge com origem correta, atribuição como permissão de Tool, escrita exigindo
autorização, os três gates de App, matriz mostrando o negado com motivo, impacto separando
pode-usar de usou, e a flag negando. **Teeth**: revertendo a exigência de escrita autônoma,
a flag e a trava de capacidade, caem 3 testes.

Suíte: 1354 + 1640, verde.

### Fase 2 — UI organizacional e Access do agente ✅

- `navConfig.ts` ganhou o grupo **RECURSOS** e renomeou os outros: ESCRITÓRIO, RECURSOS,
  OPERAÇÕES. Apps e Históricos saíram de "controle" — "o que o escritório possui" e "o que
  aconteceu" eram duas perguntas no mesmo grupo. **COMUNIDADE não entrou**: um item de menu
  que leva a uma tela inexistente promete e não entrega; ele chega com o Marketplace.
- `pages/Resources.tsx` (`/resources`): catálogo global com filtro por tipo na URL, busca e
  os quatro estados distintos. Dono e estado aparecem separados — confundi-los é o que faz
  alguém achar que um App conectado está disponível para todo agente.
- `components/ResourceAccessMatrix.tsx` na página do agente: mostra o **negado** com o
  motivo, e a pendência com a ação. A pergunta que alguém traz até essa tela é quase sempre
  "por que ele não usa aquilo?", e uma matriz só do permitido não a responde.
- `components/FloorResources.tsx`: contagens do andar vindas do MESMO catálogo, filtradas
  por escopo — uma segunda lista divergiria na primeira regra esquecida.
- Rotas antigas preservadas: nenhuma foi movida ou removida nesta fase.

Defeito encontrado pelo smoke: os atalhos de recurso no andar nasceram com alvo de toque
de 26 px, abaixo do mínimo de 44. Corrigido no link (o `Badge` desenha; quem precisa ser
tocável é o link).

Testes: 6 novos em `frontend/e2e/resources.spec.ts` (lista com dono e estado, filtro e
busca com o tipo na URL, erro que não vira vazio, vazio dito como vazio, 320 px sem
overflow, grupos da navegação) e o teste de navegação atualizado. Vitest 287, E2E 621,
smoke 6, lint sem erro novo.

### Fase 3 — Data Stores/Databases (backend) ✅

`backend/src/databases/`: `types.ts`, `store.ts` (stores, datasets, grants, telemetria,
cotas e índices), `queryDsl.ts`, `schemaValidation.ts`, `access.ts`, `adapters.ts` e
`agentTools.ts`. Rotas em `routes/databaseRoutes.ts` (`/api/databases`).

Decisões que valem registro:

- **nenhum registro é copiado**. `data_history` lê a coleção que os recorders já
  alimentam; `market_data` lê `market_candles` e é somente leitura, porque candle e
  indicador vêm de um pipeline que já sabe fechar janela e deduplicar. Duplicar criaria
  duas séries com o mesmo nome e valores diferentes;
- **DSL fechada, não lista de bloqueio**. Não existe lista de bloqueio confiável para uma
  linguagem inteira: `$where` executa JavaScript, `$lookup` atravessa coleções, um
  `$regex` mal construído derruba o banco. O que passa é campo declarado no schema, sete
  operadores, `and`/`or` com teto de profundidade **e de nós** (mil irmãos têm
  profundidade 1 e derrubam igual), ordenação por campo conhecido e limite do servidor;
- **o prefixo `value.` é do servidor**: um campo chamado `ownerId` no schema vira
  `value.ownerId` e nunca alcança a raiz do documento, onde moram escopo e identidade;
- **precedência**: `deny` vence sempre; direto > setor > andar > prédio; sem grant, sem
  acesso. A hierarquia é lida na hora — tirar o agente do setor tira o acesso na próxima
  execução, sem limpar grant nenhum;
- **mutabilidade é do dataset e independe de grant**: `append_only` recusa update/delete
  mesmo para quem administra a conta, porque alterar o passado de uma série não é uma
  questão de permissão;
- **a permissão é reconferida imediatamente antes de cada leitura** da ferramenta, e não
  ao montar a lista: entre montar e o modelo chamar cabe uma revogação;
- **credencial não entra na config do adapter** — qualquer chave com cara de segredo é
  recusada na escrita, porque a config viaja para a tela e para o catálogo;
- `DATABASES_ENABLED=0` **nega a rota**.

Testes: 30 em `backend/test/databases.integration.test.mjs` — DSL (campo, operador,
operador de Mongo como valor, bomba por profundidade e por contagem, escape do
`contains`, tetos), schema, precedência completa com deny, membership que muda o acesso,
dataset restrito, store pausado, mutabilidade, consulta real sem cópia, isolamento entre
contas com o MESMO recorder, telemetria sem conteúdo, ferramentas do agente (sem grant não
existem; revogação bloqueia a próxima chamada; o motivo do filtro recusado volta), rotas e
flag. **Teeth**: revertendo a precedência do deny e a lista de campos da DSL, caem 3.

Suíte: 1354 + 1670, verde. Vitest 287, smoke 6.

### Fase 3 (continuação) — catálogo e UI ✅

- `resources/adapters/databaseAdapter.ts` registrado: Database entra no catálogo comum,
  na matriz do agente e na análise de impacto, delegando a decisão para
  `databases/access.ts`. `availableKinds()` agora devolve os quatro tipos.
- `pages/Databases.tsx` (`/databases`) + `lib/databases.ts`: lista com a ORIGEM dita em
  voz alta (mercado não é memória nem conhecimento), detalhe com datasets e mutabilidade,
  criação de dataset por `campo:tipo` (JSON cru na tela é pedir para errar), e consulta
  mostrando "quantos vieram de quantos existem" — a diferença muda a conclusão de quem lê.
- Item **Databases** na navegação, em RECURSOS. `/historicos` permanece: ele é a REGRA de
  gravação e Databases é o recurso que a expõe; mover a rota agora quebraria bookmark por
  uma reorganização que ainda não terminou.

Testes: 7 em `frontend/e2e/databases.spec.ts`. E2E 628, smoke 6, secret-scan limpo.

### Fase 3 (conclusão) — grants na tela ✅

`components/DatabaseGrants.tsx`: conceder, negar e remover, com o IMPACTO antes de salvar.
Conceder a um setor não vale para "o setor" — vale para cada agente que está nele agora e
para quem entrar depois, e quem concede vê isso antes de confirmar. `deny` é uma escolha
explícita, porque ele vence qualquer allow herdado e uma exceção que não pode ser dita
vira remoção de acesso legítimo. A tela também mostra quem consegue consultar HOJE, com a
origem — que é o resultado de toda a precedência, e não a soma dos grants.

4 testes E2E novos (11 no arquivo). E2E 632, backend 1354 + 1670, smoke 6.

**A Fase 3 está completa**, com uma exceção declarada: `external_app` recusa consulta com
`not_implemented`. Um adapter que respondesse vazio seria pior que a recusa honesta.

## Pendências honestas

- Migração 9.2 (Data Store padrão apontando para recorders existentes, em dual-read) não
  começou. Ela não bloqueia nada: databases novos funcionam, e os históricos existentes
  continuam pelo caminho de sempre.

### Fase 4 (parcial) — versões imutáveis de ferramenta ✅

`backend/src/toolVersions.ts` + rotas `GET/POST /api/tools/:id/versions`.

- **nenhuma ferramenta existente foi tocada.** `runtimeKind` e `version` são DERIVADOS na
  leitura (`describeLegacyTool` → `http`, `0.0.0`). Uma migração que carimbasse o campo em
  massa mudaria o `updatedAt` de tudo o que já roda para gravar o que dá para calcular. Um
  teste afirma que publicar não altera a ferramenta e que o documento não ganha campo;
- **versão publicada é imutável e tem hash.** "Instalei a ferramenta X" só significa algo
  se X não puder mudar por baixo; senão a permissão revisada ontem vale para outro
  comportamento hoje. O hash ignora a ORDEM das chaves — uma reescrita cosmética não pode
  virar "versão diferente" na conferência;
- **output schema é exigido no publicável**: sem contrato de saída, quem instala descobre
  a forma do retorno testando em produção;
- **`runtimeKind: code` é fail-closed**: sem `CODE_TOOLS_ENABLED=1` a publicação é
  recusada com código próprio. O risco de código é `high_risk` por definição — declarar
  `read` seria otimismo sobre algo que ainda não roda em sandbox nenhuma;
- o risco de HTTP vem do MÉTODO, não do que alguém digitou.

Testes: 12 em `backend/test/toolVersions.integration.test.mjs`. **Teeth**: revertendo a
imutabilidade, o fail-closed do código e a exigência de output schema, caem 3.

Suíte: 1354 + 1682, verde.

### Fase 4 (conclusão) — os runtimes executando de verdade ✅ `e256dbd`

`backend/src/executors/toolExecutor.ts`, `builtinTools.ts`, `toolVersions.ts`, rota de
versões e `backend/test/toolRuntimeDispatch.integration.test.mjs`.

- **a versão publicada decide o runtime.** `activeRuntimeVersion` é lida na execução; sem
  versão, a ferramenta cai no caminho HTTP de sempre — nenhuma migração, nenhum campo novo
  no documento. Um teste afirma que a ferramenta sem versão continua chamando a URL dela, e
  que publicar uma versão `http` também não desvia nada;
- **nenhum mecanismo novo.** `app_action` vai pelo mesmo `executarAcaoDeApp` do executor do
  agente (grant → instalação → compatibilidade de versão → escrita autônoma), e
  `registered_function` pelo mesmo `executeRegisteredFunction`. Um segundo caminho seria um
  segundo lugar onde a permissão é decidida, e no dia em que divergissem um autorizaria o
  que o outro recusa;
- **a autorização é reconferida dentro da chamada**, relendo o agente do banco. Entre
  montar a lista de ferramentas e o modelo decidir chamar cabe uma revogação. Dois testes
  cobrem isso: a ferramenta tirada do agente depois da montagem não executa, e o agente
  apagado não executa nada;
- **entrada e saída conferidas contra o contrato PUBLICADO**, não contra o do documento.
  Sem a conferência de saída, `outputSchema` é enfeite: quem instala encadeia o resultado
  confiando numa forma que ninguém verifica;
- **limite por execução** (`maxCallsPerRun`, padrão 5) e **trilha por chamada**
  (`tool_version_calls`) com o hash do que rodou — nunca argumento, nunca resposta. Recusa
  é gravada como recusa, e não como execução;
- **o manifesto é conferido na publicação**: uma versão imutável não pode nascer sem dizer
  qual App/ação ou qual função ela executa. A EXISTÊNCIA da função fica para a execução, de
  propósito — ela depende do que este servidor tem registrado, e isso muda entre deploys;
- `code` continua fail-closed: publicar exige `CODE_TOOLS_ENABLED=1`, e executar responde
  que o runtime isolado ainda não roda.

Testes: 14 novos. **Teeth**: desligando o desvio por versão caem 8; trocando a releitura do
agente pela cópia em memória caem 2. Bateria do backend: 1712/1712.

## Pendências honestas da Fase 4

- Editor de versões na tela não foi feito (a trilha já sai em `GET /api/tools/:id/versions`).
- Migração 9.2 (Data Store apontando para recorders existentes) segue pendente.

## Defeito de ambiente encontrado

Uma execução da suíte acusou 31 falhas em testes que sobem o app inteiro. Não era código:
um `npm run build` morto no meio deixou `dist` desatualizado e processos de teste órfãos
disputando CPU e portas. Depois de limpar, a mesma suíte passou inteira. Vale registrar
porque a leitura errada aqui seria "a Fase 4 quebrou a autenticação".

### Fase 5 (núcleo) — Condition AST e MonitorState ✅

`backend/src/monitors/condition.ts` e `state.ts`.

- **borda é diferente de nível.** "RSI cruzou 30 para cima" não é "RSI está abaixo de 30":
  a primeira só existe comparando o agora com o antes. Os seis modos (`level`, `enter`,
  `exit`, `cross_up`, `cross_down`, `change`) são testados um a um, inclusive o caso em que
  não há valor anterior — o primeiro tique não inventa uma travessia;
- **o estado mora no banco.** Guardá-lo na memória do processo funcionaria até o primeiro
  restart, e restart é justamente quando ninguém está olhando;
- **a transição é atômica**: `findOneAndUpdate` com a versão anterior no filtro. Quem perde
  a corrida sai como `lost_race` sem disparar;
- **a marca do evento vem antes de tudo**: a mesma entrega processada duas vezes não é
  transição nova. A ordem importa — conferir isso depois do debounce faria um evento
  repetido consumir a janela de um evento legítimo;
- **debounce e cooldown medem coisas diferentes**: distância da última observação e do
  último disparo. Um monitor com os dois iguais não tem os dois;
- **zero token**: nada no caminho chama modelo. Um modelo avaliando condição a cada tique
  custa por tique, erra de vez em quando e não é reproduzível.

**Defeito real encontrado pelo teste**: `Number(null)` é 0, e `0 < 30` fazia um campo
AUSENTE disparar um monitor de "abaixo de 30" — o alarme que toca sozinho de madrugada.
Ausência agora é `null`, e comparação com `null` é falsa.

Testes: 16 em `backend/test/monitors.integration.test.mjs`. **Teeth**: revertendo o dedupe
por evento, cai 1. A janela de corrida entre eventos DISTINTOS simultâneos não tem teste
determinístico, e o teste diz isso em vez de fingir que tem.

Suíte: 1354 + 1698, verde.

### Fase 5 (conclusão) — o monitor acionando o Flow ✅ `e8e3601`

`backend/src/monitors/dispatch.ts`, `service.ts`, `routes/monitorRoutes.ts`,
`frontend/src/pages/Monitors.tsx` e os testes
`monitorFlowDispatch.integration` (15) + `monitorService.integration` (15) +
`e2e/monitors.spec.ts` (5).

- **quem executa é o motor que já existe.** O disparo chama `createRun` da automação:
  mesma fila (inserir É enfileirar), mesmas leases, mesma versão PUBLICADA, mesmo
  `ExecutionRoot`, mesma auditoria. Um executor próprio aqui seria um segundo lugar
  decidindo retry, concorrência e idempotência;
- **exatamente uma execução por transição**, por duas guardas independentes: a transição
  atômica do `observe()` (dois workers, um vence) e a chave de idempotência derivada do
  EVENTO (`<monitorId>:mon:<eventId>`), que faz o reprocessamento encontrar a execução que
  já existe em vez de criar outra;
- **a conferência do Flow vem ANTES de observar.** Observar consome a borda e arma o
  cooldown; se o Flow sumiu, foi pausado ou nunca foi publicado, consumir a borda jogaria o
  alerta fora em silêncio. Em vez disso o monitor fica DEGRADADO com a borda intacta — e o
  `markDegraded` passou a criar o estado quando ele não existe, senão um monitor quebrado
  antes da primeira observação não deixava marca nenhuma;
- **o restart não perde o alerta.** `pendingDispatch` é gravado na MESMA operação atômica
  que reconhece a borda, e limpo quando a execução existe. `resumePendingDispatches()` roda
  no arranque do motor; retomar usa a mesma chave, então nunca cria uma segunda execução;
- **rascunho obrigatório**: salvar nunca publica, e editar um monitor publicado o devolve
  para rascunho. Um monitor sem Flow não publica — publicado sem ação seria um rascunho
  mentindo;
- **a condição é montada de listas fechadas.** Num dataset os campos vêm do schema
  declarado; num evento da plataforma não existe schema declarado neste repositório, então
  o que se confere é a FORMA do nome (identificador simples, sem `$` e sem ponto). Inventar
  uma lista de campos de evento seria uma segunda verdade envelhecendo sozinha;
- **zero token no caminho inteiro**: condição, borda e enfileiramento não chamam modelo. O
  teste de aceitação mede `usage.inputTokens + outputTokens === 0` depois do `processRun`.

**Teeth**: sem a conferência do Flow caem 4; sem a marca atômica de intenção e com chave de
idempotência aleatória caem 2 (inclusive o de aceitação).

## Pendências honestas da Fase 5

- `operationKind` (`routine | flow | monitor`) não foi introduzido nas automações: o Flow
  ainda é uma automação como qualquer outra, e a tela de monitores lista todas.
- A fonte `database` de monitor é aceita e validada, mas **nada a alimenta ainda**: só o
  barramento de eventos chama `observarEvento`. Ligar o recorder ao `observe()` é o que
  falta para um monitor de dataset observar sozinho.
- O construtor é o de listas fechadas; a versão "natural" (descrever em português) não foi
  feita.

### Fase 6 — Activity unificada ✅ `dc1245b`

`backend/src/activity/timeline.ts`, `routes/activityRoutes.ts`, `frontend/src/lib/activity.ts`,
`pages/Activity.tsx`.

- **projeção, não coleção.** A resposta de "o que aconteceu, do começo ao fim?" está em
  quatro coleções que já existem. Gravar uma quinta com o mesmo conteúdo criaria uma
  segunda verdade que envelhece — bastaria um passo falhar entre as duas escritas para o
  painel contar uma história que o histórico nega. Sem coleção nova, sem TTL novo, sem
  contagem própria;
- **a correlação do monitor viaja no `requestId`** (`monitor:<id>:<eventId>`), derivada do
  evento e sem payload: é o que liga a execução ao monitor sem gravar o que ele viu;
- **entrega contada UMA vez**, pelo passo que a executa. Contar também no nível da execução
  seria a duplicação hierárquica que o painel não pode ter;
- **nada de conteúdo**: nem payload de gatilho, nem prompt, nem resposta, nem documento. Um
  teste percorre a resposta inteira procurando o valor que o monitor observou;
- tempo real pelo socket que já existe, com janela de 1 s — um evento por passo faria uma
  requisição por passo;
- `MONITORS_ENABLED=0` passou a negar a rota de monitores de verdade.

Testes: 7 (projeção) + 6 (regras da tela) + 4 (e2e). **Teeth**: contando entrega no nível da
execução cai 1; vazando o payload do gatilho cai 1.

### Fases 7 e 8 — Extension packages e Marketplace ✅ `b909338`

`backend/src/extensions/{types,packages,installs,backfill,templates}.ts`,
`routes/extensionRoutes.ts`, `frontend/src/pages/Marketplace.tsx`.

- **pacote, versão e instalação separados**, porque respondem a perguntas diferentes: o que
  existe, o que foi congelado e o que esta conta usa. Juntá-los faria editar um rascunho
  mudar o que já está instalado na conta de outra pessoa;
- **versão publicada é imutável e tem hash** (ordem de chaves não conta). Republicar o mesmo
  número é recusado pelo índice único E pela conferência;
- **credencial no manifesto impede publicar**, e a recusa diz o CAMINHO, nunca o valor. A
  DEFINIÇÃO do campo de credencial continua viajando — é ela que diz a quem instala o que
  fornecer;
- **o ciclo é um grafo**: `draft → testing → submitted → in_review → approved → published`,
  com suspensão e deprecação. Aprovar e publicar são da revisão, e a revisão fica gravada na
  versão. Suspender exige motivo, e o motivo é visível para quem instalou;
- **a instalação fixa a versão**: o autor publicar não muda o que já roda. Atualizar que
  amplia permissão é recusado sem aprovação explícita do diff;
- **desinstalar pausa e guarda**: o histórico de execução aponta para a instalação;
- **a contagem de instalações vem do banco**, nunca de um contador — "3 mil instalações" é
  exatamente o número que convence, e um contador incrementado à mão diverge no primeiro erro;
- **backfill** dos Apps privados em pacote privado: idempotente, com dry-run, e
  `app_definitions` continua sendo a fonte. Ferramenta só vira pacote quando o autor pede —
  empacotar o trabalho de alguém por varredura é decidir por essa pessoa;
- **template é blueprint congelado**, aplicado pelo Arquiteto que já existe: instalar abre a
  proposta e **nada é criado até alguém aprovar a prévia**. Memória, conversa, execução,
  documento, dado e credencial do autor não viajam — a recusa é na publicação, antes de
  alguém baixar;
- `COMMUNITY_MARKETPLACE_ENABLED=0` fecha catálogo e instalação com 404.

Testes: 26 + 9 + 6 (e2e). **Teeth**: sem a peneira de segredo, sem o grafo de estados e sem
a aprovação do diff caem 3.

### Fases 9 e 10 — Sandbox Runtime e código da comunidade ✅ `5c66e58`

`backend/src/extensionRuntime/{provider,scanner,broker,gate}.ts`.

**O estado real: código continua inexecutável, e isso é a entrega.** Não existe runner
isolado neste repositório, e por isso `CODE_TOOLS_ENABLED` permanece desligado. O que foi
construído é a fronteira que impede qualquer atalho.

- **nada executa neste processo.** Sem `eval`, `new Function`, `vm`, `child_process`, `exec`
  ou Python local — e um teste LÊ o fonte do diretório inteiro para afirmar isso, porque um
  teste que só chama a API não distingue "não executa" de "executa em outro lugar";
- **o provider padrão recusa tudo.** Fail-closed não é uma mensagem simpática: é o estado em
  que o sistema fica quando ninguém configurou nada. Um runner marcado `testOnly` não pode
  ser registrado em produção, e a recusa acontece no registro;
- **a flag não é a garantia.** `CODE_TOOLS_ENABLED=1` sozinho não libera: o `health()` é
  conferido item a item (não-root, FS somente leitura, rede negada, `no-new-privileges`,
  seccomp, efêmero, limpeza conferível). Aceitar o `ok: true` inteiro seria confiar em quem
  está do outro lado da fronteira para dizer se a fronteira existe;
- **scanner léxico com allowlist fechada** e SBOM lido do fonte. Ele tira comentários e
  conteúdo de string antes de procurar, e o achado devolve a LINHA, nunca o trecho. Está
  documentado no próprio arquivo que uma varredura léxica é derrotável — ela evita gastar
  execução com o que já dá para recusar de graça, e não substitui a sandbox;
- **capability broker**: o token nunca é gravado (só o hash), vale para UMA execução, tem
  usos contados e expira por TTL do banco. E a permissão é **reconferida no resolvedor
  canônico a cada uso** — o bilhete responde "pediu?", o resolvedor responde "ainda pode?";
- **kill switch** por pacote, versão ou hash, com motivo obrigatório, valendo na execução e
  na publicação;
- **revisão humana** exigida na primeira publicação e em mudança de permissão/runtime;
- o portão está LIGADO ao caminho real: `publishVersion` de `runtimeKind: 'code'` passa por
  ele, e a execução também.

Testes: 27, incluindo a suíte de ameaça. Bateria: 1354 + 1804, verde.

### Fase 11 (parcial) — migração 9.2, rollback e documentação ✅ `5c66e58`

`backend/src/databases/migration.ts` e as rotas `POST /api/databases/migrate/histories[/rollback]`.

- **nenhum registro é movido.** Os `data_history_records` continuam onde estão, com o mesmo
  `recorderId`; o que nasce é a projeção que os torna visíveis como Database. Mover milhões
  de linhas para uma tela nova encontrá-las seria pagar caro para não ganhar nada — e uma
  migração que reescreve dado é a que não dá para repetir quando falha no meio;
- **a chave do dataset É o id do recorder**, que é como o adapter o encontra: um campo a
  menos para a migração manter sincronizado. Um teste consulta pelo adapter depois de
  migrar, sem backfill nenhum;
- **idempotente e retomável**: o índice único do nome decide o store, e a chave decide o
  dataset. Um recorder criado depois entra numa segunda passagem;
- **rollback desfaz só o que a migração criou**: um dataset feito à mão depois fica, e o
  store fica de pé enquanto tiver algo dentro;
- schema derivado do que o recorder guarda; sem campos declarados ele fica ABERTO, em vez de
  declarar uma forma que não existe;
- `retentionDays` não é tocado, e Históricos continua sendo a regra de gravação — o
  dual-read é o efeito natural de a migração não escrever nada do lado antigo;
- `DEPLOYMENT_ENVIRONMENT_MATRIX.md` documenta as cinco flags (com o que cada `0` fecha de
  verdade) e as coleções novas.

Testes: 9. Bateria: 1354 + 1813 backend, verde.

## Próxima ação exata

1. Fase 11 — migração 9.2 (Data Store padrão apontando para os recorders existentes, com
   dual-read), fixtures e a bateria completa registrada.
2. Ligar o recorder de dataset ao `observe()` para a fonte `database` de monitor.
3. Escrever um `SandboxRuntimeProvider` de verdade (fora deste repositório) — enquanto ele
   não existir, `CODE_TOOLS_ENABLED` fica desligado e é isso que o portão garante.

## Pendências honestas das Fases 7 a 10

- **não existe runner isolado**: a fronteira, o scanner, o broker e o kill switch estão
  prontos e testados, mas nada executa código. `CODE_TOOLS_ENABLED` continua desligado;
- o scanner é **léxico**, não AST — está dito no arquivo e nos testes. Ele é a primeira
  peneira, nunca a defesa;
- o Marketplace não tem página de detalhe por item nem "reportar item": a lista mostra
  procedência, versão, permissões da atualização e motivo de suspensão, que é o que decide
  instalar ou não;
- revisão de pacote não tem tela: a transição existe na API, e o papel de revisor vem da
  plataforma (`res.locals.isReviewer`), não do corpo do pedido.
