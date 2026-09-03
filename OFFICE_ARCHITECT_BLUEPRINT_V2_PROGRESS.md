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
