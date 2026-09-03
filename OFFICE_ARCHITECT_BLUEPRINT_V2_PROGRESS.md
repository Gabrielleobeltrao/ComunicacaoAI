# Arquiteto Central e Office Blueprint V2 — progresso

Branch: `feat/office-blueprint-v2`, a partir de `development` em `7215e21`.

Este arquivo registra o que foi **feito e provado**, não o que foi planejado. Uma fase só é
marcada como concluída quando os testes dela passam e o caminho essencial existe de verdade.

---

## Fase 0 — caracterização e ADRs ✅

Nenhuma mudança funcional. O que esta fase entrega é a fotografia do defeito, para que a
correção seja visível no diff: sem ela, um conserto e uma regressão têm a mesma aparência.

### As 13 lacunas, verificadas no código

| # | Lacuna | Onde ela está | Como foi travada |
| --- | --- | --- | --- |
| 1 | Blueprint V1 não representa Databases, Sources, Live, Monitors, Flows, canais, entregas nem grants | `architect/types.ts` — `OfficeBlueprintV1` tem 6 listas | teste afirma quais campos existem e quais **não** existem |
| 2 | `liveDataNeeds` nunca é compilado | existe em `brief.ts`, ausente em `compile.ts` | teste prova que a necessidade não vira nem recurso nem pendência |
| 3 | Só 4 tipos reaproveitáveis | `links.ts:17` — `KINDS = ['floor','agent','sector','routine']` | teste lê a lista do fonte e afirma os 6 tipos ausentes |
| 4 | Um andar genérico, sempre `create` | `compile.ts:101` — `floorKey = 'operacao'` | teste com três áreas prova que sai **um** andar |
| 5 | `actionKeys: []` em todo requisito de App | `compile.ts:160` e `:226` | teste afirma a lista vazia em todos os requisitos |
| 6 | Canal conectado ganha do canal pedido | `compile.ts:216-219` | teste pede WhatsApp e recebe `web_chat` |
| 7 | Declarar App de canal não cria vínculo operacional | `apply.ts` não tem passo de canal | teste lista os 7 passos existentes e prova a ausência do oitavo |
| 8 | Revisão não atualiza a topologia | `apply.ts:266-278` — `update` só toca nome/cor/instrução/contratos | teste afirma o que o patch mexe e o que ele não mexe |
| 9 | Condição de dado vira cron | `compile.ts` — rotina nasce `schedule` com `0 8 * * *` | teste do RSI prova o cron inventado e a ausência de monitor |
| 10 | Simulação é estrutural | `simulate.ts` não importa domínio canônico nenhum | teste prova que nenhum subsistema é alcançado |
| 11 | Validador aceita agente sem responsabilidade | `validate.ts` | teste remove `role`/`objective`/contratos e não há erro bloqueante |
| 12 | "Montar operação" escondido no seletor de andares | `BuildingSwitcher.tsx:134`, `MobileFloorPicker.tsx:159` | E2E prova que não há chat global em `/`, `/monitoring` nem `/agents` |
| 13 | Exclusão de andar sem impacto | `floors.ts:258` — conta só agentes e setores | integração prova que andar com Source/Monitor/Flow é apagado como "vazio" |

### Testes desta fase

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectV2Characterization.test.mjs` | 11 | 11 passam |
| `backend/test/architectV2FloorImpact.integration.test.mjs` | 4 | 4 passam |
| `frontend/e2e/architect-v2-characterization.spec.ts` | 2 | 2 passam |

O caso mais grave está em `architectV2FloorImpact`: um andar com fonte de monitoramento,
monitor e Flow é considerado **vazio** e apagado, deixando os três órfãos apontando para um
andar que não existe mais.

### ADRs

Registrados em `docs/adr/` nesta fase:

- **ADR 001 — roteamento de intenção**: quatro modos com saída estruturada; a LLM classifica
  e descreve, o código decide e executa. Texto do modelo nunca é comando e nunca escolhe id.
- **ADR 002 — Blueprint V2 versionado**: `version: 2` ao lado do V1, sem reinterpretar o V1.
  Leitores aceitam os dois; conversor preserva `key` e `resourceMap`.
- **ADR 003 — inventário e grafo**: `OfficeInventory` completo para o código determinístico,
  `OfficeInventorySummary` para o modelo; o `DependencyGraph` serve a impacto e ordem, e
  **não** decide autorização — cada adapter continua decidindo.
- **ADR 004 — exclusão de andar**: arquivar é o padrão; purge é separado, exige `impactHash`
  e nome digitado; recurso compartilhado é preservado e apenas desvinculado.

### Pendências reais ao fim da fase

- Nenhuma. A fase 0 não muda comportamento, e é isso que ela promete.

---

## Fase 1 — inventário e dependências ✅

`backend/src/architect/inventory.ts`.

### O que passou a existir

**`OfficeInventory`** — completo, owner-scoped, com teto. Cada seção sai do **serviço
canônico** do domínio: `listFloors`, `listSectors`, `listAgents`, `listInstallations`,
`listDataStores`/`listDatasets`/`listGrants`, `listSources`, `describeMonitors`,
`listAutomations`, `listTools`. Nenhuma consulta direta a coleção que já tem dono.

**`OfficeInventorySummary`** — o que vai para o modelo, e só. Contagens, os primeiros nomes
e uma lista de "o que está pela metade". **Nenhum ObjectId**: um id no contexto é um id que
o modelo pode devolver, e um id devolvido pelo modelo é um id inventado.

**`DependencyGraph`** — nós e arestas para **impacto e ordem**, nunca para autorização. A
aresta carrega `required`, que é o que separa dependência de vínculo: a fonte *alimenta* um
dataset (sem ela a série para, não deixa de existir) e o monitor *observa* (sem o dataset
ele nunca dispara). `dependentsOf` responde "o que quebra se isto sumir" com profundidade
limitada — um ciclo em dado real transformaria a análise num laço.

### Decisões que o teste trava

- **conta cruzada**: o inventário de uma conta não contém nome nem id da outra;
- **credencial**: `configEncrypted`, `secretEncrypted` e cabeçalho com token não atravessam
  o inventário — nem cifrados, nem por referência;
- **teto**: acima de `INVENTORY_LIMITS.perKind` a resposta corta, mas `total` continua
  verdadeiro e `truncated` diz que cortou;
- **vocabulário do domínio**: o App fora do ar é descrito pelo motivo real (`error`,
  `revoked`, `needs_reauth`), porque reautenticar não é o mesmo que reconectar e "não
  conectado" para os três esconde o que fazer a seguir.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectInventory.integration.test.mjs` | 9 | 9 passam |

### Pendências reais ao fim da fase

- **canais vinculados e entregas** ainda não têm seção no inventário: o produto não tem hoje
  um serviço canônico que os liste por conta. Eles entram na Fase 3, junto com a resolução
  exata de canal — e a ausência está registrada aqui em vez de virar uma seção vazia que
  parece implementada.

---

## Fase 2 — contratos V2 ✅

`backend/src/architect/typesV2.ts` e `backend/src/architect/blueprintV2.ts`.

### O que passou a existir

**`OfficeBlueprintV2`** com `version: 2`, em três blocos — `organization`, `resources`,
`operations` — mais `access` e `acceptanceTests`. Ele representa o que o V1 não representava:
Databases e datasets, Tools, Sources, destinos Live e History, Monitors, Flows, canais,
entregas e grants por recurso.

**A validação estrutural.** Ela confere a FORMA e nada além: keys únicas e referenciáveis,
referências que existem, dependências sem ciclo, tetos e ausência de segredo. O que é
específico de um domínio continua sendo validado por ele — a condição de um monitor pela AST
canônica, a config de uma fonte pela união discriminada da Central. Uma segunda opinião
divergiria da primeira no campo seguinte, e a que estivesse errada só apareceria na hora de
aplicar, depois de alguém ter aprovado.

**Códigos de erro estáveis** (`agent_without_role`, `app_without_action`,
`secret_in_blueprint`, `dependency_cycle`…). A tela decide o que oferecer pelo código, não
casando a mensagem por texto — casar por texto quebra na primeira vez que alguém melhora a
frase.

**`applyOrder`** — ordenação topológica de `dependsOn`. Sem ela a aplicação criaria um
monitor antes do dataset que ele observa, e falharia num passo que não tem nada de errado.

**`diffBlueprintsV2`** compara por key, nunca por posição: reordenar não é mudar.

**`convertV1ToV2`** preserva `key` e `resourceId` e **marca** o que o V1 não dizia. Um agente
sem `role` vira um agente com `role` vazio e uma pendência declarada — preencher com o
objetivo pareceria mais amigável e seria mentira: o Flow mostraria uma responsabilidade que
ninguém escreveu. A conversão nunca produz `archive` (intenção que o V1 não tem) e **nunca
herda escrita autônoma**, que é aprovação por ação e não efeito de conectar.

### Decisões que o teste trava

- **agente sem responsabilidade, gatilho ou contrato é ERRO**, não aviso — é a correção da
  lacuna 11 no nível do contrato;
- **App obrigatório sem ação é erro**: um grant sem ação resolve para zero ferramentas;
- **escrita autônoma** só existe entre as ações pedidas;
- **segredo**: um campo chamado `token`/`apiKey`/`password` em qualquer profundidade é
  recusado; `headerNames` — o NOME do cabeçalho, que é público — passa;
- **key única no documento**, e não na lista: duas listas com a mesma key transformariam uma
  dependência em ambiguidade;
- **ciclo** é detectado e a mensagem diz qual é o caminho.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectBlueprintV2.test.mjs` | 26 | 26 passam |
| suíte inteira do Arquiteto (V1 + V2) | 342 | 342 passam |

### Pendências reais ao fim da fase

- O V2 ainda **não é produzido por ninguém**: o compilador continua emitindo V1. É a Fase 3.
- `mergeBlueprintPatch` e o `diff` da prévia continuam só no V1; eles passam a aceitar os
  dois formatos quando o compilador V2 existir.

---

## Fase 3 (parcial) — roteador de intenção e compilador V2 ✅

`backend/src/architect/intent.ts` e `backend/src/architect/compileV2.ts`.

### O roteador dos quatro modos

A regra que atravessa o arquivo: **a LLM classifica e descreve; o código decide e executa.**
Uma regra escrita em português dentro de um prompt é uma sugestão — o modelo a segue quase
sempre, e o "quase" é o caso que ninguém testa.

O que o parser garante, e nenhum prompt garantiria:

- **modo fora do vocabulário vira `answer`** — o modo que não cria projeto, não escreve e não
  aciona nada. Cair no mais inofensivo diante de resposta estranha separa "não entendi" de
  "fiz algo que ninguém pediu";
- **nenhum ObjectId sobrevive**, em campo nenhum. Um id vindo do modelo é um id inventado;
- **o risco SOBE na dúvida**: `risk` ausente ou desconhecido vira `write`. Errar para cima
  custa uma confirmação; errar para baixo executa uma escrita que ninguém autorizou;
- **`policyFor`** decide as consequências em código: só `propose` cria projeto, escrita nunca
  acontece sem confirmação, e `answer` sobre o agora exige origem e instante;
- **`noCurrentSource`** é a recusa honesta: sem fonte conectada, nenhum número é inventado.

### O compilador V2 — cinco lacunas mortas

| Lacuna | O que passou a acontecer |
| --- | --- |
| 4 — um andar genérico | `areasOf` reconhece as áreas do Brief: três áreas viram três andares |
| 4 — nunca expandir | `findExistingFloor` reaproveita o andar que já existe (`action: 'reuse'`), e é conservador: "Atendimento ao fornecedor" **não** é "Atendimento" |
| 5 — `actionKeys: []` | `resolveAppActions` casa o verbo do trabalho com as ações **reais** do manifesto, separando leitura de escrita. Escrita autônoma sai sempre vazia |
| 6 — canal errado | `resolveChannel` faz o **pedido** ganhar; a conexão pendente vira checklist. Só sem pedido o conectado serve |
| 2 — `liveDataNeeds` no vazio | vira fonte + destino ao vivo, com `staleAfterSeconds` derivado do texto ("até 1 minuto" → 60) e **zero agentes**: acesso é concessão |
| 9 — condição vira cron | `parseDataCondition` separa horário de condição. Uma condição vira **fonte → histórico → monitor → Flow**, e o Flow só começa na borda verdadeira |
| 7 — canal sem vínculo | nasce um `channels[]` ligando App, agente de entrada e direção |

**Dois defeitos que os testes de cenário encontraram durante a fase:**

1. o classificador chamava "avise quando o RSI ficar abaixo de 30" de **cálculo** — ele vê
   "RSI" e conclui fórmula. Está certo sobre o cálculo e errado sobre a forma. A condição de
   dado passou a ser lida **antes** do tipo, e as duas coisas convivem: a vigilância é
   compilada e o cálculo continua descendo para virar função ou pendência;
2. um agente que "cria o evento na agenda" não ganhava o App: requisito de App só nascia
   quando o classificador dizia `tool`, e um trabalho que mistura conversa e ação externa não
   é `tool` — é um agente com ferramenta.

**Campo e limiar ausentes nunca viram zero.** Um monitor com limiar inventado dispara sempre
ou nunca, e nos dois casos ninguém descobre por quê — então vira pendência declarada.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectIntent.test.mjs` | 18 | 18 passam |
| `backend/test/architectCompileV2.test.mjs` | 19 | 19 passam |
| suíte inteira do Arquiteto | 379 | 379 passam |

Os quatro cenários do plano estão cobertos no nível do compilador: **A** (pergunta sem
mutação, via `policyFor` + `noCurrentSource`), **B** (CXSE3 → fonte/histórico/monitor/Flow),
**C** (restaurante → ações exatas + vínculo de canal) e **D** (salão → reuso sem duplicar).

### Pendências reais ao fim da fase

- **Brief V2** (§10.1 do plano) ainda não estendeu os campos novos: tolerância de atraso,
  política de aprovação humana e critérios de aceitação observáveis continuam fora do
  `OperationBrief`. O compilador já produz `acceptanceTests`, mas derivados da forma do
  plano, não de critérios que a pessoa declarou.
- O compilador V2 **ainda não está ligado ao serviço**: `service.ts` continua chamando
  `compileBrief` (V1). A troca acontece com a feature flag, na Fase 9.
- `sectors` não é produzido pelo compilador V2 — a Fase 4 é quem trata topologia de setor.

---

## Fase 4 — Flow e atualização estrutural ✅

### Backend: a topologia passa a ser atualizada (lacuna 8)

`apply.ts` — o caminho `update` de setor trocava nome, cor, instrução e contratos. Uma
revisão que acrescentava um agente à equipe era aprovada, aplicada e **não acontecia**: quem
olhava a proposta via o agente novo; quem abria o setor não via.

Agora ele carrega **membros, coordenador, modo, etapas e andar**. As etapas usam a **mesma
forma** de quando o setor é criado — `dependsOn`, `expectedOutput`, `retryPolicy`, `onError` —
porque um pipeline atualizado não pode ter comportamento diferente de um recém-criado.

**Mover de andar bloqueia com impacto.** Todo membro de um setor trabalha no andar dele, e
mover agente entre andares não existe na API canônica de agentes. Mover o setor sozinho
produziria um setor inválido, então a aplicação para e diz **quem** precisaria mudar antes:

> mover "Recepção" de andar exige mover antes 1 agente(s): Marina.

**Três garantias do V1 que os testes confirmaram como corretas** (e que as fixtures tiveram
de respeitar, em vez de contornar): setor orquestrado precisa de coordenador **e** pelo menos
um especialista; todo membro fica no mesmo andar do setor; e um id que não é desta conta é
recusado na validação — antes de qualquer escrita.

### Frontend: nenhuma ficha do Flow renderiza vazia (lacuna 11)

`SectorFlow.tsx`:

- `funcaoDe` passou a distinguir **três estados**: papel escrito, objetivo legado, e ausência.
  Antes os três colapsavam em `undefined` e a linha sumia;
- ausência vira **pendência acionável** — "função não definida — abra o agente e escreva o
  que ele faz" —, e ela é uma **linha própria**, não um substituto do subtítulo: o
  coordenador já tem "coordena" escrito ali, e a falta da função dele continuaria invisível;
- o objetivo é fallback de dado legado e é **marcado** (`(do objetivo)`): "entrega
  relatórios" não responde "quando este agente entra";
- as arestas ganharam **nome da relação** — `recebe`, `delega`, `depende da etapa anterior`,
  `entrega`. A seta sozinha diz que existe caminho e não diz qual.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectSectorTopology.integration.test.mjs` | 8 | 8 passam |
| `frontend/e2e/sector-teams.spec.ts` | 41 | 41 passam |

Teeth check: neutralizando a aplicação de `members`, 3 casos caem.

**Um defeito que o E2E encontrou:** `allTextContents()` do Playwright **não espera** — ele lê
o instante. O teste das arestas falhava com o elemento presente no DOM; a correção foi
esperar a primeira aresta antes de ler, que é o que separa "não existe" de "ainda não
renderizou".

### Pendências reais ao fim da fase

- **Preview × aplicado**: o plano pede que a prévia e o recurso aplicado produzam a mesma
  topologia. Hoje a prévia do Arquiteto desenha a partir do Blueprint e o setor desenha a
  partir do banco; os dois caminhos existem e ainda **não há um teste que compare os dois**.
- O compilador V2 ainda não produz `sectors`, então a topologia proposta vem do V1.

---

## Fase 8 — exclusão e arquivamento de andar ✅

`backend/src/floorImpact.ts`, rotas em `floorRoutes.ts`, e
`frontend/src/components/FloorDeletionDialog.tsx`.

### O que existia, e por que era grave

`deleteFloor` contava agentes e setores. Um andar com fonte de monitoramento, monitor e Flow
era considerado **vazio** — era apagado, e os três ficavam órfãos apontando para um andar que
não existe mais.

### Três regras que carregam o módulo

**Arquivar é o padrão.** Recuperável, sem hash nem nome digitado, porque nada se perde.
Restaurar traz o andar de volta **sem reativar operação nenhuma**: reativar sozinho
dispararia trabalho que ninguém pediu, possivelmente semanas depois.

**Compartilhado se preserva.** Database corporativo, App instalado na empresa e conexão usada
por outro andar continuam existindo — o que sai é o **vínculo**. E nunca inferir que uma
conexão pertence ao andar só porque os agentes dele a usam: a mesma credencial costuma servir
a vários andares.

**O retrato tem validade.** O `impactHash` cobre ids, `updatedAt` e as escolhas — escolher
"excluir os exclusivos" muda o hash, porque muda o resultado. Um purge com hash velho é um
purge sobre um escritório que já mudou, e a resposta é `409` com o retrato novo.

### As três portas do purge

Antes de qualquer escrita: hash bate, nome digitado é o do andar, nenhum bloqueio de pé.
Cada recusa tem código próprio — a tela precisa distinguir "o escritório mudou, revise" de
"você digitou o nome errado".

Uma falha em um item **não derruba o purge inteiro**: o item volta na próxima análise, que é
o que torna a retomada possível. Parar no meio deixaria o andar num estado indescritível.

### A tela

"Tem certeza?" deixou de existir. O diálogo diz, antes do clique:

> Excluir “Atendimento” afetará 1 agente, 1 setor, 1 Flow, 1 fonte, 1 Database, 1 acesso a
> Database e 1 App.

E separa **será arquivado / será excluído / será desvinculado / continuará existindo /
impede a exclusão**, cada item com o motivo. O nome digitado é a confirmação. Depois, o
resultado mostra removidos, desvinculados e mantidos.

**Um defeito real que o E2E encontrou:** o cliente de andares transformava toda recusa em
`new Error("409")` — a tela não conseguia distinguir "o escritório mudou" de "nome errado" e
mostrava a mesma frase genérica. Agora a recusa chega inteira, com código e mensagem.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectV2FloorImpact.integration.test.mjs` | 16 | 16 passam |
| `frontend/e2e/floor-deletion-impact.spec.ts` | 9 | 9 passam |

Teeth check: neutralizando cada uma das três portas do purge, um caso cai por porta.

Os dois primeiros casos do arquivo de integração eram de **caracterização** e foram virados
do avesso: eles agora afirmam o comportamento novo, e é neles que a correção fica visível.
O mesmo aconteceu com a caracterização da lacuna 8.

### Pendências reais ao fim da fase

- **Arquivar em cascata não existe**: `archiveFloor` marca o andar, e os agentes/setores dele
  ficam com `status: 'archived'` **apenas quando o purge roda com `disposition: archive`**.
  Um arquivamento simples do andar não propaga hoje — está registrado como pendência em vez
  de virar uma varredura que ninguém revisou.
- A **auditoria** do purge (quem apagou o quê, quando) ainda não é gravada em Activity.

---

## Fase 7 — o Arquiteto como chat global

### A lacuna 12, medida antes de consertar

`frontend/e2e/architect-v2-characterization.spec.ts` provou o que o plano descrevia: o
Arquiteto só existia como **página**. Quem estava num andar, num agente ou no Monitoramento
tinha de sair de onde estava, ir para `/architect`, perder o contexto da tela e recomeçar a
conversa. E o item nem aparecia na navegação nova — `NAV_V2` não tinha o Arquiteto: era um
recurso que sumia dependendo de como a conta tinha sido construída.

### O que passou a existir

**`backend/src/architect/assistant.ts`** — uma rodada de conversa que **não é um projeto**:

```
runAssistantTurn({ ownerId, message, uiContext, classified }) → { intent, phase, text, question, projectId }
```

Os quatro modos do §6 do plano decidem o que acontece, e só **um deles** cria estrutura:

| Modo | O que faz | Cria projeto? |
| --- | --- | --- |
| `answer` | responde com fonte e horário, ou recusa dizendo o que falta conectar | não |
| `explain` | lê o inventário e descreve o escritório real | não |
| `operate` | leitura responde; escrita para em `awaiting_approval` com prévia | não |
| `propose` | monta a proposta e abre o projeto | **sim** |

"Qual o valor do dólar hoje?" agora responde — ou recusa — **sem deixar um projeto no
histórico da conta para sempre**. Sem fonte conectada, a recusa diz o que conectar, e nenhum
número aparece: um valor lembrado com cara de cotação é pior que nenhum valor.

**O contexto da tela é uma referência, nunca conteúdo.** `resolveUiContext` reconfere cada id
contra a conta e joga o que não pertence em `rejected[]`. Um `floorId` de outra conta some da
rodada — a resposta não pode descrever o escritório de outra pessoa.

**`frontend/src/components/ArchitectAssistant.tsx`** — o painel flutuante, montado **acima
do `<Routes>`** para que a conversa sobreviva à navegação. Redimensionável (guardado em
`localStorage`), Esc fecha, Enter envia, Shift+Enter quebra linha. Some sozinho em
`/architect/:id`, onde a página já é a conversa.

### Dois defeitos reais que o E2E encontrou

- **O lançador cobria o "Próximo" da contratação** num viewport de 390px. Agora ele se
  recolhe enquanto qualquer modal está aberto, por `MutationObserver`. O primeiro conserto
  criou o segundo: o próprio painel tem `role="dialog"`, então o lançador nunca voltava
  depois da primeira abertura — a exclusão de si mesmo é parte da regra.
- **`NAV_V2` não tinha o Arquiteto.** Era a lacuna 12 de verdade, e não só a falta do chat.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectAssistant.integration.test.mjs` | 13 | 13 passam |
| `frontend/e2e/architect-v2-characterization.spec.ts` | 10 | 10 passam |
| Suíte E2E completa | 724 + 17 puladas | 0 falhas, 0 flaky |

### Pendências reais ao fim da fase

- A conversa **não tem streaming nem cancelamento**: a rodada devolve o texto inteiro de uma
  vez. Para respostas longas isso aparece como espera.
- Em `/architect/:id` continuam existindo **duas conversas** — a da página e a global, que se
  esconde. Unificar as duas é trabalho da fase 9, junto com a flag.
- `classified` ainda chega por parâmetro nos testes: a classificação por LLM entra no fluxo
  real, mas o modo é **sugerido** por heurística quando o modelo não responde, e é essa
  heurística que os casos exercitam.

---

## Fase 5 — a saga estendida, e não uma segunda engine

### O que passou a existir

`backend/src/architect/applyV2.ts` aplica os blocos que o V1 não conhecia — Databases,
datasets, fontes, destinos ao vivo, históricos, monitores e Flows — e é chamado **de dentro
da saga do V1**, como o passo 8. Não há segunda engine: mesmos passos registrados, mesmo
`resourceMap`, mesmo arrendamento, mesma retomada, mesmo desfazer.

Três regras atravessam o arquivo:

- **Nada nasce ligado.** A fonte nasce `draft`, o monitor nasce `draft`, o Flow nasce
  rascunho. Quem garante isso é o próprio domínio: `createSource` cria em rascunho e o
  portão de ativação exige um teste bem-sucedido. Não há como criar ativo por aqui.
- **A ordem vem do plano.** `applyOrder` faz a ordem topológica de `dependsOn`: um dataset
  declarado antes do Database dele é criado depois, e não falha num passo sem defeito.
- **Quem cria é o domínio.** Nenhuma coleção é escrita direto. Um `insertOne` aqui pularia
  a validação, a cota e os índices que já existem.

`tool`, `delivery` e `channel` devolvem **pendência explícita** em vez de um recurso
incompleto: uma ferramenta própria precisa de endpoint e schema que o plano não inventa, uma
entrega precisa de destino concreto, e o vínculo de canal depende da instalação conectada.

### O cadeado da revisão passou a cobrir o V2

`computeBlueprintHash(v1, v2?)`. Sem isso, mudar **só** os monitores deixava o hash do V1
igual — e um clique feito olhando a revisão anterior aplicaria uma operação que ninguém leu.
Projetos sem plano V2 continuam com exatamente o hash que já tinham.

### Três defeitos reais encontrados pelos testes

- **`validateConfig` recusava o próprio discriminador.** O `kind` dentro do config é gerado
  pelo servidor e era rejeitado como campo estranho na volta: **nenhuma fonte podia ser
  reescrita a partir da que estava gravada** — nem pela tela, nem pela aplicação de um
  Blueprint. Agora um `kind` igual ao da fonte passa, e um **trocado** continua recusado.
- **Uma aplicação que falhava devolvia HTML.** `ApplyFailure` caía no 500 padrão do Express:
  a tela ficava sem o motivo e sem o id da operação — e existe rota para *retomar*, que sem
  o id não tem o que retomar. Agora volta `502 apply_failed` com motivo e `operationId`.
- **O desfazer não conhecia o V2.** Um rollback deixava Database, dataset, fonte e monitor de
  pé. Agora eles saem na ordem inversa, pelos serviços canônicos, com as três regras do
  desfazer inteiras: nada que já não exista, nada editado depois de criado, nada de outra
  aplicação. `live` e `history` ficam em `kept`: são destinos ligados numa fonte que pode ser
  preexistente, e desligá-los às cegas apagaria histórico que alguém já vinha alimentando.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectApplyV2.integration.test.mjs` | 13 | 13 passam |
| `backend/test/architectApply.integration.test.mjs` | 29 (7 novos) | 29 passam |
| `backend/test/monitoringSource.integration.test.mjs` | 71 (2 novos) | 71 passam |
| Suíte backend completa | 2123 | 0 falhas |

Teeth check, cada um derrubando o caso certo: desligando a aprovação por item cai o caso 6;
tirando o plano V2 do cadeado do hash caem os 5 casos da saga ligada.

### Pendências reais ao fim da fase

- **Nenhum projeto guarda um `blueprintV2` ainda.** A saga sabe aplicá-lo, o hash sabe
  cobri-lo e o desfazer sabe desfazê-lo — mas quem o produz é o compilador V2, que só é
  ligado ao `service.ts` na fase 9. Hoje o campo é preenchido nos testes.
- O `dataset` é identificado no mapa por `storeId:key`, e não por um `_id`. Funciona, mas é
  a única `key` do mapa que não é um ObjectId.
- Os recursos do V2 **não recebem a marca de origem** (`architect.operationId`) na escrita,
  porque os serviços canônicos não aceitam esse campo. A consequência é concreta: a janela
  entre criar e registrar o passo, que o V1 fecha pela marca, aqui é fechada só pelo
  `resourceMap` — uma queda exatamente nesse instante pode deixar um recurso órfão.

---

## Fase 6 — a prova, e o que ela destrava

### "Pronto" deixou de significar "o documento existe"

No V1, um item de checklist ficava verde porque o recurso tinha sido criado. Isso confirma
que a **aplicação** rodou, não que a **operação** funciona: a fonte pode ter nascido
apontando para uma URL que responde 404, o monitor pode observar um campo que o mapeamento
nunca produz, o Flow pode ter um passo dependendo de outro que não existe. Nada disso
aparece em "criado com sucesso".

`backend/src/architect/acceptance.ts` roda os testes declarados no Blueprint contra o
**recurso real criado nesta operação**:

| Teste | O que observa de verdade |
| --- | --- |
| `source` | bate na origem, aplica o mapeamento, confere que os campos obrigatórios chegaram |
| `monitor_simulation` | constrói a transição que a própria regra descreve e confere que ela dispara |
| `flow` | confere que existe passo e que todo `dependsOn` resolve |
| `agent_contract` | confere que a função escrita **não está vazia** |
| `database_permission` | lê pelo caminho canônico, que filtra por dono, e confere que há conjunto com campos |
| `channel`, `app_dry_run`, `delivery` | **pendentes**, cada um com o que fazer — nunca aprovados |

O caso perigoso está coberto: uma fonte que responde 200 **sem o campo obrigatório** reprova.
Ela parece viva, e o monitor em cima dela nunca dispararia.

### Ativar exige as duas coisas

Passo 10 do §12: *publicar/ativar somente o que passou e foi aprovado*. As duas condições,
e as duas obrigatórias:

- o teste do alvo **passou** — e um alvo com dois testes, um passando e um falhando, não é
  ativável: o que reprova manda;
- a `key` está em **`approvedActivationKeys`** da requisição — aplicar uma proposta nunca
  coloca a operação para rodar sozinha no mesmo instante.

Um alvo **sem teste declarado não é ativável**: ausência de teste não é prova de nada, e
ligar por falta de evidência contrária é exatamente o defeito que esta fase fecha.

### O resultado entra na Activity e na prontidão

Cada teste abre uma raiz de execução em ambiente `test`, com `source: 'manual'` — é assim
que ele aparece na linha do tempo pela projeção que **já existe**, sem uma segunda coleção
contando a mesma coisa. Um teste reprovado marca a execução como falha, com
`errorKind: 'acceptance_failed'`.

Na checklist, cada resultado vira um item com `completionMode: 'test_result'` — o modo que
existia no tipo e que **nenhum código usava**. Ninguém o marca à mão: ele só fica `done`
quando o teste passou. Um obrigatório que não passou vira **bloqueio de prontidão**, com o
texto do que foi observado.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectAcceptance.integration.test.mjs` | 18 | 18 passam |
| `backend/test/architectApply.integration.test.mjs` | 33 (4 novos) | 33 passam |

A fonte é testada contra um **servidor HTTP de verdade** subido no próprio arquivo: um mock
devolvendo o que o teste espera provaria só que o mock funciona.

Teeth check: desligando a autorização de ativação cai o caso 31; desligando o portão da
prova caem os três casos de ativação, incluindo o da fonte autorizada que reprovou.

### Pendências reais ao fim da fase

- **A tela ainda não pergunta o que entrar no ar.** O cliente já aceita
  `approvedActivationKeys`, e o diálogo de aplicação ainda não o preenche — o padrão seguro
  vale (nada liga), mas hoje só dá para autorizar pela API. Entra junto com a prévia V2 na
  fase 9.
- Monitores e Flows têm portão de ativação no código (`activatableKeys` já os cobre), mas a
  saga só liga **fontes** hoje: publicar um monitor pede a simulação com dados reais, que
  depende da fonte já ter coletado ao menos uma vez.
- `app_dry_run` fica pendente para todo App: nenhum manifesto declara execução de teste
  ainda.

---

## Fase 9 — a flag, a conversão e o caminho de volta

### `ARCHITECT_BLUEPRINT_V2`

`backend/src/architect/flags.ts` é uma função de uma linha, lida **a cada compilação** e não
uma vez no boot: mudar a variável e reiniciar basta, não há cache a limpar. `1`, `true` ou
`on` ligam; qualquer outra coisa — inclusive a ausência — deixa desligado.

Desligada, **nada muda**: o projeto não ganha `blueprintV2`, a saga não roda o passo do V2 e
o hash é exatamente o que já era. É isso que faz o rollback ser uma variável de ambiente em
vez de um deploy.

### O defeito que a ligação revelou: dois escritórios

O compilador V1 usa sempre a chave de andar `operacao`. O V2 gera **uma chave por área** —
`atendimento`, `comercial`. Com os dois rodando juntos, um Flow do V2 apontaria para
`floor:atendimento` enquanto a saga criou `floor:operacao`: a aplicação falharia num passo
que não tem defeito, ou pior, criaria um andar por plano.

`compileBriefV2` passou a aceitar **andares decididos fora** e a usá-los como estão, sem
inventar `key` nenhuma. Enquanto a flag rola, quem decide a organização é o plano V1 — é ele
que a saga aplica, e é dele que sai a chave que o `resourceMap` vai conhecer. Os dois
documentos descrevem **um** escritório.

Travado em teste: as chaves dos dois planos são comparadas, toda referência a andar é
conferida contra as chaves que o V1 cria, e aplicar tem que criar **um** andar.

### Templates da Comunidade

Com a flag ligada, um template chega como proposta **V2 convertida** — nunca reescrita. A
conversão preserva `key` e `resourceId`. O que o V1 não diz ela **não inventa**: um agente
sem função vira um agente com a função vazia e uma pendência declarada. Preencher com o
objetivo pareceria mais amigável e seria mentira na ficha do agente.

E continua rascunho: instalar um template não cria agente na conta de ninguém.

### Backfill: por que não existe

Projetos antigos **não são convertidos em massa**, e é uma decisão. Rodar a conversão em
lote encheria contas de pendências que ninguém pediu, num plano que talvez nunca seja
aplicado de novo. A conversão acontece sob demanda, no único momento em que a pendência tem
para quem aparecer.

### Um defeito real, de duas fases atrás

`test/auditRouteMap.test.mjs` — que exige **decisão explícita de auditoria para toda rota que
muda alguma coisa** — estava vermelho desde a fase 8, e eu não tinha visto: a suíte roda em
duas partições e eu havia lido só o fim da saída, que mostrava a segunda.

Duas rotas sem decisão:

- **`POST /floors/:id/purge`** — a exclusão irreversível, com tudo que morava no andar. É a
  mutação que mais precisa de registro: sem ela, "cadê o meu setor?" não tem resposta em
  lugar nenhum.
- **`POST /architect/assistant/turn`** — e aqui a decisão não era só preencher a tabela. A
  rodada é conversa: responder e explicar não mudam nada, e uma linha por pergunta feita
  afogaria o histórico. Mas a proposta abre um projeto **por dentro do serviço**, sem passar
  pela rota `POST /projects` — então um projeto criado pelo chat flutuante ficava sem
  registro nenhum, enquanto o mesmo projeto criado pela tela ficava. A rota passou a
  registrar a criação, e **só quando ela acontece**.

### Documentação operacional

`docs/architect-blueprint-v2-operacao.md`: como ligar, o que muda, como voltar, onde olhar
quando algo dá errado, e o que ainda não está pronto.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectV2Flag.integration.test.mjs` | 7 | 7 passam |
| `backend/test/architectCompileV2.test.mjs` | 22 (3 novos) | 22 passam |
| `backend/test/extensionTemplates.integration.test.mjs` | 12 (3 novos) | 12 passam |
| `backend/test/architectAssistant.integration.test.mjs` | 14 (1 novo) | 14 passam |
| `backend/test/auditRouteMap.test.mjs` | 13 | 13 passam |

Teeth check: neutralizando o registro da criação pelo assistente, o caso 14 cai.

### Pendências reais ao fim da fase

- A **tela** ainda não expõe a flag nem a prévia V2: quem liga hoje vê a mesma prévia V1, e
  os recursos do V2 aparecem só na lista de passos da operação.
- O compilador V2 ainda **não produz setores**, então a topologia continua vindo do V1.
- O `LLM_FAKE` não gera brief de vigilância, então a cadeia fonte → monitor → Flow é
  exercitada pelo compilador direto e pela saga, não ponta a ponta pela conversa.

---

## Fase 10 — os cenários ponta a ponta, e o que eles acharam

### A suíte de cenários

`backend/test/architectScenarios.integration.test.mjs` fecha o §20: o Brief é montado à mão,
compilado pelos dois compiladores e **aplicado pela saga de verdade** — serviços canônicos,
coleções reais, uma origem HTTP que responde de fato. Nenhum stub genérico: um mock
devolvendo o que o teste espera provaria só que o mock funciona.

Ela achou **cinco defeitos** que os testes de compilador não podiam ver, porque nenhum deles
aparece no desenho — todos aparecem na hora de aplicar ou de ler.

**1. Uma fonte sem origem derrubava a aplicação inteira.** O compilador emite a fonte de
propósito quando o Brief não diz de onde o dado vem, para que ela apareça no plano com o
motivo. Só que `createSource` recusa mapeamento vazio, e a saga morria com "mapeie ao menos
um campo" numa etapa que não tem defeito — falta uma informação que só a pessoa tem. Agora é
**pendência declarada**, e o que depende dela também: um destino ao vivo em cima de uma fonte
pendente está esperando o mesmo dado, não quebrado.

**2. "Reservar mesa" virava uma automação AGENDADA.** `frequency` empurrava qualquer trabalho
para rotina, e ninguém perguntava se a palavra nomeia um horário. "Sempre" e "sob demanda"
não nomeiam: quem dispara é o cliente, e cliente não tem cadência. É a mesma patologia de
"quando o RSI ficar abaixo de 30" virando um cron das oito da manhã.

**3. A ação do App casava por substring exata.** "criar o evento na agenda" não achava "Criar
evento" — um artigo no meio da frase, e o agente é criado sem alcançar o sistema de que
precisa. Ninguém descobre até a primeira reserva não entrar na agenda. Agora casa **palavra
por palavra**, e continua conservador: "listar eventos" não casa com "criar o evento".

**4. Um canal NATIVO virava um requisito de App vazio.** `web_chat` é porta de entrada do
próprio produto, não um sistema de terceiro com ações declaradas. O requisito sem ação é
recusado pelo validador — e derrubava a **proposta inteira** com um erro vermelho que ninguém
conseguia resolver na tela. O vínculo do canal continua existindo; o requisito vazio, não.

**5. A prévia dizia "Setor no modo parallel".** O valor do enum, em inglês, na tela de quem
aprova. E os três modos decidem coisas diferentes — quem recebe o trabalho, quem cobra, em
que ordem. Aprovar "orchestrated" achando que é "pipeline" é aprovar outra operação.

### O andar existente, reconhecido pela área

"Adicione recepção ao meu salão" vira a área **Atendimento**; o andar da pessoa se chama
**Recepção**. Propor "Atendimento" ao lado dele cria dois andares para a mesma coisa. Agora o
andar existente é reconhecido pela mesma família de palavras — e **só um nome de uma
palavra**: "Atendimento ao fornecedor" continua sendo outro andar, porque o qualificador é o
que o distingue.

### §10.1: o que precisa ficar guardado

O Brief ganhou `recordsToKeep` — e ele **muda a saída**: cada registro vira um Database e um
conjunto com os campos declarados, `append_only`, mais um teste de aceitação obrigatório.
Antes disto, toda proposta nascia com **zero Databases**, e a cadeia parava no monitor, que
precisa de um conjunto para observar.

Sem campos declarados, o conjunto vira pendência: um schema que aceita tudo não pode ser
consultado nem observado, porque a DSL só permite o que o schema declara.

### §20.E: a prévia e a estrutura aplicada coincidem

O teste que faltava. A prévia é o que a pessoa lê antes de clicar; se ela descreve uma equipe
de três e a aplicação monta uma de dois, a aprovação foi dada sobre uma coisa que não
aconteceu — e ninguém descobre, porque quem aprova não volta para conferir. Modo, coordenador
e equipe são comparados item a item.

### Acessibilidade

- O painel do Arquiteto ganhou **região viva**: sem ela, a resposta chega em silêncio para
  quem usa leitor de tela, porque a conversa não muda de página.
- Os **22 arquivos** que pintavam texto com `--intent-danger` (2,81:1) passaram para
  `--intent-danger-text` (5,98:1). Preenchimento, borda e `fill` continuam com o token de
  preenchimento, que é para o que ele existe. Um caso barato, sem navegador, impede o defeito
  de voltar arquivo por arquivo — e um caso de E2E mede a razão WCAG do texto de erro do
  painel a partir das cores computadas.

### Sobre a suíte que falhou uma vez

Numa execução, dez casos de `websocketRoutes` caíram com `fetch failed` num servidor local. A
execução seguinte, idêntica, passou inteira. Não é regressão: é contenção — eu estava rodando
o build do frontend e o Playwright na mesma máquina. Cheguei a escrever um teto de
concorrência por memória no corredor e **revertí**: com 8,6 GB a conta dava o mesmo 4 de
antes, então seria um conserto de fachada. O que vale é o que já está escrito no próprio
corredor: a suíte roda sozinha.

### §14.2: arquivar passou a desativar a entrada

`archiveFloor` marcava o andar e **deixava tudo rodando**. Um andar arquivado com Flow ativo
e fonte coletando não está arquivado: ele saiu da tela e continuou trabalhando — gastando
token, batendo em servidor de terceiro e gravando histórico que ninguém vai olhar, porque
ninguém olha um andar arquivado.

Agora ele pausa Flows e fontes do andar pelos serviços canônicos de cada domínio, e **não
apaga nada**: arquivar é o padrão recuperável. Restaurar continua **não religando** — reativar
sozinho dispararia trabalho semanas depois, sem ninguém pedir.

Dois defeitos vieram junto:

- **`setSourceStatus` lia `telemetry` sem guarda**, inclusive ao PAUSAR. Um documento gravado
  antes de a telemetria existir era uma fonte que ninguém conseguia desligar.
- O primeiro rascunho **engolia** a falha de pausar. Silenciar deixaria o andar marcado como
  arquivado com metade da operação no ar, e ninguém descobriria. Agora a falha nomeia o
  recurso que continuou ligado.

### A prévia reusa o rótulo do produto

`detalheDoSetor` passou a vir de `SECTOR_MODE_LABEL`, que é de onde a tela de setores já tira
o texto dela. Duas frases para a mesma coisa é como a prévia e o produto começam a discordar.
E `organization` **não é paralelo**: ele agrupa no mapa e não executa nada — dizer o contrário
seria o mesmo defeito com outra roupa.

---

## Fase 10 (continuação) — o critério 3 do §22, e a tela que destrava a flag

O relatório dizia que o critério 3 estava parcial e que a flag não podia sair. Esta parte
fecha o que dava para fechar e diz, com precisão, o que **não é lacuna** — é desenho.

### A tela passou a perguntar o que entra no ar

Era a pendência que segurava tudo: o servidor exigia `approvedActivationKeys` e a tela não
tinha como dar. Um produto em que a autorização só existe pela API não está entregue.

A prévia ganhou `activatable`: os itens do plano V2 que **declaram um teste de aceitação**,
com o nome que a pessoa reconhece e o que o teste vai observar. Só eles — o servidor não
ativa nada sem prova, e oferecer o resto seria um checkbox que mente.

No diálogo, a seção **"O que já entra no ar"** nasce vazia. Cada linha diz o que será
provado, porque "entra no ar" sem critério é um checkbox que a pessoa marca sem saber o que
está sendo verificado. Sem marcar nada, tudo é criado parado.

### O compilador V2 passou a produzir setores

Faltava a metade da organização. Agora dois agentes no mesmo andar viram um setor coordenado
— e a `key` é a **mesma do V1** (`mesa`) de propósito: enquanto a organização é aplicada pelo
plano V1, os dois documentos precisam falar do mesmo setor. Uma chave diferente criaria um
segundo setor ao lado do primeiro.

Um agente sozinho **não** vira setor: agrupar uma pessoa é o "setor orquestrado para agrupar
visualmente" que a constituição proíbe.

**Um defeito veio junto:** o andar recebido de fora era marcado `reuse` sem `resourceId`, e o
validador recusa — com razão, porque é dizer que existe um andar que não existe. A ação passou
a vir junto com o andar, e um `reuse` sem id cai para `create`, que é o que a aplicação vai
fazer de verdade.

### O canal nativo é criado; o de App, não — e a diferença é real

`web_chat` é porta de entrada do próprio produto: não depende de credencial nenhuma, e criar
o vínculo é o que faz a mensagem chegar a alguém. Agora a saga o cria pelo `createWidget`
canônico, apontado para o agente ou o setor de entrada. Um canal **sem quem receba** fica
pendente: uma porta que não leva a lugar nenhum.

Um canal de App — WhatsApp, Telegram — depende do número, do token e da instalação conectada.
Continua pendência, dizendo o que conectar.

### A entrega não é lacuna: é o contrato

`DeliveryTarget` exige um `connectionId` real, e o **próprio contrato do V2 proíbe** endereço
concreto dentro do Blueprint — ele é lido inteiro pela tela e viaja no histórico do projeto.
Uma entrega compilada com endereço seria um vazamento, não uma conveniência. Ela fica
pendência por desenho, e o comentário no código passou a dizer isso em vez de sugerir que
falta implementar.

O mesmo vale para `tool`: endpoint e schema de uma ferramenta própria não são inferíveis.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectApply.integration.test.mjs` | 37 (4 novos) | 37 passam |
| `backend/test/architectCompileV2.test.mjs` | 38 (5 novos) | 38 passam |
| `backend/test/architectApplyV2.integration.test.mjs` | 20 (4 novos) | 20 passam |
| `frontend/e2e/architect-app.spec.ts` | 87 (3 novos) | 87 passam |

Teeth check: oferecendo na prévia um item sem teste declarado caem 3 casos; deixando o canal
de App ser criado como se fosse nativo cai 1.
