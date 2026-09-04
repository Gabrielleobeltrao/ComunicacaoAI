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

---

## Fase 10 (fechamento) — a cadeia inteira ligada, e duas coisas que eu tinha escrito errado

### A saga ligava só fontes

`activatableKeys` cobria os três desde a fase 6, mas o passo de ativação só agia sobre a
fonte. Um monitor que passou na simulação e ficou em rascunho é um alarme desligado que
parece ligado.

Agora a cadeia é publicada na ordem que o domínio exige: **publicar o Flow → ativar o Flow →
publicar o monitor**. Não é preferência de ordem — `publishMonitor` recusa um monitor cujo
Flow não tem versão publicada, e está certo: um monitor que reconhece a transição e aciona um
Flow sem versão é um alarme que toca no vazio.

Uma recusa do domínio é **dita e registrada**, e não derruba a aplicação: o escritório já
está montado quando isso acontece.

### A entrega — eu estava errado

Escrevi no relatório que a entrega era pendência "por desenho, impossível". Estava errado. O
contrato do V2 proíbe **endereço** dentro do Blueprint, e isso continua valendo — mas o que a
entrega precisa é de um `connectionId`, e ele pode vir da **requisição**, exatamente como
`approvedAppKeys`: uma referência a uma conexão que já existe na conta, conferida contra o
dono antes de qualquer escrita.

A entrega passou a virar um passo **`delivery.send`** de verdade no Flow. Gravar só
`definition.deliveries` não bastaria: quase ninguém lê esse campo, e quem entrega é o passo —
é ele que aparece na Activity quando a mensagem sai. Um Flow com o campo e sem o passo pareceria
configurado e não entregaria nada.

Na tela, a seção "Por onde a resposta sai" lista as conexões **conectadas** da conta, e o
padrão é **não escolher**: uma entrega ligada por engano manda mensagem para alguém que não
pediu. Sem conexão nenhuma, a tela diz o que fazer em vez de oferecer um seletor vazio e mudo.

### Um defeito que isso revelou

O teste de aceitação do Flow lia `flow.definition.steps`. A automação guarda
`draftDefinition` — então **todo** Flow reprovava, sempre com "o Flow não tem nenhum passo".
Um teste que sempre falha é tão inútil quanto um que sempre passa, e este ainda mentia sobre o
motivo. Agora ele lê a versão **publicada** quando existe (é ela que roda) e o rascunho quando
não.

### O que o hook apontou e NÃO é lacuna

- **`app_dry_run`**: nenhum App do catálogo declara execução de teste, e o plano qualifica com
  "app dry-run **quando suportado**" (§13). O teste retornar `pending` é o comportamento
  correto.
- **Streaming**: nenhum provider desta base faz streaming, e o plano qualifica com
  "streaming/cancelamento **quando suportado pelo provider**" (§6).

Nos dois casos, implementar exigiria primeiro criar a capacidade no provedor — que é outro
trabalho, não este.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectApply.integration.test.mjs` | 45 (6 novos) | 45 passam |
| `backend/test/architectApplyV2.integration.test.mjs` | 24 (4 novos) | 24 passam |
| `frontend/e2e/architect-app.spec.ts` | 90 (3 novos) | 90 passam |

Teeth check: desligando a ativação de Flow caem 2 casos; lendo `definition` em vez de
`draftDefinition` caem os mesmos 2; aceitando conexão de outra conta cai 1.

### O item 1, conferido peça por peça

"O blueprint deve criar/ajustar [doze tipos] com chaves estáveis" é o sub-requisito mais fácil de
afirmar e o mais difícil de provar. O contrato declara dezoito listas: a aplicação do V2 percorre
dez, e as outras (andar, setor, agente, responsabilidade, knowledge, rotina, grant) são criadas
pela saga do V1 **na mesma operação**, com o mesmo `resourceMap` e a mesma auditoria.

A terceira possibilidade é a que ninguém tinha como ver: uma lista declarada que *nenhum* dos
dois percorre. Um item ali não é criado, não vira pendência e não aparece na prévia — ele não
existe, e a proposta diz que existe. `resources.memoryPolicies` é esse caso; nada o emite hoje,
mas basta alguém emitir.

Dois casos novos travam a porta: todo item declarado vira passo (criado, reusado ou pendência
**com motivo**), e nenhuma chave é ObjectId — são slugs estáveis, e duas compilações do mesmo
Brief produzem exatamente as mesmas, senão uma revisão criaria recursos ao lado dos existentes.

### Bateria completa

backend **1551 + 2210 = 3761**, runner 21, browser-worker 32, frontend 294, E2E **735** com 0
flaky, lint 0 erros, secret-scan 2257 arquivos, smoke e `git diff --check` verdes.

---

## Fase 10 (conclusão) — a flag ligada, e os dois defeitos que ela expôs

### Os critérios de saída foram atendidos, então o padrão virou o V2

A Fase 10 diz "remover flag apenas após critérios de saída". Os 12 critérios do §22 estão
atendidos, então `ARCHITECT_BLUEPRINT_V2` passou a nascer **ligada**.

Ela **não foi removida**: `ARCHITECT_BLUEPRINT_V2=0` continua desligando. Remover de vez
apagaria o rollback documentado e transformaria "voltar atrás" num deploy. Enquanto custa uma
linha, mantê-la é mais barato que o incidente que ela evita. E só o "não" explícito desliga:
uma variável mal digitada não pode derrubar o produto por acidente.

### Ligar a flag revelou dois defeitos que quebrariam o produto para todo mundo

**1. Nenhuma primeira aplicação funcionaria.** O hash gravado no projeto era calculado com
`projeto.blueprintV2` — o V2 **anterior** — enquanto o mesmo patch salvava o V2 **novo**. A
aplicação recomputava com o novo, os dois não batiam, e toda tentativa era recusada com "a
proposta mudou desde a última revisão". Com a flag desligada nunca havia V2, então o defeito
era invisível.

**2. A segunda aplicação duplicaria o escritório.** Depois de aplicar, uma rodada nova
recompila do zero. No V1 isso é corrigido por `marcarOQueJaExiste`, que transforma os itens em
`update` apontando para o recurso real. O V2 **não tinha equivalente**: cada Database, fonte e
monitor voltava como `create`, e a segunda aplicação criaria um segundo de cada — exatamente o
que o critério 5 proíbe.

**3. E um menor:** os itens do V2 na prévia não pediam aprovação individual. Agora que voltam
como `update`, alterar um Database que já existe exige o mesmo aval do V1. O mecanismo já
estava na saga; só a marcação da prévia estava errada.

Um teste também estava medindo a coisa errada: ele recalculava o hash só sobre o V1, então a
aplicação era recusada por conflito antes de criar qualquer coisa. O `assert.rejects` passava,
mas pelo motivo errado — o caso dizia testar a retomada e testava a recusa da revisão.

### A ferramenta, fechando o §5

`resources.tools` tem três providers, e eu tratava os três como pendência. Só um é de fato
impossível:

- **`existing`** — aponta uma ferramenta que a conta já tem. Agora é **ligada** nos agentes
  pelo `updateAgent` canônico, acrescentando sem duplicar. O casamento é por slug, porque o
  nome de uma ferramenta é identificador (`cotacao_b3`) e o plano escreve como gente
  ("Cotação B3"): comparar as strings cruas nunca casaria, e a pendência mentiria dizendo que
  a ferramenta não existe.
- **`app_action`** — é um grant, e o caminho dele é o bloco de Apps, que exige instalação
  ativa e aprovação. Conceder por baixo pularia as duas.
- **`function`** — cálculo a registrar. Continua pendência: código não se infere de uma
  descrição.

### Testes

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectApply.integration.test.mjs` | 47 (2 novos) | 47 passam |
| `backend/test/architectApplyV2.integration.test.mjs` | 28 (5 novos) | 28 passam |
| `backend/test/architectV2Flag.integration.test.mjs` | 7 | 7 passam |

Teeth check: revertendo o hash para o V2 antigo caem 2 casos; tirando o `marcarOQueJaExisteV2`
cai 1; deixando a ferramenta de outra conta ser encontrada caem 3.

### Bateria, com a flag LIGADA

backend **1551 + 2216 = 3767**, runner 21, browser-worker 32, frontend 294, E2E 735 com 0
flaky, lint 0 erros, secret-scan 2257, smoke e `git diff --check` verdes.

---

## Pós-V2 — o Arquiteto Central que responde, consulta, explica e opera

O V2 entregou o plano e a aplicação. O que o chat ainda não fazia era **conversar**: ele
classificava pelo corpo da requisição, respondia vazio e travava o campo. Esta parte fecha
isso.

### A classificação saiu do cliente

`/assistant/turn` aceitava um `classified` no corpo. Quem manda o corpo é o navegador: bastava
mandar `{ mode: 'operate', risk: 'read' }` para escolher o caminho que executa. A intenção
passou a ser classificada no servidor (`classifyIntent`), com a chave da conta, saída
estruturada e validação por `parseIntent` — que arranca ObjectId de todo campo e escala o
risco na dúvida.

A heurística continua como rede, e passou a alcançar `explain` e `operate` de **leitura**.
Escrita e alto risco nunca saem dela: "pause a fonte" e "apague o andar" parecem iguais para
uma expressão regular, e um dos dois é irreversível.

### Nenhuma rodada fica pendurada

`answer` devolvia `text: ''` em `answering`; `operate` de leitura, vazio em `consulting`;
`propose` parava em `preparing_proposal`. Os três eram fases finais que nunca resolviam — o
campo do chat ficava bloqueado esperando uma continuação que não vinha.

Agora toda rodada termina em `done`, `failed` ou `awaiting_approval`, **com texto**. E na tela
o bloqueio passou a ser pela requisição em voo: amarrá-lo à fase devolvida fazia uma fase
inesperada travar o campo para sempre, sem nada dizendo por quê.

### O registro allowlisted

O modelo descreve o pedido. Ele não escolhe id, credencial, endereço nem comando: o servidor
resolve o **nome** contra o inventário owner-scoped e chama um handler registrado. Uma chave
fora do registro não executa — o modelo pode pedir `rm -rf`, e aqui isso é uma recusa.

O mapeamento pedido→capacidade também é do código. Se o modelo escolhesse a chave, bastaria
ele responder `pause_source` para uma pergunta virar escrita.

### `answer` sobre o agora

Consulta a fonte ao vivo da conta, reconfere a posse no instante do uso e devolve **valor,
fonte e horário**. Acima do frescor que a própria fonte declarou, a resposta é uma recusa que
diz de quando é o último valor: um número de duas horas atrás apresentado como "agora" é uma
resposta errada, e quem lê não tem como saber.

### `operate`: a escrita nunca sai da conversa

Ela vira uma operação pendente com prévia, impacto, hash e prazo, confirmada num **endpoint
próprio**. O texto do modelo não chega lá — só o id que o servidor montou e o hash que ele
carimbou. O hash é recalculado do estado de agora; dois cliques confirmam uma vez; a tentativa
vai para a auditoria **inclusive quando é recusada**, que é justamente o que alguém vai querer
investigar.

### `calculate_rsi`

Wilder, versionada, com schemas de entrada e saída. Dado insuficiente é recusa com o que falta
("faltam 7 fechamentos") — um número sobre menos dados do que a definição pede é errado com
cara de certo. Série só de alta é 100 por definição, não uma divisão por zero.

### A janela órfã

Entre criar o recurso e registrar o passo havia um instante em que o recurso existia e a
operação não sabia. Os serviços canônicos do V2 passam a aceitar a marca de origem
(`operationId` + `blueprintKey`), gravada na **mesma escrita** que cria o recurso, e a saga
procura pela marca antes de criar. A marca de **outra** operação não é adotada: adotá-la faria
o desfazer apagar o que não é dele.

### Canais e entregas no inventário

O canal diz se leva a alguém (`bound`/`unbound`) — uma porta que não leva a lugar nenhum
aparece. A entrega mostra o provedor e **nenhum endereço**: um e-mail no inventário é dado
pessoal viajando para a tela e para o resumo que vai ao modelo.

### CXSE3 pela rota real

`architectCxse3EndToEnd` parte de `POST /assistant/turn` com a frase que alguém digitaria.
Nada de Brief montado à mão — ele sai da conversa do projeto, que continua de onde o chat
parou.

### Cinco defeitos reais que apareceram no caminho

1. **`computeHealth` lia `telemetry` sem guarda.** A saúde é calculada na listagem: um único
   documento antigo derrubava o inventário inteiro — a tela de fontes, o assistente e a prévia.
2. **A heurística não reconhecia "observe X e me avise quando Y" como proposta.** O cenário
   principal do plano caía em `answer`, procurava uma fonte que ninguém criou, e recusava.
3. **O assistente perdia a frase original ao abrir o projeto.** A pessoa teria que digitar tudo
   de novo, e a segunda versão nunca é igual à primeira.
4. **`explain` respondia "o que este agente faz?" com contagem de andares.** Agora lê o agente
   real — e um sem função escrita é **dito**, não descrito por invenção: uma descrição plausível
   tirada do nome soa certa e é falsa.
5. **A escrita não tinha como ser confirmada pela tela.** O servidor preparava a operação e a
   conversa não tinha botão.

### Testes

| Arquivo | Casos |
| --- | --- |
| `architectAssistant.integration.test.mjs` | 26 |
| `architectAssistantCapabilities.integration.test.mjs` | 14 |
| `architectCxse3EndToEnd.integration.test.mjs` | 9 |
| `architectV2OrphanWindow.integration.test.mjs` | 4 |
| `indicatorFunctions.test.mjs` | 11 |
| `architectIntent.test.mjs` | 22 |
| `architect-v2-characterization.spec.ts` (E2E) | 19 |

Teeth check: neutralizando o portão do hash caem 2; o do frescor, 1; a busca pela marca, 1;
a posse da conexão de entrega, 1; a ativação de Flow, 2.

### Bateria

backend **1566 + 2257 = 3823**, runner 21, browser-worker 32, frontend 294, E2E 739 com 0
flaky, lint 0 erros, secret-scan 2265, smoke e `git diff --check` verdes.

---

## Fechamento: a cadeia CXSE3 no ar, e o que estava quebrado no caminho

O objetivo desta fase era um só: *"Observe CXSE3 e me avise quando o RSI ficar abaixo de 30"*
funcionando ponta a ponta, entrando pela frase real. Ele obrigou a consertar sete defeitos —
quatro deles descobertos porque o teste finalmente exercitava a cadeia inteira.

### A ordem da cadeia estava invertida

O compilador declarava o monitor dependendo do histórico e o Flow dependendo do monitor. A
ordem topológica saía histórico → monitor → Flow: **o monitor nascia antes do Flow**, e o
`flowId` dele saía `null`. Um monitor sem ação reconhece a transição e não aciona nada — ele
parece configurado. Invertido: o monitor depende do Flow, e o Flow não precisa do monitor
para existir, porque quem o chama é o monitor, depois.

E quando o conjunto observado ainda não existia, a aplicação devolvia **o id da FONTE** como
se o monitor tivesse sido criado. O passo ficava `created`, o `resourceMap` passava a apontar
`monitor:x` para um documento de `monitoring_sources`, e o desfazer removeria a fonte achando
que remove o monitor. Virou pendência com motivo, que é o que ela sempre foi.

### O Flow do aviso não tinha etapa nenhuma

`steps: dono ? [...] : []` — e "observe e me avise" não precisa de agente. Sem etapa o Flow
não faz nada, reprova na aceitação e nunca pode ser publicado; como `publishMonitor` exige
versão publicada do Flow, a cadeia inteira parava aí. Montar o texto do aviso é
determinístico: virou um passo `transform.template`, e o agente, quando existe, entra depois
para acrescentar julgamento e não formatação.

### As provas rodavam antes da segunda passada

O monitor só pode ser criado depois que a fonte entra no ar (é quando o conjunto observado
existe). Essa segunda passada acontecia **depois** da rodada de provas: o monitor recém-criado
ficava com o teste `skipped` — "não foi criado nesta aplicação" — e um teste pulado não torna
nada ativável. Resultado: Flow ativo e ninguém para acioná-lo. As provas agora rodam de novo
quando a segunda passada cria alguma coisa, e o melhor resultado de cada teste vale.

### A simulação do monitor reprovava regras corretas

Duas coisas. O **limite** caía para zero quando o monitor não declarava `threshold` — e ele só
é gravado nos modos `cross*`. Num `enter` sobre "rsi < 30" a simulação testava 1 → -1: dois
valores já abaixo de 30, nenhuma travessia. A **direção** era sempre de cima para baixo, então
toda regra de teto ("maior que 30") era reprovada por um caso que ela não descreve — e nenhuma
vigilância de máximo jamais entrou no ar. O teste que afirmava isso afirmava o defeito e foi
invertido; no lugar dele, um alarme que é mesmo mudo: igualdade sobre número contínuo.

### O RSI voltava a ser palpite do modelo

As funções entram no registro por efeito de import, e essa lista vivia só dentro de
`functionExecutor`. O manifesto lia `functionRegistry` direto: pedir um plano antes de
qualquer execução listava só as 25 funções puras, e `calculate_rsi` ficava de fora. O
compilador declarava "nenhuma função registrada faz este cálculo" para a única conta que ele
sabe fazer com exatidão. A lista virou `registeredFunctions.ts`, importado por quem executa e
por quem descreve — puro, para não arrastar `db.js` ao caminho do manifesto.

Faltava ainda o casamento: `calculate_rsi` só resolvia se o Brief escrevesse o nome inteiro, e
nenhum Brief em português escreve isso. Uma segunda passada casa o termo distintivo do nome
como palavra inteira, fora de uma lista de genéricos, e **só roda quando a primeira não achou
nada** — nenhuma resolução de hoje muda, e o risco de resolver errado continua coberto.
Resolvida, a função agora consta do plano com nome: antes ela não aparecia em lugar nenhum, e
o monitor comparava um `rsi` que nada no plano produzia.

### O dublê respondia ao texto do sistema

O `LLM_FAKE` roteava por `\brsi\b`, e o prompt carrega o catálogo — que passou a descrever
`calculate_rsi` como "Calcula o RSI (Wilder)". A conversa do restaurante caiu inteira na
vigilância: 16 testes vermelhos de uma vez. O gatilho agora é o papel, não uma palavra que o
sistema também escreve.

### Um estado por monitor

Falha intermitente de "a MESMA entrega chegando por dois caminhos produz UM disparo": passa
sozinha, falha sob carga. Duas observações simultâneas do mesmo evento sobre um monitor nunca
observado produziam **dois disparos**. O caminho de atualização já punha a `version` anterior
no filtro; o de inserção não tinha o que pôr. São duas metades: índice único em
`(ownerId, monitorId)`, e `version: {$exists: false}` no filtro quando não há estado anterior
— porque, mesmo com o índice, o upsert que **encontra** documento atualiza em vez de inserir,
e o worker atrasado sobrescrevia a transição do primeiro. Quem colide sai por `lost_race`.

O índice não apaga nada: se a coleção já carrega o resultado dessa corrida, ele não sobe e o
comportamento continua o de hoje.

### A confirmação de alto risco não tinha campo

A UI declarava `requiresName` no tipo e nunca o mostrava: só um botão. A pessoa clicava, o
servidor recusava por nome ausente, e nada visível acontecia — uma operação de alto risco era
**inconfirmável pela tela**. O campo agora aparece com a instrução que diz qual nome digitar
(a mesma forma do purge de andar), o botão espera o campo, e a mensagem do servidor é
preservada como veio.

E a tentativa passou a deixar rastro. `confirmedAt` é gravado antes de executar — é o que torna
o duplo clique idempotente — e era tudo que ficava: um handler que estourava deixava a operação
"confirmada" para sempre, e a segunda tentativa lia "já foi confirmada". O desfecho agora é
gravado (`succeeded`, `refused`, `failed`, com motivo e horário), o que não deu certo responde
dizendo que pode pedir de novo, e a exceção — que saía pelo `next(erro)` sem passar pelo
registro — também vira linha de auditoria, sem a mensagem crua.

### Testes

| Arquivo | Casos |
| --- | --- |
| `architectCxse3EndToEnd.integration.test.mjs` | 14 |
| `architectAssistantCapabilities.integration.test.mjs` | 28 |
| `architectAcceptance.integration.test.mjs` | 19 |
| `architectV2OrphanWindow.integration.test.mjs` | 16 |
| `architectV2Chain.integration.test.mjs` | 6 |
| `monitors.integration.test.mjs` | 17 |
| `architect-v2-characterization.spec.ts` (E2E) | 24 |

Teeth check, um a um: revertendo o limite da regra caem 3 casos do CXSE3; a direção pelo
operador, 1; o passo do Flow, 3; a reprova depois da segunda passada, 3; o barril de funções,
1; a segunda passada do casamento, 1; a função no plano, 1; o índice único, 2; o envio do
`confirmationName`, 1 no E2E; o campo do nome, 5 no E2E; o desfecho da exceção, 1; a auditoria
da exceção, 1.

Dois dentes **não** morderam e foram removidos em vez de mantidos: o `if (enviando) return`
duplicava o `disabled` do botão, e o `corpo?.ok !== false` cobria um 200-com-erro que a rota
nunca devolve.

### Bateria de fechamento

Instalação limpa (`rm -rf node_modules` nos cinco pacotes + `npm ci`), build do monorepo,
e então:

| O quê | Comando | Resultado |
| --- | --- | --- |
| backend | `node scripts/run-tests.mjs` | **1566 + 2296 = 3862**, 0 falhas |
| frontend | `npm run test -- --run` | 294 em 36 arquivos, 0 falhas |
| runner | `npm test` | 21, 0 falhas |
| browser-worker | `npm test` | 32, 0 falhas |
| E2E | `E2E_PREVIEW=1 npx playwright test` | 744 passaram, 17 pulados, 0 flaky |
| lint | `npm run lint` (frontend) | 0 erros (avisos pré-existentes em `e2e/`) |
| smoke | `npm run smoke` | verde, incluindo 503 na prontidão e SIGTERM drenado |
| secret-scan | `npm run secret-scan` | 2267 arquivos, nada encontrado |
| smoke | `npm run smoke` | verde na corrida final; ver o SIGTERM intermitente acima |
| espaço em branco | `git diff --check` | verde |

### O que continua pendente, de verdade

- **A fonte do CXSE3** é pendência acionável, e é o certo: o Brief diz "cotação CXSE3", que é
  uma descrição e não um endereço. O teste ponta a ponta inclui o passo humano — criar a fonte
  e ligá-la por `PATCH /links` — porque é exatamente o que uma pessoa faria.
- **A conexão de entrega** também é escolha de pessoa, e continua sendo: o plano declara a
  entrega e o canal pedido, e quem aplica escolhe por qual conexão ela sai.
- **`app_dry_run`**, **streaming** e **canais/entregas no inventário** continuam como o
  relatório descreve.

---

## Fechamento II: do candle à notificação

O fechamento anterior deixou a cadeia no ar — e escondia dois buracos que só aparecem quando
alguém pergunta "mas o RSI, quem calcula?" e "mas o aviso, quem recebe?".

### O RSI não era calculado

`calculate_rsi` aparecia no Blueprint e não participava de nada. A fonte de teste entregava
`rsi` pronto e o monitor comparava esse número: **o cálculo estava desligado e nada acusava**.
Uma cadeia assim só funciona se a API já publicar o indicador — o que transfere a conta para
fora, amarra a vigilância a quem publica, e faz o teste medir o provedor.

A conta entrou pelo caminho que já existia. `onRecordWritten` — o gancho que os monitores de
dataset usam — passou a disparar uma **série derivada**: os `period + 1` últimos fechamentos
lidos na ordem certa (o RSI de Wilder é sequencial; a série invertida dá um número plausível e
errado), `calculate_rsi@1.0.0` executada pelo executor canônico, e o resultado gravado como
qualquer outra série. Nenhuma engine nova: um laço próprio lendo de tempos em tempos chegaria
atrasado, releria o mesmo registro e teria a própria noção de "já processei".

Três coisas que o desenho garante:

- **A versão fica fixada** no plano e no recorder. Atualizar a função não muda uma vigilância
  no ar sem alguém decidir isso.
- **Dado insuficiente é estado degradado com o número que falta** — "faltam 6 leituras" —,
  gravado no `lastError` do recorder. Nunca uma estimativa sobre menos pontos que a definição.
- **A conta aparece na Activity**, com raiz idempotente por registro. A que falha aparece como
  falha: uma função que para de calcular deixa o monitor sem disparar, e "não disparou" é
  indistinguível de "não aconteceu".

O que declara "esta função consome uma série, neste argumento, com este mínimo" é a **própria
função** (`series` no registro). O compilador lê de lá; guardar essa regra do lado dele seria
uma segunda verdade que envelhece.

E o campo de ENTRADA não é adivinhado: ele sai do que a pessoa disse que quer guardar
("Candles CXSE3: fechamento, rsi" diz as duas pontas). Com mais de um candidato, é pendência.

### Duas fontes do mesmo dado

O mesmo pedido produzia `fonte-avisar-rsi` (da vigilância) e `fonte-cotacao-cxse3` (da
necessidade de dado ao vivo): dois pedidos de configuração para a mesma pessoa, duas coletas do
mesmo endereço, dois históricos que divergem no primeiro erro de rede.

As necessidades passaram a ser compiladas **antes** das peças que as consomem, e a vigilância
reúsa a fonte já declarada quando as duas compartilham um termo distintivo — o papel, o SKU, o
código do sensor. Termo genérico ("cotação", "valor") não casa: seria o erro oposto e pior, com
duas vigilâncias dependendo de uma coleta que não é a delas. A fonte reusada ganha o campo que
a vigilância consome, senão ela responderia sem trazer nada do que a conta precisa.

### O aviso não chegava a ninguém

"Me avise pelo WhatsApp" terminava na Activity. A entrega era uma pendência solta; o Flow
rodava, montava o texto, e ninguém recebia.

Ela virou item do plano, ligada ao Flow, com o canal PEDIDO preservado — e o dublê de LLM
parou de trocá-lo: ele devolvia `channels: ['web']` sempre, então quem escrevia "pelo WhatsApp"
recebia um Brief correto sobre tudo menos sobre a única coisa pedida por escrito.

Do outro lado, o WhatsApp virou destino de entrega **sem duplicar credencial**: a conexão
guarda a referência ao número já conectado no App, e o token continua cifrado no canal. O envio
reconfere na hora, com o dono no filtro — entre aprovar e sair, o canal pode ter sido apagado,
desconectado, ou apontar para o widget de outra conta. E o canal que recusa levanta: devolver
silêncio marcaria como enviada uma mensagem que não saiu.

O DESTINO vem da requisição, como o `connectionId`, e não do Blueprint.

### Um defeito que apareceu no caminho

- **`registrarFalha` lia `telemetry` sem guarda** e estourava em cima do erro que estava
  registrando: o motivo real da leitura ter falhado sumia, e o que aparecia era um `TypeError`.
  É o terceiro da mesma família (`computeHealth` e `setSourceStatus` foram os anteriores).
### Um defeito que NÃO foi resolvido

**O encerramento por SIGTERM vira SIGKILL de forma intermitente.** No smoke, cerca de uma em
cada oito corridas termina com "o processo não saiu sozinho com SIGTERM". Ele é anterior a esta
fase: as mesmas corridas em `f524ad3` falham na mesma proporção.

Três hipóteses foram levantadas e as três foram **descartadas por teeth check**, e não por
opinião — cada correção foi escrita, o caso foi reproduzido isoladamente (subir o backend,
derrubar o banco, mandar SIGTERM), e o encerramento continuou saindo em ~2s com e sem ela:

- `mongoClient.close()` esperando um socket morto depois de o banco cair;
- o dreno (`Promise.allSettled` das execuções em voo) esperando execução que não termina;
- `httpServer.close()` segurado por um `keep-alive` ocioso — inclusive com o smoke alterado
  para manter um socket aberto de propósito, o que tornaria o caso determinístico se fosse ele.

As três correções foram **revertidas**: código especulativo que nenhum teste distingue é
código que ninguém consegue manter. A reprodução isolada não expõe o defeito, o que sugere que
ele depende da carga que a suíte do smoke cria (execuções, fluxos e sockets em voo). Fica
registrado com o que já foi eliminado, para quem retomar não repetir o mesmo caminho.

### Testes

| Arquivo | Casos |
| --- | --- |
| `architectCxse3EndToEnd.integration.test.mjs` | 19 |
| `dataHistoryDerived.integration.test.mjs` | 9 |
| `architectApplyV2.integration.test.mjs` | 28 |
| `architect-v2-characterization.spec.ts` (E2E) | 24 |

Teeth check: trocando a função executada caem 4 casos; fazendo o monitor observar os
fechamentos, 5; desligando o reuso de fonte, 12; tirando o canal pedido do compilador, 1;
tirando-o do dublê, 1; deixando o canal recusado passar como sucesso, 1; afrouxando o campo do
nome para "não vazio", 1 no E2E.

### Bateria de fechamento

Instalação limpa (`rm -rf node_modules` nos cinco pacotes + `npm ci`), build do monorepo, e:

| O quê | Comando | Resultado |
| --- | --- | --- |
| backend | `node scripts/run-tests.mjs` | **1566 + 2310 = 3876**, 0 falhas |
| frontend | `npm run test -- --run` | 294 em 36 arquivos, 0 falhas |
| runner | `npm test` | 21, 0 falhas |
| browser-worker | `npm test` | 32, 0 falhas |
| E2E | `E2E_PREVIEW=1 npx playwright test` | 744 passaram, 17 pulados, 0 flaky |
| lint | `npm run lint` | 0 erros |
| secret-scan | `npm run secret-scan` | 2269 arquivos, nada encontrado |
| espaço em branco | `git diff --check` | verde |

---

## Fechamento III: a verificação que faltava

O fechamento anterior declarava os itens do plano prontos com base nos próprios documentos de
progresso. **Ler um relatório não é verificar.** Esta rodada refez a conferência sub-requisito
por sub-requisito, contra o código que roda, e achou cinco coisas dadas como prontas que não
estavam. Elas estão em `OFFICE_BLUEPRINT_V2_IMPLEMENTATION_REPORT.md` §2; o resumo:

### O assistente aparecia para quem não entrou

O botão é fixo na janela, acima de tudo, e não perguntava quem estava do outro lado: aparecia no
login, no cadastro, na inicial e **dentro do widget que roda no site de outra pessoa**. Clicar
abre um painel que chama rota autenticada — a pessoa recebe erro; e no widget é o botão de um
produto aparecendo no site de um cliente. A sessão que o `ProtectedRoute` já lê passou a valer
para o assistente.

Junto veio um defeito no **stub** que só apareceu porque a checagem ficou mais estrita: o
curinga de API estava registrado depois da rota de sessão, e no Playwright a última vence. A
sessão respondia `[]` — verdadeiro em JS —, as telas abriam, e qualquer leitura de `user` saía
`undefined`.

### "Zero tokens enquanto nada muda" não era provado

Estava no objetivo e não tinha caso. Agora tem, com a prova de que o teste mede algo: as contas
acontecem, os registros existem, e `token_usage` fica em zero.

### A Central não mostrava custo

Vigiar é de graça; o que custa é o que roda depois da borda. Sem o número, um monitor com
cooldown mal ajustado só aparece na fatura. Ele é agregado das execuções que o monitor pediu,
pelo `requestId` que a Activity já usa — nunca um contador próprio, que divergiria do painel de
execuções na primeira falha de escrita.

### O último andar: a análise avisava, a exclusão não recusava

Quem chama a API direto, com hash e nome corretos, não passa pela tela que mostra o aviso. O
bloqueio precisa estar no caminho que apaga.

### A imagem e a biblioteca podiam divergir

O Dockerfile avisava em comentário que a tag do Playwright e a versão do `package.json` andam
juntas, e que a divergência falha ao abrir o navegador com um erro que não diz isso. Virou teste.

### O resto desta rodada

- **`qs`**: uma moderada no `npm audit`. `audit fix` mudava zero pacotes e `overrides` na raiz o
  npm registrava e ignorava (instalava 6.15.3 marcando `invalid`). `qs@^6.16.0` como dependência
  explícita do backend resolve, com uma cópia deduplicada. **0 vulnerabilidades.**
- **Code splitting**: 1,4 MB num pacote só → **608 KB** de entrada em 47 pedaços. A guarda custou
  duas tentativas: verificar "o pacote da Central não foi baixado" não morde, porque um `import`
  estático não cria pedaço nenhum — ele costura a página na entrada e o nome some. O que
  discrimina é o peso.
- **Três portas para a mesma sala**: "Montar operação" saiu do menu de andares e da folha do
  celular. Dois testes E2E afirmavam a duplicata e foram invertidos.

### O build Docker do backend estava quebrado

Sem daemon de container aqui, o primeiro registro foi "builds Docker não executados". Isso é
aceitar a limitação em vez de trabalhar dentro dela: a maior parte do que um build verifica é
conferível sem daemon.

O Dockerfile do backend copia `package.json` e `package-lock.json` do contexto dele e roda
`npm ci`, que não resolve nada — instala o que o lock diz e recusa quando os dois discordam.
Rodando esse comando exato numa cópia isolada do contexto, ele **falhava**: `ws` e `qs` estavam
no `package.json` do backend e não no lock dele. O `ws` já estava assim **antes** desta rodada.

O mecanismo é o que torna isso invisível: num monorepo de workspaces, `npm install` na raiz
atualiza o lock **da raiz**; o lock do pacote, que só a imagem usa, fica para trás. Passa na
máquina de quem editou e quebra no deploy.

Os locks foram regravados no contexto isolado e `npm ci` passa a aceitá-los. O invariante virou
teste em `deployment.test.mjs`, junto de outro que confere se todo `COPY` dos quatro Dockerfiles
aponta para algo que existe. Teeth check nos dois.

### E o worker do browser nunca renderizaria, em silêncio

Executar os comandos das camadas — e não só olhar os arquivos — achou o segundo defeito. O
`package.json` do `browser-worker` depende de `playwright` e o Dockerfile **não instalava nada**:
a imagem base traz o navegador, não o pacote npm, e a resolução do Node não alcança o pacote
global da base.

O silêncio é por desenho: `loadEngine` captura a falha e devolve `null` para o worker continuar
servindo `fetch` em vez de morrer sem navegador — decisão certa, que aqui escondia o defeito. O
`HEALTHCHECK` é TCP e passa. O resultado seria uma fonte de página configurada na Central que
nunca renderiza, sem alarme nenhum.

### O que foi executado de verdade, sem daemon

Montei o contexto de build real de cada pacote (respeitando o `.dockerignore`) e rodei os `RUN`
na ordem do Dockerfile. O host é Node `v22.17.1` contra `node:22` das imagens — mesmo major.

- backend: `npm ci --include=dev` → `npm run build` → `dist/index.js` e `dist/worker.js` existem;
- backend runtime: `npm ci --omit=dev` e o `dist` **resolvem todos os imports**, parando em
  "Missing required production environment variable: CLIENT_URL" — onde uma imagem correta para;
- frontend: `npm ci` + `npm run build` → `dist/index.html`, com `nginx.conf` no contexto;
- browser-worker: `npm ci --omit=dev` e `import('playwright')` resolvendo de `/app`.

O que exige daemon passou a rodar na **CI**, que já existia e já construía backend e frontend. O
comentário que estava lá dizia: "um Dockerfile que só é exercitado na hora do deploy é um
Dockerfile que falha na hora do deploy" — e as duas imagens que ela não exercitava eram as duas
que estavam quebradas.

`runner` e `browser-worker` passam a ser construídos junto, e o worker do browser é **levantado**:
`/health` carrega o motor de verdade e responde `capabilities.render`; `false` derruba o job. A
requisição vai assinada como o backend assina, e o container sobe com as travas que o Dockerfile
documenta. Conferido localmente contra o worker real — com Playwright, `"render":true`; sem ele,
`false`.

O que falta é o job rodar uma vez. Nesta máquina não há daemon, e isso não muda.

### Bateria

backend **1576 + 2316 = 3892** · frontend 294 · E2E 747 (17 pulados) · runner 21 ·
browser-worker 33 · smoke 7/7 · lint 0 erros · audit **0 vulnerabilidades** · secret-scan 2269 ·
`git diff --check` limpo.

**Builds Docker não rodaram**: não há runtime de container nesta máquina (`docker`, `podman`,
`nerdctl`, `finch`, `colima`, `lima`, `buildah`, `img` — nenhum). Falha de infraestrutura fica
registrada como tal, nunca como sucesso.
