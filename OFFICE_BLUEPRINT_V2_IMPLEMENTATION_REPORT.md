# Office Blueprint V2 — relatório de implementação

Estado do repositório na escrita: branch `development`. As mudanças desta rodada estão
commitadas em sete commits separados, listados na seção 8.

Este documento existe para responder uma pergunta de cada vez: **o que está pronto, o que está
pronto pela metade, e o que está bloqueado — e como saber a diferença sem confiar em mim.** Cada
afirmação aponta o teste que a sustenta. Onde não há teste, está escrito que não há.

---

## 1. O que esta rodada mudou

Li os documentos de progresso existentes (`OFFICE_ARCHITECT_BLUEPRINT_V2_PROGRESS.md`,
`MONITORING_CENTER_PROGRESS.md`, `OFFICE_PLATFORM_RESOURCE_COMMUNITY_PROGRESS.md`,
`DEPLOYMENT_ENVIRONMENT_MATRIX.md`) e conferi o código.

**Um aviso sobre a primeira versão deste documento**: ela declarava os itens 1 a 6 prontos com
base nesses documentos e na existência dos arquivos. Ler um relatório de progresso não é
verificar; a seção 2 refaz isso sub-requisito por sub-requisito, e encontrou **cinco coisas que
eu havia dado como prontas e não estavam** — inclusive o assistente aparecendo para quem não
entrou, dentro do widget que roda no site de outra pessoa.

O que estava pendente e foi feito, começando pelo que já era visível sem verificação:

### 1.1 As três portas para a mesma sala (item 1)

"Montar operação" existia em **três** lugares: a navegação (`navConfig`, presente também no
`MobileNav`), o menu de andares (`BuildingSwitcher`) e a folha de andares do celular
(`MobileFloorPicker`). Com o assistente flutuante em toda página autenticada, são quatro
caminhos para a mesma tela — e o que fica escondido dentro de um menu de escolher andar é o que
ninguém encontra.

As duas duplicatas saíram. O menu de andares voltou a ser o que o nome diz: escolher e criar
andar. A navegação continua levando a `/architect`, que segue sendo a área completa de projetos.

Dois testes E2E **afirmavam a duplicata** e foram invertidos — eles agora provam que o menu não
a repete e que o caminho que sobrou funciona.

### 1.2 A vulnerabilidade do `qs` (item 7)

`npm audit` acusava uma moderada: `qs` na faixa `2.2.5 – 6.15.3`, duas advisories
(GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g). O `qs@6.15.3` chegava por `express@5.2.1` e
`body-parser@2.3.0`.

`npm audit fix` não resolvia: o dry-run mudava zero pacotes. Um `overrides` no `package.json` da
raiz **também não** — o npm registrava o override (`npm explain qs` dizia "overridden") e
continuava instalando 6.15.3, marcando-o como `invalid`. O caminho que o npm honra é a
dependência explícita.

`qs@^6.16.0` entrou como dependência do backend. Express declara `qs@^6.14.0` e body-parser
`qs@^6.15.2`; 6.16.0 satisfaz os dois, e a árvore ficou com **uma cópia deduplicada**:

```
backend@1.0.0
├─┬ express@5.2.1
│ ├─┬ body-parser@2.3.0
│ │ └── qs@6.16.0 deduped
│ └── qs@6.16.0 deduped
└── qs@6.16.0
```

`npm audit`: **0 vulnerabilidades**. O diff no `package-lock.json` tem 7 linhas.

**A honestidade que falta aqui**: o backend não importa `qs` diretamente — quem o usa é o
Express. Declará-lo como dependência do backend é o mecanismo, não a semântica. O `overrides`
diria melhor o que se quis dizer, e por isso vale registrar por que ele não foi usado: o npm
10.9.2 não o aplicou nesta árvore, e código que não faz o que promete é pior que código feio.

Regressão: o `qs` do Express é quem parseia query string. A prova é a suíte inteira do backend
(2310 casos de integração, quase todos passando por rotas HTTP) — **0 falhas**.

### 1.3 Code splitting (item 7)

O frontend era **um pacote de 1,4 MB** — tudo, para quem abre a tela de login. A Central de
monitoramento sozinha tem 2.029 linhas.

As páginas autenticadas passaram a chegar sob demanda (`lazy` + um `Suspense` para todas as
rotas). As públicas — `/`, `/login`, `/register`, `/widget/:publicKey` — continuam no primeiro
paint: um `Suspense` nelas trocaria a página inicial por um vazio piscando.

| | antes | depois |
| --- | --- | --- |
| pacote de entrada | 1,4 MB | **608 KB** |
| pedaços | 1 | 47 |

**A guarda** (e ela custou duas tentativas): o primeiro teste que escrevi verificava que os
pacotes das páginas pesadas não eram baixados na tela pública. Ele **não morde** — um `import`
estático não cria pedaço nenhum, ele costura a página dentro do pacote de entrada, e o nome some
junto. O teste passava com o defeito de volta.

O que discrimina é o **peso**. O caso agora soma os bytes de script baixados em `/login` e exige
menos de 900 KB. Teeth check: revertendo `App.tsx` para imports estáticos, o pacote volta a
1,4 MB e o caso **reprova**.

---

## 2. A verificação item a item — e os cinco buracos que ela achou

A primeira versão deste relatório dizia que os itens 1 a 6 estavam prontos, com base nos
documentos de progresso e na existência dos arquivos. **Isso não é verificação.** Refiz o
trabalho conferindo cada sub-requisito contra o código que roda, e cinco coisas que eu havia
dado como prontas não estavam.

### 2.1 O assistente aparecia para quem não entrou (item 1)

O botão é `position: fixed`, canto inferior direito, acima de tudo — e não perguntava quem
estava do outro lado. Ele aparecia na tela de **login**, na de **cadastro**, na inicial e — o
pior caso — **dentro do widget que roda no site de outra pessoa**. Clicar ali abre um painel que
chama rota autenticada: a resposta é um erro; e no widget é o botão de um produto aparecendo no
site de um cliente.

A sessão que o `ProtectedRoute` já lê passou a valer para o assistente também. Teeth check:
removendo o gate, o caso reprova.

Junto veio um defeito no **stub dos testes** que só apareceu porque a checagem ficou mais
estrita: `page.route('**/api/…')` genérico estava registrado **depois** da rota de sessão, e no
Playwright a última registrada ganha. A sessão respondia `[]` — um array, que é verdadeiro em
JS. As telas abriam (o `ProtectedRoute` só testa se há algo) e qualquer leitura de `user` saía
`undefined`. Um stub que mente assim faz o teste medir outra coisa.

### 2.2 "Não gastar tokens enquanto nada mudar" não era provado (item 2)

O requisito estava no objetivo e não tinha caso. Agora tem: 16 leituras entram, o RSI é
calculado em todas, a condição não acontece, e `token_usage` fica em **zero** — com a prova de
que o teste está medindo algo (as contas aconteceram, os registros existem). Uma vigilância que
custa parada é a que ninguém deixa ligada.

### 2.3 A Central não mostrava custo (item 3)

O objetivo pede custos; a tela não tinha nenhum. Vigiar é de graça — a coleta e a comparação são
determinísticas. O que custa é o que roda **depois** da borda, quando o Flow tem etapa de modelo.
Sem esse número, um monitor com cooldown mal ajustado só aparece na fatura, e "qual deles está
gastando?" não tinha resposta em lugar nenhum do produto.

O número é agregado das execuções que o monitor pediu — correlacionadas pelo `requestId`
(`monitor:<id>:<evento>`), o mesmo fio que a Activity usa —, e não de um contador próprio: um
contador divergiria do painel de execuções na primeira falha de escrita, e a mesma pergunta
passaria a ter duas respostas. Zero é **dito**, não omitido: campo em branco se lê como "não
sei".

Teeth check: tirando o `ownerId` do filtro da agregação, o caso da execução de outra conta
reprova.

### 2.4 O último andar: a análise avisava, a exclusão não recusava (item 4)

O teste existente provava que `floorDeletionImpact` reporta o bloqueio. Não provava que
`purgeFloor` **recusa**. São coisas diferentes: quem chama a API direto, com o hash e o nome
corretos, não passa pela tela que mostra o aviso. O caso agora vai até o fim e confere que o
andar continua lá.

### 2.5 A imagem e a biblioteca podiam divergir (item 5)

O próprio Dockerfile avisa que a tag do Playwright e a versão do `package.json` andam juntas, e
que uma divergência falha ao abrir o navegador com um erro que não diz isso. Era um comentário.
Agora é um teste: dois números, um arquivo cada. Teeth check: baixando a tag para `v1.61.0`, o
caso reprova.

### 2.6 O build Docker do backend estava QUEBRADO — e eu piorei antes de descobrir

Sem daemon de container nesta máquina, eu havia registrado "builds Docker não executados" e
parado aí. Isso é aceitar a limitação em vez de trabalhar dentro dela: a maior parte do que um
build de imagem verifica é conferível sem daemon nenhum.

O Dockerfile do backend copia `package.json` e `package-lock.json` do contexto dele e roda
`npm ci` — que **não resolve nada**: instala exatamente o que o lock diz, e recusa quando os
dois discordam. Rodando esse comando exato numa cópia isolada do contexto:

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json or npm-shrinkwrap.json are in sync.
```

**O build falhava.** Duas dependências estavam no `package.json` do backend e não no lock dele:
`qs` (que eu acabara de acrescentar) e **`ws` — que já estava assim antes desta rodada**.

O mecanismo do defeito é o que o torna invisível: este é um monorepo de workspaces, e
`npm install` na raiz atualiza o lock **da raiz**. O lock do pacote, que só a imagem usa, fica
para trás. Tudo passa na máquina de quem editou; o build quebra no deploy. A única forma de
descobrir era construir a imagem, e ninguém construiu.

Os dois locks foram regravados no contexto isolado — o mesmo que o Docker usa — e `npm ci` passa
a aceitá-los. O do frontend já estava são.

E o invariante virou teste, em `deployment.test.mjs`, que é onde a forma do deploy já era
guardada: para cada pacote com Dockerfile, o `package.json` e o lock precisam concordar em nome
**e** faixa de versão; e todo `COPY` precisa apontar para algo que existe no contexto — a
segunda causa mais comum de "funciona aqui e não no deploy". Teeth check nos dois: tirando `qs`
do lock, reprova; apontando um `COPY` para um diretório inexistente, reprova.

### 2.7 O worker do browser nunca renderizaria — em silêncio

Executar os comandos das camadas (em vez de só olhar os arquivos) achou o segundo defeito de
produção, e este é do item 5 diretamente.

O `package.json` do `browser-worker` depende de `playwright`. **O Dockerfile dele não instalava
nada** — só copiava `package.json` e `src`. A imagem base traz o *navegador*, não o pacote npm, e
a resolução do Node sobe por `node_modules` a partir do arquivo: o pacote global da base não está
nesse caminho.

O que torna isso grave é o silêncio, e ele é por desenho: `loadEngine` captura a falha e devolve
`null` para o worker continuar servindo `fetch` em vez de morrer sem navegador — decisão certa,
que aqui esconde o defeito. O `HEALTHCHECK` é TCP e passa. O resultado seria uma fonte de página
configurada na Central que **nunca renderiza**, sem nenhum alarme.

`npm ci --omit=dev` com lock próprio, e `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` porque os
navegadores já estão em `/ms-playwright`. Verificado no contexto real: o `npm ci` passa e
`import('playwright')` resolve.

O invariante virou teste: **toda imagem instala as dependências que declara**, e quem roda
`npm ci` copia o lock. Teeth check: tirando a linha do Dockerfile, reprova.

### 2.8 O item 1, conferido peça por peça — e o slot que evaporaria

"O blueprint deve criar/ajustar andares, setores, agentes, responsabilidades, knowledge, apps,
permissões, databases, tools, flows, routines e monitors usando chaves estáveis" é o
sub-requisito mais fácil de afirmar e o mais difícil de provar. Fui atrás de cada peça.

**Quem cria o quê.** O contrato do V2 declara dezoito listas. A aplicação do V2 percorre dez —
`databases`, `datasets`, `tools`, `channels`, `sources`, `liveDestinations`, `histories`,
`monitors`, `flows`, `deliveries`. As outras (andar, setor, agente, responsabilidade, knowledge,
rotina, grant) são criadas pela saga do V1 **na mesma operação**, com o mesmo `resourceMap`, a
mesma auditoria e a mesma retomada — é isso que impede uma segunda engine de existir. Os dois
documentos descrevem UM escritório.

**A terceira possibilidade, que ninguém tinha como ver.** Uma lista declarada que *nenhum* dos
dois percorre: um item ali não é criado, não vira pendência e não aparece na prévia. Ele
simplesmente não existe, e a proposta diz que existe. `resources.memoryPolicies` é esse caso —
nenhum compilador o emite hoje, então nada some, mas basta alguém emitir um.

Virou teste: todo item declarado nas listas que a aplicação percorre precisa virar passo —
criado, reusado ou pendência **com motivo**. Teeth check: tirando `resources.tools` do registro,
reprova.

**As chaves.** Um segundo caso percorre todas as listas e afirma que nenhuma chave é um
ObjectId, que todas são slugs estáveis em minúsculas, e que **duas compilações do mesmo Brief
produzem exatamente as mesmas chaves** — senão uma revisão criaria recursos ao lado dos que já
existem, em vez de ajustá-los.

**O resto do item 1** já tinha prova e foi conferido contra ela: a separação entre pergunta
informativa e ação estrutural é o `intent` decidido no servidor (`answer` / `operate` /
`explain` / `propose`), com `answer` consultando a fonte real e devolvendo valor, fonte e
horário; e o ciclo plano → validação → prévia/diff → impacto → confirmação → saga idempotente →
auditoria é o que `architectApply`, `architectApplyV2` e os 26 casos E2E cobrem.

### 2.9 O item 6, conferido peça por peça

O catálogo está em `src/extensions/`, com 46 casos entre `extensions.integration.test.mjs` (34) e
`extensionTemplates.integration.test.mjs` (12). O que eles provam, um a um contra o que o
objetivo pede:

- **draft → review → published**: o ciclo é um grafo, e um salto que ele não prevê não acontece;
  aprovar e publicar são da revisão, não do autor;
- **versionamento imutável**: republicar o mesmo número é recusado, e o hash ignora a ordem das
  chaves — reescrita cosmética não é versão nova;
- **instalação**: fixa a versão, e o autor publicar não muda o que já roda;
- **permissões**: o diff diz o que a versão nova passa a poder fazer; perder permissão não exige
  aprovação, ampliar exige; MAIOR diferente é marcado incompatível e não atualiza sozinho;
- **secrets protegidos**: credencial dentro do manifesto impede a publicação, e a recusa não
  repete o segredo; a instalação não traz credencial, grant nem dado do autor;
- **isolamento por owner**: o pacote de outra pessoa não se submete, e o pacote privado de outra
  conta não existe para instalar;
- **suspensão**: exige motivo, o motivo fica visível para quem instalou, e ela barra a execução
  do que já estava instalado — fail-closed.

**Código de usuário não executa**, que é o que o objetivo autoriza explicitamente enquanto a
sandbox segura não puder ser entregue. O portão é `extensionRuntime/gate.ts`, e
`CODE_TOOLS_ENABLED=1` sozinho não basta — é a diferença entre uma flag e uma garantia. Está em
§6.1 com o que falta para destravá-lo.

### 2.10 O que a verificação confirmou como pronto

| Item | Prova conferida |
| --- | --- |
| **1** — contrato V2 com compat V1, chaves estáveis, plano→validação→preview→confirmação→saga idempotente→auditoria, pergunta informativa separada de ação | `architectApply`, `architectApplyV2`, `architectAssistant*`, `architectV2*`; `architect-app.spec.ts`, `architect-v2-characterization.spec.ts` (26 casos) |
| **2** — cadeia CXSE3 completa | `architectCxse3EndToEnd.integration.test.mjs` (20), `dataHistoryDerived.integration.test.mjs` (9) |
| **3** — nove tipos de fonte (`api_polling`, `webhook`, `websocket`, `app_action`, `rss`, `http_page`, `browser`, `dataset`, `internal_event`), cinco abas, criação guiada, teste, mapping, condição, destino, retry/backoff, pausa, histórico | `e2e/monitoring-center.spec.ts` (48 casos) |
| **4** — impacto completo, compartilhado só desvinculado, nome digitado, idempotente, auditado | `architectV2FloorImpact.integration.test.mjs` (26 casos) |
| **5** — Chromium na imagem oficial, `pwuser`, healthcheck, SSRF, kill switch, limites, visão como fallback | `browser-worker/test/worker.test.mjs` (33), `DEPLOYMENT_ENVIRONMENT_MATRIX.md` 77–81 |
| **6** — draft/review/published, versão imutável, instalação, permissões, isolamento por owner | `OFFICE_PLATFORM_RESOURCE_COMMUNITY_PROGRESS.md`; código executa **desligado** (§6.1) |

### Sobre o item 2, com precisão

A frase *"Observe CXSE3 e me avise pelo WhatsApp quando o RSI ficar abaixo de 30"* entra por
`POST /api/architect/assistant/turn` e sai com a cadeia no ar. O que o teste prova, e vale
destacar porque é o ponto onde a versão anterior mentia:

- a origem entrega **fechamentos**, nunca `rsi`. Uma API que devolvesse o indicador pronto faria
  o teste medir o provedor, com o cálculo desligado e ninguém percebendo;
- `calculate_rsi@1.0.0` roda pelo executor canônico, disparada por `onRecordWritten` — o mesmo
  gancho dos monitores de dataset. Não há segundo motor;
- o número gravado é conferido **contra a própria função** sobre a série guardada. Escrevê-lo à
  mão provaria que alguém digitou o mesmo valor duas vezes;
- dado insuficiente vira estado degradado com o que falta ("faltam 6 leituras"), nunca estimativa;
- a queda real dos fechamentos cruza 30 e produz **uma** execução e **uma** entrega; repetir o
  mesmo fechamento não recalcula, não redispara e não reentrega;
- sem conexão escolhida, a entrega fica pendente e o Flow **não** ganha um passo apontando para o
  nada; com o canal recusando, a entrega é marcada como falha, com motivo, sem ecoar a resposta
  do provedor;
- nem o plano nem a Activity carregam credencial ou endereço.

---

## 3. Migrações

Nenhuma nesta rodada. As anteriores relevantes, todas aditivas e retrocompatíveis:

- `data_recorders.derivedFrom` — campo opcional; um recorder sem ele continua sendo série de
  origem externa;
- `monitor_states` — índice único `(ownerId, monitorId)`, criado na migração e **não destrutivo**:
  se a coleção já carrega o resultado da corrida que ele previne, o índice não sobe e o
  comportamento continua o de hoje. Decidir qual estado vale é escolha de quem administra;
- `connections.provider` aceita `whatsapp`, cuja config guarda **apenas** `widgetId` — a
  credencial continua cifrada no canal do App.

---

## 4. Decisões desta rodada

**Dependência explícita em vez de `overrides` para o `qs`.** O `overrides` é o mecanismo certo no
papel; ele não funcionou nesta árvore com npm 10.9.2. Preferi o que resolve de verdade e
documentar a razão.

**O corte do bundle é por autenticação, não por tamanho.** Poderia ser por peso — separar só as
páginas grandes. Mas o primeiro paint de quem não entrou é a métrica que importa, e a linha
"depois do login" é estável: ela não muda quando uma página engorda.

**Um `Suspense` para todas as rotas, com fallback vazio.** Um "carregando" que aparece e some em
80 ms é mais ruído que informação. O que não pode é a página anterior sumir sem nada no lugar —
por isso a área mantém a altura da janela.

**As duplicatas saíram em vez de ganharem rótulo diferente.** Renomear resolveria a confusão de
nome e manteria a de lugar.

---

## 5. Testes executados

Tudo abaixo rodou nesta árvore, nesta ordem. A instalação foi `rm -rf node_modules` nos cinco
pacotes seguido de `npm install` — e não `npm ci`, porque o lock mudou nesta rodada (o `qs`) e
`npm ci` exige lock e `package.json` já sincronizados.

| O quê | Comando | Resultado |
| --- | --- | --- |
| build monorepo | `npm run build` | 0 erros |
| typecheck frontend | `npx tsc --noEmit` | 0 erros |
| backend | `node scripts/run-tests.mjs` | **1576 + 2316 = 3892**, 0 falhas |
| frontend | `npm run test -- --run` | 294 em 36 arquivos, 0 falhas |
| runner | `npm test` | 21, 0 falhas |
| browser-worker | `npm test` | 33, 0 falhas |
| E2E | `E2E_PREVIEW=1 npx playwright test` | 747 passaram, 17 pulados |
| smoke (inclui `mvp-smoke.spec.ts`) | `npm run smoke` | 7/7 |
| lint | `npm run lint` | 0 erros |
| audit | `npm audit` | **0 vulnerabilidades** |
| segredos | `npm run secret-scan` | 2269 arquivos, nada encontrado |
| espaço em branco | `git diff --check` | limpo |

**Não há runtime de container nesta máquina** — procurei `docker`, `podman`, `nerdctl`, `finch`,
`colima`, `lima`, `buildah` e `img`, e nenhum existe. Construir imagens é impossível aqui, e isso
fica registrado como falha de infraestrutura, nunca como sucesso.

Mas "não construí a imagem" e "não executei o que ela executa" são coisas diferentes. Os
comandos das camadas rodam em Node, e o host é `v22.17.1` contra `node:22` das imagens — mesmo
major. Montei o **contexto de build real** de cada pacote (respeitando o `.dockerignore`, arquivo
por arquivo) e rodei os `RUN` na ordem do Dockerfile:

| Camada | Comando | Resultado |
| --- | --- | --- |
| backend `build` | `npm ci --include=dev` | passa (falhava — §2.6) |
| backend `build` | `npm run build` | passa; `dist/index.js` e `dist/worker.js` existem — os dois alvos de `CMD` |
| backend `deps` | `npm ci --omit=dev` | passa |
| backend `app` | `import('./dist/index.js')` sobre o `node_modules` de produção | **resolve todos os imports** e para em "Missing required production environment variable: CLIENT_URL" — exatamente onde uma imagem correta para sem env |
| frontend `build` | `npm ci --include=dev` + `npm run build` | passa; `dist/index.html` existe; `nginx.conf` está no contexto |
| browser-worker | `npm ci --omit=dev` | passa, e `import('playwright')` resolve a partir de `/app` (§2.7) |
| runner / browser-worker | `node --check` no alvo de `CMD` | passa |

O que **continua sem cobertura** e precisa de daemon: as camadas empilharem de verdade, o
`COPY --from=` entre estágios, o usuário sem privilégio, o healthcheck, e o container subir. É o
primeiro dos próximos passos.

O que sobrou virou teste, para não depender de alguém repetir isto à mão: sincronia
`package.json` ↔ lock por pacote, todo `COPY` conferido contra o contexto, toda imagem
instalando o que declara, e a tag do Playwright contra a versão da biblioteca.

---

## 6. Limitações reais

### 6.1 Bloqueadas por decisão, com o portão fechado

**Código de usuário não executa.** A fronteira, o scanner, o broker e o kill switch existem e
são testados; nada executa código. `CODE_TOOLS_ENABLED` fica desligado e é isso que o portão
garante. O scanner é **léxico**, não AST — está dito no arquivo e nos testes: ele é a primeira
peneira, nunca a defesa. Entregar sandbox segura exige um runtime provider fora deste
repositório.

### 6.2 Pendências honestas herdadas

- o Marketplace não tem página de detalhe por item nem "reportar item";
- revisão de pacote não tem tela: a transição existe na API, e o papel de revisor vem da
  plataforma (`res.locals.isReviewer`), nunca do corpo do pedido;
- `color: var(--intent-danger)` aparece como cor de **texto** em 21 arquivos fora da Central. É o
  mesmo defeito de contraste já corrigido lá (2,81:1 contra o mínimo de 4,5:1), e a correção é a
  mesma troca de token. São 21 telas que aquele trabalho não revisou;
- `app_dry_run` fica pendente para todo App: nenhum manifesto do catálogo declara execução de
  teste;
- a conversa global não tem streaming, e nenhum provider desta base faz streaming;
- o inventário não reaproveita canais e entregas: um canal já conectado não é oferecido de volta
  pelo plano.

### 6.3 Um defeito conhecido e **não resolvido**

**O encerramento por SIGTERM vira SIGKILL em cerca de uma em cada oito corridas do smoke.** É
anterior a este trabalho — as mesmas corridas em `f524ad3` falham na mesma proporção.

Três hipóteses foram levantadas e as três **descartadas por teeth check**: cada correção foi
escrita, o caso reproduzido isoladamente (subir o backend, derrubar o banco, mandar SIGTERM), e o
encerramento continuou saindo em ~2 s com e sem ela:

1. `mongoClient.close()` esperando um socket morto depois de o banco cair;
2. o dreno (`Promise.allSettled` das execuções em voo) esperando execução que não termina;
3. `httpServer.close()` segurado por um `keep-alive` ocioso — inclusive com o smoke alterado para
   manter um socket aberto de propósito, o que tornaria o caso determinístico se fosse ele.

As três correções foram **revertidas**: código especulativo que nenhum teste distingue é código
que ninguém consegue manter. A reprodução isolada não expõe o defeito, o que sugere que ele
depende da carga que a suíte do smoke cria. Fica registrado com o que já foi eliminado, para
quem retomar não repetir o caminho.

---

## 7. Próximos passos, na ordem em que eu faria

1. **CI que construa as quatro imagens.** É o único jeito de fechar o que sobrou do item 5, e
   esta rodada mostrou o preço de não ter: o build do backend estava quebrado havia quanto
   tempo ninguém sabe.
2. **O SIGTERM.** Instrumentar o encerramento com um log por etapa concluída e rodar o smoke em
   laço até capturar a falha: a etapa que não registra é a que trava. As três já eliminadas estão
   acima.
3. **O token de texto vermelho nas 21 telas.** Mecânico e conhecido; o token já existe.
4. **Tela de revisão de pacote e detalhe de item** no Marketplace — a API já tem a transição.
5. **Runtime provider de sandbox**, fora deste repositório, para destravar `CODE_TOOLS_ENABLED`.


---

## 8. Os commits desta rodada

| Hash | O quê |
| --- | --- |
| `72c9a73` | `fix(deploy)`: o `npm ci` da imagem recusava — locks fora de sincronia, e o `qs` |
| `776b63a` | `fix(browser-worker)`: a imagem instala o Playwright que ela declara |
| `aeab295` | `fix(architect)`: o assistente só existe para quem entrou |
| `03bb985` | `feat(monitoring)`: o custo de cada alarme na Central |
| `3ca1101` | `refactor(nav)`: uma porta só para "Montar operação" |
| `e4f1353` | `perf(frontend)`: páginas autenticadas sob demanda |
| `ec207ec` | `test`: as provas que faltavam nos itens 2, 4 e 5 |

Mais o commit deste relatório e dos documentos de progresso.

### Arquivos, por assunto

| Arquivo | O quê |
| --- | --- |
| `backend/package.json`, `backend/package-lock.json`, `package-lock.json` | `qs@^6.16.0`, e `ws` que faltava no lock do pacote |
| `backend/test/deployment.test.mjs` | lock↔package.json, `COPY` e "instala o que declara", por pacote |
| `browser-worker/Dockerfile`, `browser-worker/package-lock.json` | `npm ci --omit=dev` sem rebaixar navegador |
| `browser-worker/test/worker.test.mjs` | a tag do Playwright contra a versão da biblioteca |
| `backend/src/monitors/service.ts` | custo por monitor, agregado das execuções numa consulta só |
| `frontend/src/App.tsx` | páginas autenticadas sob demanda; `Suspense` único; públicas eager |
| `frontend/src/components/ArchitectAssistant.tsx` | o assistente só existe com sessão |
| `frontend/src/components/BuildingSwitcher.tsx`, `MobileFloorPicker.tsx` | as duas duplicatas removidas |
| `frontend/src/lib/monitors.ts`, `frontend/src/pages/MonitoringCenter.tsx` | o custo na linha de cada monitor |
| `backend/test/architectCxse3EndToEnd…`, `architectV2FloorImpact…`, `monitorService…` | zero tokens; a exclusão recusa; custo com posse no filtro |
| `frontend/e2e/*.spec.ts` | duplicatas invertidas, peso do primeiro paint, assistente fora das páginas públicas, custo na Central, ordem das rotas do stub |
