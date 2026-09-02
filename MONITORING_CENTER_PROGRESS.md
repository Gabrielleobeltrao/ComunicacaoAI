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

## Próxima ação exata

1. **Unions discriminadas** para `config` e `cadence`, com validação por tipo — hoje
   `MonitoringConfig` é um objeto com todos os campos opcionais, e a validação é por
   capacidade do tipo (`KIND_CAPABILITIES`), não pela forma.
2. **As cinco abas da Central** e o wizard: nada disso está na tela ainda.
3. **Tipos que ainda não funcionam**: **SSE** como protocolo explícito, App/action,
   RSS/Atom com parser de feed de verdade (hoje cai no caminho de página) e `dataset` como
   fonte da Central. `internal_event`, `websocket` e `webhook` funcionam.
4. **Browser em worker isolado** e **OCR/visão com confiança e evidência** — nada existe, e
   o plano é explícito que dado incerto não dispara.
5. **Grants por agente/setor** sobre fonte, e autorização reconferida antes da leitura.
6. E2E 320 px, acessibilidade, e a bateria completa (frontend, lint, smoke, secret-scan).

## O que ainda NÃO existe

Nada da Central está na tela ainda, e nenhuma fonte é executada por ela — este bloco é o
modelo e o extrator, com teste. O resto está na lista acima.
