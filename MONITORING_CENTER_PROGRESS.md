# Central de Monitoramento — progresso

## O problema, dito como ele é

Monitorar já funciona no produto, e é justamente esse o problema: funciona em cinco lugares
diferentes. WebSocket está no App, webhook nos Flows, páginas web no agente, fontes ao vivo
num módulo próprio, dataset em Databases. Quem quer saber "o que este escritório está
vigiando?" precisa abrir cinco telas e juntar de cabeça.

A resposta **não** é um motor novo. Cada mecanismo desses funciona e tem teste. O que falta
é o lugar onde eles aparecem como uma coisa só, com a mesma pergunta em todos: está online?
qual foi a última leitura? o que ela dispara?

## ADR 001 — `MonitoringSource` é orquestração, nunca motor

Uma fonte guarda **referências** aos subsistemas que já existem — o recorder do histórico, a
fonte ao vivo, a instalação do App, o gatilho de webhook, o dataset. Ela não reimplementa
polling, backoff nem reconexão.

O motivo é concreto: duplicar o polling criaria dois lugares decidindo backoff, e no dia em
que divergissem um estaria tentando de novo o que o outro desistiu. O mesmo vale para
retry, dedupe e retenção.

Consequência aceita: a Central depende dos subsistemas para funcionar, e uma fonte só faz o
que o subsistema dela sabe fazer. É o preço de não ter uma segunda verdade.

## ADR 002 — o extrator é dado, não código

A tentação óbvia num mapeamento é aceitar uma expressão: "só um JSONPath completo", "só uma
function". As duas viram execução de código de terceiro dentro do processo que tem o banco —
a mesma porta que a sandbox existe para fechar, reaberta por conveniência.

O que existe é um caminho (`dados.itens[0].preco`) e uma lista **fechada** de transformações.
Sem curinga, sem filtro, sem recursão. Quando isso não bastar, a resposta é uma ferramenta
de código na sandbox — não uma expressão aqui.

## Bloco 1 — o núcleo: modelo e extrator ✅

`backend/src/monitoring/types.ts` e `mapping.ts`.

- **nove tipos de fonte** declarados com as capacidades de cada um (`KIND_CAPABILITIES`), para
  a tela não oferecer o que aquele tipo não faz;
- cada fonte carrega escopo, conexão (referência, nunca segredo), schema, **mapeamento
  versionado**, cadência, retry com **backoff + jitter**, rate limit, freshness/stale,
  dedupe, destino (ao vivo e/ou histórico), retenção e telemetria;
- o jitter não é detalhe: sem ele, cem fontes que caíram juntas voltam juntas, e a primeira
  tentativa depois de um incidente vira o segundo incidente;
- `staleAfterMs` existe porque, sem ele, uma fonte que parou de responder continua "verde"
  com o valor de três dias atrás — e um monitor decide sobre um número que já não é verdade.

**Dois furos reais fechados pelos testes:**

1. `readPath` alcançava `a.prototype` quando o documento de exemplo não tinha `a` — a
   travessia saía cedo e o trecho perigoso nunca era olhado. A conferência passou a ser da
   **forma** do caminho, antes de qualquer travessia;
2. `validateMapping` aceitava `__proto__` como nome de DESTINO. Escrever essa chave na linha
   envenenaria o objeto que o monitor lê depois.

Mais: ausente não vira zero (`Number(null)` é 0, e um campo que sumiu dispararia alarme —
é o mesmo defeito que o monitor já corrigiu uma vez), `replace` é literal e nunca regex
(regex vinda de fora é travamento esperando acontecer), e a amostra da tela é **redigida**
por nome de campo E por formato do valor.

Comando: `node --test test/monitoringMapping.test.mjs` → **23/23**.

## Bloco 2 (parcial) — saúde derivada e backoff ✅

`backend/src/monitoring/health.ts`.

- **a saúde é calculada, nunca gravada.** Um campo `health` no banco vira mentira no
  primeiro processo que esquece de atualizá-lo: a fonte para às três da manhã e a tela
  continua verde porque ninguém rodou o job;
- **`degraded` é o estado que o produto mais precisa dizer**: "online" e "offline" não
  descrevem o caso mais comum, que é a fonte responder com dado velho demais para decidir
  alguma coisa. Ele aparece por falhas seguidas (3) **ou** por idade além da janela;
- **`never_read` não é "online"**: dizer online sobre uma fonte que nunca leu seria afirmar
  sobre algo que não aconteceu;
- **fonte que empurra não tem "próximo disparo"** — ela chega, não é chamada. Devolver um
  horário ali seria a tela prometendo um evento que ninguém agendou;
- **o backoff tem jitter e teto**: sem jitter, cem fontes que caíram juntas voltam juntas e
  a primeira tentativa depois de um incidente vira o segundo incidente. O aleatório entra
  como parâmetro para o teste medir a fórmula em vez de medir a sorte.

Comando: `node --test test/monitoringHealth.test.mjs` → **13/13**.

## Bloco 3 — o serviço, as rotas e o pipeline real ✅

`backend/src/monitoring/{collect,service}.ts`, `routes/monitoringRoutes.ts`, laço no
`automations/engine.ts`.

O pipeline inteiro **sem uma linha de motor novo**:

```
fonte → collectOnce (safeFetch) → mapping → schema → recorder → dataset → monitor → Flow → Activity
```

- **quem busca é `safeFetch`**, que resolve o host, recusa endereço privado e de metadados e
  **revalida cada redirect**. Um cliente HTTP próprio aqui seria um segundo lugar decidindo o
  que é seguro alcançar;
- **quem guarda é o recorder do histórico** (`source.kind: 'manual'`, que o motor já
  oferecia como porta para integração nova). Filtro, agregação e retenção não foram
  reescritos — e o registro gravado já acorda os monitores de dataset pelo caminho de ontem;
- **testar é a leitura real**, com a amostra **redigida**: um teste que valida só a
  configuração não prova nada, porque o que quebra é o outro lado;
- **ativar exige ter lido**: uma fonte nunca testada, ativada, nasce degradada minutos
  depois e o painel abre vermelho por configuração que ninguém conferiu;
- **a telemetria é gravada inclusive quando falha** — caminho de erro que sai sem escrever é
  fonte que quebra em silêncio e continua verde na tela;
- **excluir a fonte não leva o histórico**: apagar a regra de coleta é diferente de apagar o
  passado;
- rotas em `/api/monitoring` com `MONITORING_CENTER_ENABLED=0` negando de verdade (404), e
  auditoria em criar/editar/ativar/pausar/duplicar/excluir — testar e ler ficam de fora
  porque são leitura.

### Três defeitos reais que os testes acharam

1. **`nextReadAt` empurrava horário atrasado para o futuro.** A intenção era a tela não
   mostrar o passado; o efeito era a varredura **nunca** considerar vencida uma fonte
   atrasada — ela ficaria parada para sempre com o painel prometendo uma leitura que não
   vinha. Agora a função devolve a verdade e existe `isDue`; arredondar é problema de quem
   mostra. O teste anterior tinha travado o comportamento errado e foi corrigido.
2. **O cache de recorders do histórico.** Testar a fonte antes de ativar preenchia o cache
   com "nenhum recorder para esta chave", e a primeira coleta de verdade não gravava nada
   por até um cache inteiro. Quem cria o recorder agora desfaz a lembrança.
3. **A dedupe por conteúdo guardava o hash do que foi LIDO.** Com isso, testar antes de
   ativar fazia a primeira coleta real achar que "não mudou". O hash guardado passou a ser o
   do que foi **gravado**.

Comandos: `node --test test/monitoringSource.integration.test.mjs test/monitoringHealth.test.mjs`
→ **42/42**; `npm run test -w backend` → **1390 + 1900, 0 falhas**.

## Bloco 4 — as correções pedidas na revisão ✅

Sete itens da lista, todos com teste que falha sem a correção:

1. **`backoffDelay` nunca fica abaixo do backoff base.** Sem o piso, uma razão de jitter
   alta faz a terceira tentativa esperar menos que a primeira — o "aleatório" vira rajada
   justo quando o outro lado está pedindo calma;
2. **a lista de transformações é conferida, não só declarada.** `{ op: 'exec' }` era aceito
   e ignorado em silêncio: o mapeamento parecia ter transformado quando não transformou, e
   o erro apareceria como número estranho numa série semanas depois. Cada `op` tem os
   parâmetros dela validados (`join` sem separador, `replace` sem texto, `default` com
   objeto — todos recusados);
3. **o destino do mapping é mais apertado que a origem**: sem `$`, porque a chave de saída
   vira campo de um documento do Mongo e `$` é lido como operador. Na origem ele continua
   aceito, porque APIs usam `$id` e ler não é escrever. `__proto__`, `constructor` e
   `prototype` já eram recusados nos dois lados;
4. **a versão do mapping é inteiro positivo** — `1.5` e `-2` não ordenam nada;
5. **o número exige formato explícito quando é ambíguo.** `"1.234"` é mil em pt-BR e
   um-vírgula-dois em en-US; chutar acerta metade das vezes, e a metade errada vira alarme
   de madrugada sobre um valor mil vezes maior. Sem `locale`, o ambíguo devolve `null`; com
   `pt-BR`/`en-US`, os dois lados funcionam. O que não é ambíguo (`42`, `1.5`, `R$ 10,50`,
   `1.234.567`, `1.234,56`) passa sem declaração;
6. **tetos de bytes por valor, por linha e pela leitura inteira.** Um campo que devolve dez
   megabytes viraria dez megabytes por linha, quinhentas vezes, no event loop e depois no
   banco. Valor estourado é cortado e o corte é **dito**; linha estourada é descartada
   inteira, porque meia linha é pior — o buraco parece dado;
7. **segredo nunca fica na fonte.** Credencial na query, no usuário da URL ou no corpo é
   recusada na **criação**: gravada, ela já vazou para o documento que a tela lê inteiro. A
   fonte guarda só o NOME do cabeçalho; o valor sai da conexão cifrada na hora da leitura.

Comandos: `node --test test/monitoringMapping.test.mjs test/monitoringSource.integration.test.mjs test/monitoringHealth.test.mjs`
→ **81/81**; `npm run test -w backend` → **1401 + 1905, 0 falhas**.

## Bloco 5 — a Central na tela: cinco abas e o wizard ✅

`frontend/src/lib/monitoring.ts`, `pages/MonitoringCenter.tsx`, rota `/monitoring` e o item
de menu.

As abas **não são categorias**: são as perguntas que alguém faz, na ordem em que faz. "Está
tudo bem?" (visão geral), "de onde vem?" (fontes), "o que dispara?" (monitores), "o que
está chegando agora?" (ao vivo), "o que aconteceu?" (histórico).

- **a saúde é dita em português, com o motivo**: `api_polling / degraded / 3` não é uma
  frase, e às três da manhã ninguém monta uma de cabeça. A tela mostra "degradada · a
  última leitura boa tem 42 min · 3 falhas";
- **o wizard testa de verdade** e mostra a amostra **redigida** — credencial aparece como
  «oculto», e o teste é a mesma leitura que a fonte fará quando ativa;
- **a fonte nasce rascunho**, e a revisão do wizard diz isso antes de salvar: nada é
  consultado até alguém ativar;
- **a recusa do servidor aparece na tela** em vez de virar estado silencioso — inclusive a
  de ativar sem ter lido;
- **o menu passou a apontar para a Central**, mantendo `/monitors` como endereço próprio:
  quem tinha o bookmark não perde, e quem chega pelo menu chega pela pergunta certa;
- o "ao vivo" usa o socket que já existe — quando algo anda, a lista se refaz. Sem sondagem.

Comandos: `npx playwright test e2e/monitoring-center.spec.ts` → **8/8**, incluindo **320 px**
(Central e wizard) e acessibilidade (rótulo nos campos, erro em `role="alert"`).
Bateria: E2E **660** passaram · frontend **292** · lint **0 erros** · secret-scan limpo em
2206 arquivos · backend **1401 + 1905**.

## Bloco 6 — os tipos que empurram, por orquestração pura ✅

`fonteDoRecorder` em `backend/src/monitoring/service.ts`.

Os tipos que EMPURRAM já tinham porta no motor de histórico: `event` para o barramento e
`live_data` para uma conexão de WebSocket. Ligar a fonte diretamente nelas é o oposto de
inventar caminho — o dado chega pelo mesmo lugar de sempre, e a Central só diz que agora
tem alguém guardando.

- `internal_event` → recorder com `source: { kind: 'event', ref: <tipo do evento> }`;
- `websocket` → recorder com `source: { kind: 'live_data', ref: <instalação> }`;
- os que a Central puxa continuam em `manual`, a porta que o motor já oferecia;
- **fonte que empurra sem dizer de onde não ativa**: sem `eventType`/`installationId` ela
  ficaria ativa, verde e muda para sempre, esperando uma entrega que ninguém faz;
- **o isolamento entre contas é do guarda canônico**: apontar para conexão de outra conta é
  recusado pelo próprio `criarRecorder`. Uma segunda checagem aqui seria uma segunda
  opinião sobre a mesma coisa.

Teste de aceitação: evento no barramento → recorder da fonte → registro no dataset, sem uma
linha de código próprio da Central no caminho.

Comando: `node --test test/monitoringSource.integration.test.mjs` → **38/38**;
`npm run test -w backend` → **1401 + 1909, 0 falhas**.

## Bloco 7 — a fonte de webhook, sem criptografia nova ✅

`backend/src/monitoring/webhookSource.ts`, `routes/monitoringWebhookRoutes.ts`.

Assinar, conferir em tempo constante e derivar a chave de idempotência **já existia** nos
Flows, testado. O que muda aqui é o destino: a entrega vira FATO em vez de execução, e daí
em diante o caminho é o de qualquer outra fonte.

- **assinatura errada responde igual a fonte inexistente.** Dizer "existe, mas a assinatura
  está errada" entrega meia informação a quem está adivinhando endereços;
- **replay não vira segundo fato**: com `x-event-id`, a identidade é o evento; sem ele, o
  hash do corpo. Quem decide é o índice único — uma leitura antes seria opinião velha no
  instante em que chegasse;
- **entrega velha é recusada** por `x-timestamp` fora da janela de 5 min: sem isso, uma
  requisição capturada hoje continua válida para sempre, porque a assinatura não envelhece
  sozinha;
- **o segredo nunca volta.** Mostrado uma vez, na criação e na rotação; depois só existe
  cifrado. Um segredo que a tela reexibe vaza no primeiro print;
- **girar mantém a URL**: trocar o endereço junto obrigaria o outro lado a se reconfigurar
  por um motivo que é nosso;
- o corpo **cru** é o que se confere — reserializar o objeto já parseado mudaria um espaço e
  derrubaria a assinatura de um provedor honesto;
- a memória de entregas expira em 7 dias: um reenvio de três meses depois não é o replay que
  interessa impedir, e guardar para sempre é pagar por um índice que só cresce.

Comando: `node --test test/monitoringWebhook.integration.test.mjs` → **15/15**, sendo 6 de
ameaça. Bateria: **1401 + 1924**, secret-scan limpo em 2209 arquivos.

## Bloco 8 — RSS/Atom, App/action e dataset ✅

`backend/src/monitoring/feed.ts` e os dois coletores em `collect.ts`.

- **o parser de feed é fechado e sem dependência nova.** Um feed é XML, mas ler um não
  exige um parser de XML genérico: os dois formatos têm a mesma forma, e trazer uma
  biblioteca completa significaria carregar DTD e entidade externa junto — que é exatamente
  onde mora o XXE. Há teste afirmando que `<!ENTITY xxe SYSTEM "file:///etc/passwd">` fica
  como texto, e outro afirmando que `&amp;lt;` não vira `<` (desfazer `&amp;` antes
  reconstruiria a etiqueta);
- **RSS deixou de cair no caminho de página**: antes, quem configurava um feed recebia um
  pedido de seletor CSS para um formato que já é estruturado;
- **`app_action` passa pelo executor oficial de Apps** — grant, instalação, compatibilidade
  e credencial cifrada. `autonomousWriteActionKeys` vai vazio: consulta é leitura, e este
  caminho não autoriza escrita nem por engano;
- **`dataset` lê pelo adapter de sempre**, cobrindo o caso que o monitor de gravação não
  cobre: olhar periodicamente o estado atual.

Comandos: `node --test test/monitoringFeed.test.mjs` → **9/9** (2 de ameaça);
`node --test test/monitoringSource.integration.test.mjs` → **44/44**;
`npm run test -w backend` → **1410 + 1930, 0 falhas**.

**Seis dos nove tipos funcionam**: api_polling, http_page, rss, webhook, internal_event,
websocket, app_action e dataset — oito, na verdade. Falta **browser** (com visão) e **SSE**
como protocolo explícito.

## Bloco 9 — a simulação de monitor ✅

`simulateMonitor` em `backend/src/monitors/condition.ts`, rota `POST /api/monitors/simulate`.

Ela existe porque **"RSI cruzou 30 para cima" é uma frase que parece óbvia e engana**: quem
escreve não distingue ESTADO de BORDA até ver os dois lado a lado. A simulação mostra a
diferença com um valor de antes e um de agora, antes de a regra ir para o ar — e devolve a
explicação em português de por que dispara ou não.

- **é pura e mora no módulo da condição**, não no serviço que abre o banco: um teste que
  precisasse de Mongo para conferir uma regra estaria medindo outra coisa;
- **não lê o estado de plantão** de propósito — simular com a memória faria o resultado
  depender do que o monitor viu ontem, e quem simula quer entender a REGRA;
- **ela prevê o motor, não discorda dele.** O primeiro teste que escrevi afirmava que
  `enter` não dispara sem valor anterior; o motor real trata a primeira observação como
  "era falsa" e dispara. Quem estava errado era o teste. Cruzamento, esse sim, precisa de
  dois números — e a explicação diz isso;
- AST com AND/OR aninhado é simulada inteira, e campo ausente continua não virando zero.

Comando: `node --test test/monitorSimulation.test.mjs` → **10/10**.
Bateria: **1420 + 1930, 0 falhas**.

## Bloco 10 — a aba de Monitores: AST, prévia e simulação ✅

`AbaMonitores` em `frontend/src/pages/MonitoringCenter.tsx` + o cliente em `lib/monitors.ts`.

- **o construtor é de listas fechadas**, não de texto livre: o que dispara ação sozinho
  precisa ser conferível. Escolhida a fonte, os campos oferecidos são os que ela **mapeou**;
- **AND/OR compondo**: "adicionar condição" empilha, e um botão troca entre exigir todas ou
  qualquer uma. A prévia mostra a frase composta;
- **a prévia é montada na tela**, para o rascunho: o backend também descreve, e é ele quem
  manda quando a regra já existe — mas sem esta versão quem monta só descobriria o que
  escreveu depois de salvar;
- **a simulação lado a lado** — o valor de antes e o de agora. É a diferença entre estado e
  borda, e há um caso E2E que troca só o "antes" e vê o veredito mudar de "Dispararia" para
  "estado, não borda".

**Armadilha reencontrada**: no Playwright a ÚLTIMA rota registrada vence, e o stub genérico
`**/api/**` engolia a rota específica de simulação. Já tinha acontecido neste repositório;
o comentário no teste agora diz por quê.

Comandos: `npx playwright test e2e/monitoring-center.spec.ts` → **12/12** (com 320 px no
construtor). Bateria: E2E **664** · frontend **292** · lint **0 erros**.

## Bloco 11 — o Ao vivo mostra o que CHEGOU ✅

`liveView` em `backend/src/monitoring/service.ts`, rota `GET /api/monitoring/live`, e a aba
refeita.

A primeira versão listava as fontes ativas com bolinha verde e chamava isso de "ao vivo".
Mas quem abre essa aba quer ver o **valor que acabou de entrar** — um nome não responde "o
que está acontecendo agora".

- as últimas leituras vêm do histórico da própria fonte, pelo recorder dela;
- **o valor sai redigido** pela mesma peneira da amostra do wizard: esta tela costuma ficar
  aberta na parede do escritório, e o que veio dentro do payload não pode aparecer nela;
- métricas por fonte: última leitura, latência, leituras boas, falhas, **reconexões** e
  **disparos**;
- os disparos são contados das execuções que o monitor pediu, e não de um contador próprio
  — um contador aqui divergiria do painel de execuções na primeira falha de escrita, e a
  mesma pergunta passaria a ter duas respostas.

Comandos: `node --test test/monitoringSource.integration.test.mjs` → **48/48**;
`npx playwright test e2e/monitoring-center.spec.ts` → **15/15**.
Bateria: backend **1420 + 1934** · E2E **667** · frontend **292** · lint **0 erros**.

**Nota de ambiente**: uma rodada de E2E falhou inteira com "Cannot navigate to invalid URL"
— o `vite preview` estava servindo um build antigo. Não era código; matar o preview e
reconstruir resolveu. Fica registrado porque a leitura errada aqui seria "a Central quebrou".

## Bloco 12 — grants por agente/setor sobre fonte ✅

`backend/src/monitoring/access.ts` + rotas de grant e `GET /sources/:id/access`.

A precedência **não é nova, de propósito**: `deny` vence qualquer `allow`, e entre
permissões a mais específica ganha (agente > setor > andar > prédio). Inventar uma
precedência própria faria a mesma pergunta ter duas respostas dependendo do recurso — e a
errada seria descoberta em produção.

- **o agente é resolvido contra a conta antes de qualquer coisa**: perguntar "o agente X
  pode?" com um id de outra conta já seria vazamento, mesmo sem ler nada;
- **a hierarquia é resolvida, não guardada no grant** — quem lê é o `resolveAgentSubject`
  canônico, e a associação de setor mora no setor;
- **revogação vale na hora**: entre conceder e usar cabe uma revogação, e a conferência é
  imediatamente antes do uso;
- fonte pausada não é alcançada por agente nem com grant;
- `GET /sources/:id/access` existe para a matriz do agente mostrar **a mesma resposta** que
  a execução vai dar — duas respostas para a mesma pergunta é como se descobre, tarde, que
  a tela mentia.

**Meu fixture estava errado, não o código**: pus a associação de setor no agente, e o
resolvedor canônico lê dos membros do setor. Quatro casos falharam até eu corrigir o teste.

Comando: `node --test test/monitoringGrants.integration.test.mjs` → **15/15** (3 de ameaça:
agente de outra conta, fonte de outra conta e revogação).
Bateria: **1420 + 1949**, secret-scan limpo em 2215 arquivos.

## Bloco 13 — o wizard autentica pelo cofre e pode criar o monitor ✅

- **passo de conexão**: o wizard pergunta "qual conexão", e não "qual chave". A fonte guarda
  só o NOME do cabeçalho; o valor sai do cofre cifrado na hora da leitura. Um caso E2E
  afirma que **nenhum valor de credencial atravessa o corpo do pedido**;
- **monitor opcional na revisão**, e ele nasce rascunho como tudo aqui: uma regra que passa
  a agir sozinha no fim de um wizard é uma regra que ninguém revisou. A tela diz isso com
  essas palavras.

Comandos: `npx playwright test e2e/monitoring-center.spec.ts` → **17/17**.
Bateria: E2E **669** · frontend **292** · lint **0 erros**.

**Nota de ambiente (de novo)**: o `vite preview` servindo build antigo derruba a suíte
inteira com "Cannot navigate to invalid URL". Matar o preview antes de reconstruir resolve.

## Bloco 14 — o portão de visão/OCR ✅

`backend/src/monitoring/vision.ts`.

Ler um número de uma imagem é **palpite com boa aparência**: `1.234` vira `1234`, `l` vira
`1`, um gráfico com sombra vira qualquer coisa. Um palpite desses acionando um Flow que
manda dinheiro é o pior tipo de defeito — raro, silencioso, e quando aparece já aconteceu.

Por isso a visão aqui **não devolve um valor**: devolve valor + **confiança** + **evidência**,
e um portão decide se aquilo pode virar dado.

- **sem evidência não passa** (texto cru e provedor): não há o que conferir depois;
- **piso de confiança de 95% para dado crítico**, 70% para o resto. Um reconhecedor 80%
  seguro erra um em cinco, e um em cinco é muito quando cada erro é uma ação no mundo;
- **dado crítico exige confirmação**: duas leituras independentes que concordam. Uma leitura
  muito confiante e errada é indistinguível de uma muito confiante e certa;
- ausente continua não virando zero;
- **o provedor padrão recusa** — enquanto não houver um, uma fonte que dependeria de visão
  não lê nada em vez de ler um palpite.

**Defeito real que o teste pegou**: a recusa por falta de confirmação ainda devolvia o
valor calculado. Ele acabaria gravado por quem não olhasse `accepted`. Toda recusa devolve
`null` agora.

Comando: `node --test test/monitoringVision.test.mjs` → **14/14**.

## Bloco 15 — o browser em worker isolado ✅

`browser-worker/` — serviço próprio, deployável, com Dockerfile e README.

Buscar uma página é seguir um endereço que **outra pessoa escolheu**. Fazer isso de dentro
da API significa pedir requisições a partir da rede interna — e é assim que a metadata da
nuvem sai pela porta da frente.

- **cada salto de redirect é revalidado**: validar só a URL digitada e seguir redirects
  alegremente é o erro clássico;
- **cada subrequisição é conferida como se fosse a primeira**, e uma bloqueada **não
  derruba a página**: derrubar tudo faria um `<img>` para rede interna esconder o conteúdo
  legítimo e a informação de que alguém tentou;
- **DNS rebinding fechado**: o guarda devolve o ENDEREÇO conferido e a conexão usa ele, sem
  perguntar ao DNS de novo. Se **qualquer** endereço resolvido for privado, o alvo inteiro é
  recusado — escolher "o primeiro que serve" seria cair no ataque;
- `::ffff:169.254.169.254` é reconhecido como metadata;
- download, tipo binário e `Content-Disposition: attachment` são recusados;
- orçamento de bytes conferido **antes** de pedir — deixar a requisição sair e falhar por
  tamanho reportava a causa errada e gastava uma ida à rede condenada;
- **kill switch** por variável, sem derrubar o processo;
- o `health` **diz o que ele não faz**: `render: false`. Sem motor de renderização, uma
  fonte que dependa de JavaScript sabe que não foi atendida, em vez de receber HTML cru
  como se fosse página renderizada.

Comando: `npm run test:browser-worker` → **19/19**, sendo 8 de ameaça.
Bateria: backend **1434 + 1949** · secret-scan limpo em 2217 arquivos.

## Bloco 16 — o tipo `browser` ligado ao worker ✅

`backend/src/monitoring/browserProvider.ts` + o coletor em `collect.ts`.

**Os nove tipos de fonte agora existem.** O `browser` busca pelo worker isolado, e a cadeia
de estratégias é a mesma das outras páginas: JSON → JSON-LD → seletor DOM.

- **sem worker configurado, o tipo recusa** — a mesma regra do runner de código: o que não
  foi configurado não existe;
- a URL do worker vem da **configuração do servidor**, nunca de um pedido: deixar o cliente
  escolher seria entregar a ele um proxy para a rede interna, que é o que o worker existe
  para impedir;
- **a resposta do worker é conferida** antes de virar resultado: tratar o que vem do outro
  lado da fronteira como já válido é deixar o worker escolher no que o backend acredita;
- **sem dado estruturado e sem seletor, a recusa diz que falta RENDERIZAÇÃO** — é diferente
  de "não achei": quem lê precisa saber que falta um motor, e não um seletor;
- worker fora do ar e segredo errado são **indisponibilidade**, não falha da página.

O teste sobe o worker **de verdade**, em processo separado, e a Central coleta através
dele — incluindo os dois casos de ameaça: metadata bloqueada, e redirect para metadata
bloqueado no segundo salto.

Comando: `node --test test/monitoringBrowser.integration.test.mjs` → **10/10**.
Bateria: backend **1434 + 1959** · runner **21** · browser-worker **19**.

## Bloco 17 — unions discriminadas, SSE explícito e migração com rollback ✅

`backend/src/monitoring/config.ts` e `migration.ts`.

### A configuração deixou de ser um saco de opcionais

O modelo antigo tinha `url?`, `appKey?`, `datasetKey?`, `eventType?` e mais dez, todos no
mesmo objeto: uma fonte de webhook aceitava `url`, uma de dataset aceitava `selector`, e
nada reclamava. O campo errado ficava guardado, aparecia na tela e confundia quem fosse
editar depois.

Agora cada tipo diz o que tem, e **o que não pertence é recusado, não ignorado** — porque
campo ignorado é campo que alguém preencheu achando que ia funcionar.

**Efeito colateral bom**: quatro testes passaram a falhar porque a recusa mudou de lugar —
antes uma fonte sem `eventType` nascia e só era barrada na ativação; agora ela nem chega a
existir. A recusa vem onde a pessoa ainda está olhando.

### SSE é DITO, não adivinhado

`protocol: 'websocket' | 'sse'`. Adivinhar por `wss://` versus `https://` erraria num SSE
servido por uma API que também fala WebSocket — e o erro só apareceria em produção. SSE
exige o endereço do fluxo; WebSocket exige a conexão do App. Heartbeat com piso e teto:
silêncio além dele é conexão morta, mesmo sem erro.

E a paginação virou fechada (cursor, página ou nenhuma), com teto de páginas: paginação sem
limite é um laço.

### A migração é projeção, não mudança

O que já monitora continua monitorando. A fonte criada **aponta** para o recorder que já
existia, nasce **pausada**, e o recorder não é tocado — nem o `updatedAt` dele. Recorder
`manual` de fora da Central é pulado em vez de descrito errado.

O rollback apaga **só as projeções intocadas**: uma que alguém ativou ou que já leu deixou
de ser projeção, e fica.

Comandos: `node --test test/monitoringConfig.test.mjs` → **11/11**;
`node --test test/monitoringMigration.integration.test.mjs` → **12/12**.
Bateria: backend **1445 + 1971**.

## Bloco 18 — a AST completa na tela ✅

`AbaMonitores` em `frontend/src/pages/MonitoringCenter.tsx`.

- **MUDANÇA** (`delta`) ao lado de comparação: "variou mais que X" compara com o valor
  anterior, e não com um limite fixo. Misturar as duas na mesma folha faria a prévia mentir;
- **CRUZAMENTO** pede campo e limiar, e os campos só aparecem quando o modo é de travessia
  — cruzar precisa de dois números, e sem eles não haveria o que cruzar;
- **debounce e cooldown** com a distinção dita na dica: um protege de fonte tagarela, o
  outro de avisar demais;
- **política de dado velho/ausente**: não disparar e marcar a fonte, ou não disparar em
  silêncio. Decidir sobre um número que já não é verdade é o alarme que toca sozinho de
  madrugada;
- tudo isso entra na **prévia em português**, montada na tela antes de salvar.

E os E2E que faltavam: **dedupe** (coletar o mesmo valor não é falha), **revogação** (a
recusa do servidor aparece como recusa) e **falha parcial** (uma fonte quebrada não esconde
as que funcionam, nem o contrário).

Comando: `npx playwright test e2e/monitoring-center.spec.ts` → **24/24**.

## Bateria completa desta sessão

Repositório em `f77b3e8` + este bloco:

| Comando | Resultado |
| --- | --- |
| `npm run build` | verde |
| `npm run test -w backend` | **1445 + 1971**, 0 falhas |
| `npm run test:runner` | **21**, 0 falhas |
| `npm run test:browser-worker` | **19**, 0 falhas |
| `npm run test -w frontend` | **292**, 0 falhas |
| `npm run lint -w frontend` | **0 erros** |
| `npm run test:e2e -w frontend` | **676** passaram, 17 pulados |
| `npm run smoke` | verde, saída 0 |
| `npm run secret-scan` | 2232 arquivos, nada encontrado |

## Bloco 19 — a renderização de verdade ✅

`browser-worker/src/render.mjs` + a escalada em `collect.ts`.

O motor existe: Chromium via Playwright, que já estava no repositório para o E2E.

- **toda requisição que a página faz é interceptada e conferida pelo mesmo guarda** — a
  navegação, os redirects, os scripts, as imagens e cada `fetch` que o JavaScript inventar
  em tempo de execução. O descuido clássico é validar a URL digitada e deixar o navegador
  buscar o resto: aí é a **página** que decide para onde o worker faz requisição;
- há teste com uma página que chama `fetch('http://169.254.169.254/…')` no próprio
  JavaScript: a tentativa é **abortada e reportada**, e o conteúdo legítimo continua sendo
  lido. Derrubar tudo esconderia as duas coisas;
- o sandbox do Chromium fica **ligado**: `--no-sandbox` é o que transforma uma página
  hostil em código rodando com o usuário do worker;
- downloads recusados, sem sessão nem credencial, e o navegador **sempre** fecha no
  `finally` — um Chromium esquecido por execução consome a máquina em minutos;
- `health` **mede** a capacidade: `render` só é `true` se o motor carregar.

### O degrau caro só é pago quando o barato não resolve

A primeira versão da escalada perguntava "o seletor achou alguma coisa?" — e achava: uma
página que mostra "carregando" até o JavaScript rodar tem o elemento lá, com o texto errado.
O degrau barato dizia sucesso e a fonte lia `null` para sempre.

A pergunta certa é **"o que saiu daqui serve?"**, e ela só pode ser feita depois de mapear.
Há um teste que mede o tempo: ler um JSON não sobe navegador.

Comandos: `npm run test:browser-worker` → **25/25**;
`node --test test/monitoringBrowser.integration.test.mjs` → **12/12**, com a aceitação de
uma página cujo valor **só existe depois do JavaScript**.
Bateria: backend **1445 + 1973** · runner **21** · browser-worker **25**.

## Bloco 20 — screenshot e visão, o último degrau ✅

`browser-worker/src/render.mjs` (retrato), `backend/src/monitoring/visionProvider.ts` e a
escalada final em `collect.ts`.

A cadeia de sites está **completa**: JSON → JSON-LD → seletor DOM → **browser renderizado**
→ **screenshot/OCR/visão**.

- **o retrato só é tirado quando a visão é o próximo degrau**, e é **cortado no seletor**
  quando existe um: mandar a página inteira para um modelo de visão é dar a ele mais chance
  de ler o número errado, além de custar mais;
- **o provedor produz leituras; ele nunca decide se elas valem.** Quem decide é o portão,
  que não conhece provedor nenhum — juntar os dois faria o modelo arbitrar sobre a própria
  qualidade, e um modelo perguntado sobre a própria certeza responde bem demais;
- o pedido ao modelo é **estreito de propósito**: um campo por vez, o valor como aparece,
  o texto cru que embasou, e a instrução explícita de **não adivinhar** — um valor inventado
  com confiança alta é pior do que dizer que não conseguiu ler;
- **confiança fora do intervalo vira zero**: um modelo que devolvesse `confidence: "alta"`
  passaria no portão sem isso;
- **campo obrigatório é tratado como crítico** — exige 95% e confirmação;
- **a amostra é o texto lido, nunca a imagem**: uma imagem ali viraria um print do site
  inteiro na tela de quem configurou;
- **`VISION_ENABLED=1` é exigido além da chave**: ter uma chave de modelo não é o mesmo que
  querer que páginas sejam lidas por adivinhação;
- e há teste afirmando que **a visão não é chamada quando um degrau anterior resolveu** —
  pagar adivinhação com o dado ali seria o pior dos dois mundos.

Comandos: `npm run test:browser-worker` → **28/28**;
`node --test test/monitoringBrowser.integration.test.mjs` → **19/19**.
Bateria: backend **1445 + 1980** · runner **21** · browser-worker **28** · secret-scan limpo
em 2233 arquivos. `DEPLOYMENT_ENVIRONMENT_MATRIX.md` documenta as variáveis e as coleções
novas.

## Bloco 21 — o script de extração, na sandbox ✅

`extractScript` em `config.ts` e `aplicarScript` em `collect.ts`.

O DSL fechado continua sendo o caminho normal. O script existe para a transformação que ele
não faz — somar uma lista, cruzar dois campos — e o **custo de passar pela sandbox é
exatamente o custo que essa escolha deve ter**.

- **roda só na sandbox**, no runner isolado que já existe: modelo de permissão do Node
  negando disco, subprocesso, worker e addon nativo, sem rede, com teto de tempo e memória.
  Executar aqui, mesmo "só uma transformaçãozinha", seria rodar código de terceiro no
  processo que tem o banco e as chaves;
- **sobre dado já sanitizado**: JSON analisado, JSON-LD ou o texto de um seletor. HTML cru
  nunca chega — um script recebendo a página inteira teria dentro dela o script do site, e o
  ponto de rodar isolado é que o código de terceiro não escolhe o que roda;
- **versionado**, com a versão sendo inteiro positivo, e limitado a 8 000 caracteres: um
  script maior não é uma transformação, é um programa, e programa tem outro lugar;
- **fail-closed**: sem sandbox saudável a fonte **falha**, e não segue sem o script —
  seguir aplicaria o mapeamento a um dado ainda não transformado e produziria valores
  errados com cara de certos;
- **nada além do dado atravessa**: nenhuma credencial, nenhum id de conta, nenhuma URL;
- a **amostra continua sendo o bruto**, porque é ele que explica o que o script fez.

O teste sobe o runner **de verdade**, em processo separado, e prova que o script não alcança
disco, subprocesso nem rede — e que um laço infinito é cortado.

Comando: `node --test test/monitoringScript.integration.test.mjs` → **11/11**.

## Bateria da sessão anterior

| Comando | Resultado |
| --- | --- |
| `npm run build` | verde |
| `npm run test -w backend` | **1445 + 1991**, 0 falhas |
| `npm run test:runner` | **21**, 0 falhas |
| `npm run test:browser-worker` | **28**, 0 falhas |
| `npm run test -w frontend` | **292**, 0 falhas |
| `npm run lint -w frontend` | **0 erros** |
| `npm run test:e2e -w frontend` | **676** passaram, 17 pulados |
| `npm run smoke` | verde, saída 0 |
| `npm run secret-scan` | 2234 arquivos, nada encontrado |


---

# Sessão de fechamento — os 16 bloqueios do fluxo real

Os blocos acima descrevem peças que existiam e passavam nos próprios testes. Esta sessão
tratou do que separa "a peça existe" de "o fluxo funciona": onde uma garantia estava
escrita e não era lida, onde a tela prometia o que a API não fazia, e onde um teste
verde media um sistema diferente do que roda em produção.

Cada bloco abaixo tem o mesmo formato: **o que estava errado**, **o que passou a valer** e
**a prova**. Onde a prova é um teste, a linha de produção foi revertida e o teste caiu —
uma garantia sem essa conferência é uma garantia que não se sabe se existe.

## Bloco 22 — testar destrava ativar, sem virar leitura ✅

**Estava errado**: o portão de ativação só aceitava `telemetry.lastOkAt`, que apenas a
coleta real escreve. Quem testava com sucesso era empurrado a "coletar agora" só para
destravar o botão — gravando histórico que não pediu.

**Passou a valer**: o teste de uma fonte gravada deixa telemetria própria
(`lastTestAt`, `lastTestOkAt`, `lastTestError`), e o portão aceita qualquer uma das duas
provas. O teste **não** toca `readsOk`, `lastReadAt` nem `lastContentHash`: o hash de um
teste envenenaria a dedupe, e a primeira coleta de verdade acharia que "não mudou".
"Coletar agora" passou a existir na UI, com aviso que distingue linhas gravadas de "nada
mudou".

**Prova**: `monitoringSource.integration.test.mjs` — a fonte testada e nunca coletada
ativa; testar não escreve em `data_history_records`; teste que falha registra o erro e
continua barrando a ativação. Revertendo o portão, 2 casos caem.

## Bloco 23 — cadência validada, com cron que dispara ✅

**Estava errado**: `cadence.mode: 'cron'` era aceito sem conferência e a varredura só
procurava `mode: 'interval'`. A fonte ficava ativa, verde e **muda para sempre**, e o único
jeito de descobrir era ir procurar o dado que nunca chegou.

**Passou a valer**: união discriminada validada — intervalo com faixa, cron conferido
contra o **mesmo relógio das rotinas** (`automations/scheduleClock`, no fuso de quem
configurou) e `stream` para quem empurra. `nextReadAt` conta o cron a partir da última
leitura, e não de agora: perguntar "qual o próximo depois deste instante" responderia
sempre amanhã, e a fonte atrasada nunca venceria.

**Prova**: `monitoringHealth.test.mjs` (4 casos de cron, incluindo o disparo perdido e a
expressão que o relógio não entende) e `monitoringSource.integration.test.mjs` (cron
inválido recusado; fonte de horário entrando na varredura). Revertendo o filtro de
`dueSources`, o caso da varredura cai.

## Bloco 24 — o wizard discriminado por tipo, e o monitor que existe ✅

**Estava errado**: o wizard mandava `url + GET + intervalo` para os nove tipos. Dava para
escolher "Webhook" no primeiro passo e descobrir no último que aquele caminho **nunca**
funcionou — o servidor recusa a criação inteira por um campo que o formulário mandou
sozinho. O mapeamento vinha depois do teste, então o teste despejava a resposta e deixava
quem lê procurando. E "criar também um monitor" só ligava um booleano local: a mensagem
dizia que o monitor foi criado, e quem fosse procurá-lo não encontrava nada.

**Passou a valer**:

- cada tipo diz o que pede, e os passos que não pertencem a ele **somem**;
- o payload sai na forma da união discriminada do backend, sem campo estranho;
- **mapeamento antes do teste**, e o teste responde "achei o preço" e "não achei o
  estoque", com status e o que fazer a seguir;
- a criação do monitor é uma chamada de verdade a `POST /sources/:id/monitor`, que
  materializa o destino da fonte antes (um monitor de dataset sem dataset é recusado) e
  cria no motor canônico, sempre rascunho. Sem o mínimo, salvar fica indisponível; se a
  criação falha, a recusa aparece e **nenhuma mensagem promete um monitor**;
- avançado expõe paginação, parâmetros, seletor, estratégia de leitura, script de extração
  e o aviso da visão. Ritmo aceita intervalo ou horário em cron com fuso.

**Prova**: `e2e/monitoring-center.spec.ts` — webhook não manda `url` nem `intervalMs`; cron
manda cron e fuso; o teste diz o que não achou; o monitor vira POST com a condição certa; a
falha do monitor aparece como recusa.

## Bloco 25 — aluguel atômico por fonte, e backoff que adia ✅

**Estava errado**: a API e o worker podiam coletar a mesma fonte no mesmo segundo — duas
linhas do mesmo instante, telemetria sobrescrita, e um `lastContentHash` que era o da
leitura que terminou por último, não o da última. E o `nextAttemptMs` era calculado e
devolvido na resposta, onde ninguém lia: a fonte quebrada continuava sendo chamada no
intervalo cheio, martelando um serviço que já tinha respondido 500. `rateLimitPerMinute`
estava no modelo e ninguém lia.

**Passou a valer**: `claimDueSources` toma a fonte por `findOneAndUpdate` condicional; quem
primeiro trocar o documento leva. O aluguel **vence** em vez de ser devolvido — um processo
que morre no meio não trava a fonte para sempre. `nextAttemptAt` é gravado, entra no filtro
da varredura, e uma leitura boa o apaga. O limite de taxa é cumprido por quem o prometeu.

**Prova**: `monitoringSource.integration.test.mjs` — duas varreduras concorrentes levam uma
só; o aluguel vence sozinho; falhar adia e a varredura respeita; ler bem apaga o
adiamento; o limite de taxa espaça as leituras. Neutralizando a condição do aluguel, o caso
de concorrência cai.

## Bloco 26 — paginação por cursor e por página ✅

**Estava errado**: `pagination` estava no modelo e no validador e **nunca era usada na
coleta**. Uma API paginada entregava a primeira página e a série ficava pela metade, sem
erro nenhum — o número existia, estava certo, e era de vinte por cento dos dados.

**Passou a valer**: o laço respeita `maxPages`, bytes, linhas e relógio de parede. Página
vazia é o fim mesmo com cursor, e o mesmo cursor de novo é a API dizendo que não sabe
avançar — uma API que devolve cursor não-nulo por engano viraria laço infinito contra o
servidor de outra pessoa. Uma página seguinte que falha não derruba o que já veio. A razão
da parada volta no resultado: "buscou 3 de no máximo 3" é notícia diferente de "buscou 3 e
acabou". O cursor de **retomada** é uma escolha, não um palpite: num feed que só cresce,
recomeçar relê o passado; numa listagem do estado atual, retomar pula o começo.

**Prova**: 5 casos em `monitoringSource.integration.test.mjs`, contra servidores locais que
paginam de verdade. Neutralizando o laço, 4 caem.

## Bloco 27 — o destino AO VIVO existe ✅

**Estava errado**: `realtimeSourceId` nascia `null`, era preservado em toda atualização e
nunca recebia nada. Uma fonte com `live: true, history: false` não tinha recorder — e o Ao
vivo, que lia do histórico, mostrava **zero leituras para sempre**.

**Passou a valer**: ativar uma fonte ao vivo materializa o par em `realtime_sources`, a
coleta escreve o valor de agora no `live_data` com o TTL da janela de validade da fonte, e
o Ao vivo lê do destino que a fonte realmente tem. Para isso, `monitoring` virou um
`sourceKind` de fonte em tempo real ao lado de `live_data`: os dois são origem que empurra
valores por chave, e o valor mora na mesma coleção — o mesmo valor serve ao Ao vivo, ao
agente e à tool de tempo real por um caminho só. A fonte em tempo real nasce **sem agente
nenhum**: acesso é concessão, não padrão.

**Prova**: 4 casos em `monitoringSource.integration.test.mjs`. Neutralizando a
materialização, 3 caem; neutralizando a escrita no `live_data`, 3 caem.

## Bloco 28 — o cliente SSE, e o que separa "implementei" de "funciona" ✅

**Estava errado**: SSE era um protocolo declarado na configuração e mais nada. Nenhum
cliente, nenhuma conexão, nenhuma entrega. E ativar uma fonte SSE era impossível: o portão
exigia `installationId`, que é o "onde" do WebSocket, não o do SSE.

**Passou a valer** (`backend/src/monitoring/sse.ts`):

- conexão no **endereço conferido**, reconferido a cada volta;
- o formato inteiro: `data` em várias linhas, `id`, `event`, `retry`, comentário, as três
  quebras de linha do protocolo, evento partido entre pacotes;
- **silêncio é morte** — um socket pendurado não dá erro, ele só para de entregar. O
  relógio começa no envio do pedido, e não na resposta: escrevendo o teste apareceu que um
  servidor que aceita a conexão e nunca manda cabeçalho deixava o cliente pendurado para
  sempre;
- volta com o backoff da fonte e jitter, usando o `retry:` do servidor como **piso** — um
  servidor pedindo "volte em 1s" enquanto cai receberia uma tempestade justo quando menos
  aguenta;
- `Last-Event-ID` reenviado, e a **memória de entrega** (a mesma do webhook) impedindo que
  reconectar duplique a série: a identidade do fato no motor de histórico inclui o
  instante, e o instante da segunda chegada é outro;
- parar é parar: o `stop()` aborta o socket, limpa os relógios e não reconecta;
- um supervisor reconcilia as fontes ativas, então ativar na tela sobe a assinatura sem
  reiniciar nada, e pausar realmente para de consumir a rede do outro lado.

**Prova**: `monitoringSse.integration.test.mjs`, **18/18**. Sem o relógio de silêncio, 10
caem; sem a memória de entrega, o caso de dedupe cai.

## Bloco 29 — o histórico operacional ✅

**Estava errado**: a aba mostrava contadores acumulados — "12 leituras boas, 3 falhas".
Isso não responde nenhuma das perguntas de quem abre isto às três da manhã: quando parou,
quanto demorou, quantas linhas vieram, qual foi o erro, e se aquele Flow disparou por causa
desta fonte.

**Passou a valer** (`backend/src/monitoring/history.ts`): cada coleta, entrega e disparo
vira uma linha com instante, fonte, status, duração, quantidade lida e gravada, páginas e
erro **redigido**. Filtro por fonte, tipo e resultado; página pelo `_id` — paginar por
instante repetiria o empate de dois eventos do mesmo milissegundo. Prazo de 30 dias por
TTL do Mongo. **Conteúdo não entra**: um log de operação que guarda payload é o lugar mais
fácil de vazar o que a plataforma inteira protege, e ele fica aberto numa tela, num
chamado, num print.

O fio entre a fonte, o monitor e o Flow passou a existir: o motor de monitores avisa o que
**já** disparou (`onMonitorDispatched`) e a ponte anota. Um segundo observador dobraria as
execuções — que é justamente o defeito que este log existe para ajudar a investigar.

**Prova**: `monitoringHistory.integration.test.mjs`, **10/10**, incluindo o caso de ponta a
ponta (fonte → coleta → registro → monitor → Flow) que confere o `runId` gravado.

## Bloco 30 — DNS rebinding fechado na renderização ✅

**Estava errado** — e este era o pior. O guarda devolvia o endereço conferido e a busca
simples o usava, mas a **renderização** chamava `rota.continue()`: o Chromium ia à rede
sozinho e resolvia o nome **de novo**. Um nome que responde um endereço público na
conferência e um privado meio segundo depois passava inteiro, porque quem conectou nunca
viu o endereço aprovado.

**Passou a valer**: nenhuma requisição do navegador chega à rede. Cada uma é buscada pelo
mesmo caminho da busca simples, que abre socket no endereço conferido, revalida cada
redirect e manda o `Host` original; a resposta volta pronta ao navegador. Segunda tranca:
`--host-resolver-rules=MAP * ~NOTFOUND` e service workers bloqueados — o que escapar da
interceptação não resolve nada. `POST` partindo de dentro da página é abortado: coleta é
leitura.

No caminho apareceu um **bug de concorrência**: com a busca `await`ada, trinta requisições
de uma página passavam todas pela mesma conferência de teto antes de qualquer uma
terminar. A vaga passou a ser reservada antes da busca.

**Prova**: `browser-worker/test/worker.test.mjs` — a página é buscada num nome que o DNS
real não resolve (se carregar, ninguém perguntou ao DNS); o nome que muda de endereço entre
a conferência e a subrequisição tem a subrequisição recusada; `POST` de dentro da página é
abortado. Devolvendo o `continue()`, os dois casos de rebinding caem.

## Bloco 31 — o worker implantável de verdade ✅

**Estava errado**: sem Dockerfile, sem dependência declarada, sem healthcheck, sem limites,
e o `playwright` só existia por acaso na raiz do monorepo.

**Passou a valer**: `browser-worker/Dockerfile` sobre a imagem oficial do Playwright (que
já traz Chromium e as bibliotecas de sistema — instalar à mão dá uma lista que envelhece a
cada versão do navegador), usuário `pwuser` sem privilégio, healthcheck por TCP,
`playwright` declarado em `dependencies`, e `BROWSER_REQUEST_TIMEOUT_MS` como teto do
pedido inteiro — os limites de etapa somados ainda deixavam uma página patológica segurar
a vaga. Limites de CPU, memória, PIDs e rede documentados **com o porquê de cada número**.

**Prova**: `worker.test.mjs` — o teto corta uma página que nunca responde e a vaga volta.

## Bloco 32 — o webhook: identidade por linha, instante e reenvio ✅

**Estava errado**, três coisas no mesmo caminho:

1. `factId` era um por **entrega**. Uma entrega de cinco pedidos gravava um: o motor de
   histórico via a segunda linha como repetição da primeira e a descartava, e as outras
   quatro sumiam **sem erro nenhum**;
2. entrega sem `x-timestamp` pulava a conferência inteira — bastava não mandar o cabeçalho
   para o replay voltar a valer para sempre;
3. o registro de idempotência sobrevivia a uma recusa corrigível: o mesmo `x-event-id`,
   corrigido, virava "duplicado" para sempre, e quem reenviava o evento certo ouvia
   silêncio.

**Passou a valer**: identidade por linha (chave da entidade quando existe — estável entre
reenvios — ou índice); política de instante explícita, `required` por padrão para quem
nasce hoje e `optional` para o provedor que não manda instante, com documento antigo sem o
campo continuando como antes; e a lembrança desfeita quando nada foi gravado, com a entrega
**boa** continuando a bloquear o replay dela mesma.

**Prova**: `monitoringWebhook.integration.test.mjs`, **23/23**. Revertendo os três, 4 casos
caem.

## Bloco 33 — a aba Monitores, os acessos e a edição ✅

**Estava errado**: a aba Monitores só simulava — não listava, não salvava, não publicava.
Os acessos existiam no servidor e não tinham tela (conceder exigia chamar a API na mão), e
o backend **não conferia o sujeito**: dava para gravar acesso para um tipo inventado, para
um id que não é ObjectId, ou para o setor de **outra conta** — a linha na tela dizia que
alguém tinha acesso, e a decisão nunca batia com ela. E editar uma fonte significava
duplicar e apagar, deixando para trás o destino materializado.

**Passou a valer**:

- **Monitores**: lista com estado e Flow, criação pelo caminho da Central, edição no mesmo
  id (a fonte observada vai junto — sem ela, "salvar" viraria "criar em outro lugar"),
  publicar, pausar, excluir com confirmação, e o mínimo que falta dito em vez de o botão
  ficar mudo;
- **Acessos**: painel por fonte com prédio/andar/setor/agente, a precedência escrita na
  tela, e o backend resolvendo o sujeito pelo mesmo `resolveSubject` do resto do produto —
  um segundo resolvedor divergiria na primeira mudança de hierarquia. A recusa é a mesma
  para id inválido, inexistente e de outra conta: distinguir contaria que aquele id existe;
- **Edição de fonte**: o mesmo wizard, com o tipo travado — ele decide a forma inteira, e
  trocá-lo seria criar outra fonte;
- **Exclusão**: "tem certeza?" não é pergunta. A confirmação diz o que continua existindo
  (o histórico) e o que deixa de existir (a regra de coleta).

**E um achado**: escrevendo o teste de acessibilidade apareceu que **nenhum campo desta
página tinha rótulo associado programaticamente** — quem navega por teclado ouvia "caixa de
combinação" e mais nada. Consertado no `Field` compartilhado, vale para o app inteiro.

**Prova**: `monitoringGrants.integration.test.mjs` **22/22** (6 novos de sujeito inválido,
inexistente e de outra conta; neutralizando as guardas, 5 caem) e
`e2e/monitoring-center.spec.ts` **44/44**, incluindo 320 px nas abas novas, rótulos
associados e alvo mínimo de toque.
