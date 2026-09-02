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

## Próxima ação exata

1. Serviço de fontes: criar, testar de verdade (com `safeFetch`, que já revalida redirect),
   amostra redigida, pausar, duplicar, excluir — orquestrando recorder e fonte ao vivo.
2. Pipeline fonte → Live/Dataset → Monitor → Flow → Activity, reusando `dataHistory`,
   `monitors/dispatch` e a linha do tempo.
3. Rotas + as cinco abas da Central.
4. Sites: JSON → JSON-LD → DOM → browser em worker isolado, com SSRF revalidado em cada
   subrequisição.
5. Bateria completa e testes de ameaça.

## O que ainda NÃO existe

Nada da Central está na tela ainda, e nenhuma fonte é executada por ela — este bloco é o
modelo e o extrator, com teste. O resto está na lista acima.
