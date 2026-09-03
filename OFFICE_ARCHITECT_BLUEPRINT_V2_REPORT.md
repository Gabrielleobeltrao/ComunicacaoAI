# Blueprint V2 do Arquiteto — relatório final

Branch: `feat/office-blueprint-v2`, sobre `development`. 18 commits.

Este relatório descreve o que está de pé, o que foi encontrado no caminho e o que **não**
ficou pronto. A última seção não é um apêndice: é a parte que decide se isto pode ser ligado
para todo mundo.

---

## 1. O que o Arquiteto passou a ser

Antes, ele era uma **página**. Quem estava num andar, num agente ou no Monitoramento tinha de
sair de onde estava, ir para `/architect` e recomeçar a conversa. E toda mensagem entrava num
projeto: quem perguntava "qual o valor do dólar hoje?" recebia uma proposta de operação e um
projeto que ninguém pediu, no histórico da conta para sempre.

Agora ele é um **chat global**, montado acima das rotas — a conversa sobrevive à navegação. E
os quatro modos decidem o que acontece, com **um só** criando estrutura:

| Modo | O que faz | Cria projeto? |
| --- | --- | --- |
| `answer` | responde com fonte e horário, ou recusa dizendo o que conectar | não |
| `explain` | lê o inventário e descreve o escritório real | não |
| `operate` | leitura responde; escrita para em aprovação, com prévia do impacto | não |
| `propose` | monta a proposta e abre o projeto | **sim** |

O plano desenhado deixou de ser só organização. O **Blueprint V2** cobre as três camadas do
§5 — Organização, Recursos e Operação — e é aplicado pela **mesma saga** do V1: mesmos passos
registrados, mesmo `resourceMap`, mesma retomada, mesmo desfazer. Não há segunda engine.

E "pronto" deixou de significar "o documento existe". Passou a significar "o teste passou".

---

## 2. As 13 lacunas do §4, uma a uma

Cada uma foi **caracterizada antes** de ser corrigida, e cada correção tem um caso que falha
quando a linha de produção é revertida.

| # | Lacuna | Onde a correção mora |
| --- | --- | --- |
| 1 | o V1 não representa Databases, Sources, Monitors, Flows, canais, entregas | `typesV2.ts` + `blueprintV2.ts` — contratos, validação estrutural e conversor |
| 2 | `liveDataNeeds` não vira fonte + destino + monitor | `compileV2.ts` — `compilarFonteDeDado` e `compilarVigilancia` |
| 3 | reaproveitar só vale para floor, agent, sector, routine | `links.ts` — mais `database`, `source`, `monitor`, `flow`, sobre o plano V2 |
| 4 | um andar genérico, sem escolha entre expandir e criar | `areasOf` + `findExistingFloor`, que reconhece o andar existente pela mesma área |
| 5 | requisitos de App com `actionKeys: []` | `resolveAppActions` — ações exatas do manifesto, separadas em leitura e escrita |
| 6 | o canal escolhido pode ser o primeiro conectado | `resolveChannel` — o **pedido** ganha; o que a conta não tem vira pendência |
| 7 | declarar o App de canal não cria o vínculo | `operations.channels` — quem chega tem um agente que recebe |
| 8 | revisão não atualiza a topologia inteira | saga do setor: membros, coordenador, etapas e mudança de andar |
| 9 | condição sobre dado vira rotina com cron padrão | `parseDataCondition` **antes** do dispatch + `CADENCIA` no classificador |
| 10 | a simulação é estrutural, não prova integração | `acceptance.ts` — bate na origem de verdade, pelos serviços canônicos |
| 11 | o Flow pode mostrar responsabilidade vazia | `SectorFlow` + validador V2 exigindo `role`, `trigger` e contratos |
| 12 | "Montar operação" escondido no seletor de andares | `NAV_V2` + o chat global em toda rota |
| 13 | a exclusão de andar não produz impacto completo | `floorImpact.ts` — impacto, `impactHash`, archive/restore/purge |

---

## 3. Os cenários obrigatórios do §20

`backend/test/architectScenarios.integration.test.mjs` aplica o Brief pela saga **de verdade**
— serviços canônicos, coleções reais, uma origem HTTP que responde de fato. Nenhum stub
genérico: um mock devolvendo o que o teste espera provaria só que o mock funciona.

| Cenário | Estado |
| --- | --- |
| **A** — pergunta atual, sem mutação | responde ou recusa honestamente; **nenhum projeto criado** |
| **B** — CXSE3/RSI | fonte + histórico + monitor + Flow, todos parados; fonte testada antes de ativar; campo ausente nunca vira zero; resultado na Activity em ambiente `test` |
| **C** — restaurante | agentes com responsabilidade escrita no recurso real; ações exatas de WhatsApp e Calendar; escrita autônoma vazia; cardápio **pendente** |
| **D** — salão existente | andar reusado, não duplicado; aplicar sobre o que existe não cria um segundo |
| **E** — Flow de setor | prévia e estrutura aplicada comparadas item a item; os três modos ditos em português e distintos |
| **F** — exclusão de andar | impacto completo, `impactHash`, nome digitado, compartilhado preservado, concorrência e retomada |

---

## 4. Onze defeitos que os testes encontraram, e que o plano não previa

Nenhum deles aparece no desenho. Todos aparecem na hora de aplicar, de ler ou de desligar.

1. **`validateConfig` recusava o próprio discriminador.** O `kind` dentro do config é gerado
   pelo servidor e voltava como campo estranho: **nenhuma fonte podia ser reescrita a partir
   da que estava gravada** — nem pela tela, nem pela aplicação de um Blueprint. Um `kind`
   trocado continua recusado.
2. **Uma aplicação que falhava devolvia HTML.** `ApplyFailure` caía no 500 padrão do Express;
   a tela ficava sem o motivo e sem o `operationId` — e existe rota para *retomar*, que sem
   ele não tem o que retomar.
3. **O desfazer não conhecia o V2.** Um rollback deixava Database, dataset, fonte e monitor de
   pé.
4. **Duas rotas sem decisão de auditoria** — inclusive `POST /floors/:id/purge`, a exclusão
   irreversível. E a rodada do assistente criava projeto **por dentro do serviço**, sem passar
   pela rota que audita: um projeto criado pelo chat flutuante ficava sem registro nenhum.
5. **Uma fonte sem origem derrubava a aplicação inteira** com "mapeie ao menos um campo", numa
   etapa que não tem defeito — falta uma informação que só a pessoa tem.
6. **"Reservar mesa", com frequência "sempre", virava automação agendada.** É a mesma
   patologia de "quando o RSI ficar abaixo de 30" virando cron das oito da manhã.
7. **A ação do App casava por substring exata.** "criar o evento na agenda" não achava "Criar
   evento" — um artigo no meio, e o agente é criado sem alcançar o sistema de que precisa.
8. **Um canal nativo virava requisito de App vazio**, recusado pelo validador — e derrubava a
   **proposta inteira** com um erro que ninguém conseguia resolver na tela.
9. **A prévia dizia "Setor no modo parallel"** — o enum, em inglês, na tela de quem aprova.
10. **Arquivar deixava Flow e fonte no ar.** Um andar arquivado que continua gastando token e
    batendo em servidor de terceiro não está arquivado.
11. **`setSourceStatus` lia `telemetry` sem guarda, inclusive ao PAUSAR** — uma fonte que
    ninguém conseguia desligar.

---

## 5. A bateria do §21 — execução limpa, números reais

| Comando | Resultado |
| --- | --- |
| `npm ci` | exit 0 (instalação limpa a partir do lockfile) |
| `npm run build` | exit 0, inclusive **depois** do `npm ci` |
| `npm run test -w backend` | **1566 + 2257 = 3823**, 0 falhas |
| `npm run test:runner` | 21, 0 falhas |
| `npm run test:browser-worker` | 32, 0 falhas |
| `npm run test -w frontend` | **294** em 36 arquivos, 0 falhas |
| `npm run lint -w frontend` | exit 0 — **0 erros**, 44 avisos |
| `npm run test:e2e -w frontend` | **739 passaram**, 17 puladas, **0 falhas, 0 flaky** |
| `npm run smoke` | exit 0 |
| `npm run secret-scan` | 2265 arquivos, nada encontrado |
| `git diff --check` | limpo |

Nenhuma asserção foi reduzida, nenhum retry foi acrescentado e nenhuma integração foi trocada
por mock para chegar aqui.

**Sobre uma execução que falhou:** numa corrida, dez casos de `websocketRoutes` caíram com
`fetch failed` num servidor local; a corrida seguinte, idêntica, passou inteira. Era
contenção — eu estava rodando o build do frontend e o Playwright na mesma máquina. Cheguei a
escrever um teto de concorrência por memória no corredor de testes e **revertí**: com 8,6 GB
a conta dava o mesmo número de antes, então seria um conserto de fachada. Os números acima
são de uma execução com a máquina livre.

---

## 6. O que NÃO ficou pronto

Esta seção existe porque o §22.12 pede que ela exista, e porque nada abaixo está escondido em
outro lugar do relatório.

### A flag está LIGADA, e a chave de desligar continua existindo

Os 12 critérios do §22 foram atendidos, e a Fase 10 diz "remover flag apenas após critérios de
saída" — então `ARCHITECT_BLUEPRINT_V2` passou a nascer ligada. Ela **não foi removida**:
`ARCHITECT_BLUEPRINT_V2=0` desliga. Remover de vez apagaria o rollback documentado e
transformaria "voltar atrás" num deploy; enquanto custa uma linha, mantê-la é mais barato que
o incidente que ela evita. E só o "não" explícito desliga: uma variável mal digitada não pode
derrubar o produto por acidente.

**Ligar a flag revelou dois defeitos que teriam quebrado o produto para todos**, e é a melhor
justificativa possível para ter ligado antes de declarar pronto:

1. **Nenhuma primeira aplicação funcionaria.** O hash gravado usava o `blueprintV2`
   **anterior** enquanto o mesmo patch salvava o novo. A aplicação recomputava com o novo, os
   dois não batiam, e toda tentativa era recusada com "a proposta mudou desde a última
   revisão".
2. **A segunda aplicação duplicaria o escritório.** Depois de aplicar, uma rodada nova
   recompila do zero; o V1 corrige isso com `marcarOQueJaExiste`, e o V2 não tinha
   equivalente. Cada Database, fonte e monitor voltava como `create`.

Os dois estão corrigidos, com teeth check.

### A cadeia de Operação está parcial

| Tipo | Estado |
| --- | --- |
| Database, dataset, Source, Live, History, Monitor, Flow | criados pela saga |
| `channel` nativo (`web_chat`) | **criado**, apontado para o agente ou setor de entrada |
| `delivery` | **criada** como passo `delivery.send`, na conexão escolhida ao aplicar |
| `channel` de App (WhatsApp, Telegram) | pendência: depende do número, do token e da instalação conectada |
| `tool` `existing` | **ligada** nos agentes que a usam, pelo `updateAgent` canônico |
| `tool` `app_action` | pendência: é um grant, e o caminho é o bloco de Apps |
| `tool` `function` | **resolvida** quando o registro tem a função (o plano a nomeia); pendência quando não tem — código não se infere de uma descrição |

Sobre a entrega, uma correção do que este relatório dizia antes: eu havia escrito que ela era
impossível por desenho. Não é. O contrato do V2 proíbe **endereço** dentro do Blueprint — e
isso continua valendo, porque o plano é lido inteiro pela tela e viaja no histórico do
projeto. Mas o que a entrega precisa é de um `connectionId`, e ele vem da **requisição**,
como `approvedAppKeys`: uma referência a uma conexão que já existe na conta, conferida contra
o dono antes de qualquer escrita.

Cada pendência traz o motivo — nunca um recurso incompleto que parece pronto.

### A cadeia da vigilância, do jeito que ela realmente funciona

A ordem é **fonte → histórico/conjunto → Flow → monitor**, e ela é assim porque o monitor
grava o id do Flow que aciona. Criá-lo antes deixa o `flowId` nulo: um alarme que reconhece a
transição e não aciona nada. O Flow, por sua vez, não precisa do monitor para existir — quem
o chama é o monitor, depois.

O monitor é criado numa **segunda passada**, depois de a fonte entrar no ar, porque é aí que
o conjunto observado passa a existir. E o que nasce nessa segunda passada é provado antes de
ser publicado: sem isso o monitor ficaria com o teste `skipped` para sempre, e um teste pulado
não torna nada ativável.

O Flow do aviso tem etapa mesmo sem agente. "Observe e me avise" não precisa de um: montar o
texto do que aconteceu é determinístico, e um agente ali só acrescentaria custo e a chance de
ele reescrever o número.

### A ativação cobre a cadeia inteira

Fonte, Flow e monitor entram no ar quando o teste passou **e** o dono autorizou. A ordem é a
que o domínio exige — publicar o Flow, ativar o Flow, publicar o monitor — porque
`publishMonitor` recusa um monitor cujo Flow não tem versão publicada: um monitor que aciona
um Flow sem versão é um alarme que toca no vazio.

### O chat deixou de ser um buraco

O relatório anterior descrevia um chat que classificava pelo corpo da requisição, respondia
vazio e travava o campo. Isso foi fechado: a intenção é decidida no servidor, `answer` consulta
a fonte real e devolve valor/fonte/horário, `operate` executa leitura e prepara escrita com
prévia e hash, `explain` lê o recurso, e **toda** rodada termina com texto. O detalhe está na
seção correspondente do PROGRESS.

### Outras pendências reais

- **`app_dry_run` fica pendente para todo App**: nenhum manifesto do catálogo declara
  execução de teste. O plano qualifica com "app dry-run **quando suportado**" (§13), então o
  resultado `pending` é o correto — implementar exigiria primeiro criar a capacidade nos Apps.
- **A conversa global não tem streaming**, e nenhum provider desta base faz streaming. O plano
  qualifica com "streaming/cancelamento **quando suportado pelo provider**" (§6).
- **Em `/architect/:id` existem duas conversas** — a da página e a global, que se esconde.
- **O inventário não reaproveita canais e entregas** — repetido aqui porque é a pendência que
  mais aparece na prática: um canal já conectado não é oferecido de volta pelo plano.
- **`docs/security/` tinha zero documentos** antes deste trabalho; agora tem um, o do
  Arquiteto. O resto do produto continua sem.

### O que estava aqui como pendência e deixou de estar

Duas linhas deste relatório descreviam limitações que hoje não existem mais. Elas ficam
registradas porque o que mudou é verificável:

- **A marca de origem chegou aos quatro tipos.** `architect.operationId`, `projectId` e
  `blueprintKey` são gravados na MESMA escrita que cria o recurso, para Database, Source,
  Monitor e Flow. É o que fecha a janela entre criar e registrar o passo: uma queda ali era
  um recurso órfão, e a retomada criava outro.
  Provado em `architectV2OrphanWindow.integration.test.mjs` — 16 casos, um por tipo: a marca
  gravada, a queda na janela que não duplica na retomada, e a marca de OUTRA operação que não
  é adotada.

- **O dublê de LLM responde à frase.** Ele devolvia o mesmo brief de restaurante para
  qualquer entrada, então a cadeia fonte → histórico → Flow → monitor era exercitada pelo
  compilador e pela saga, nunca pela conversa. Hoje "Observe CXSE3 e me avise quando o RSI
  ficar abaixo de 30" entra por `POST /assistant/turn` e sai do outro lado com a cadeia no ar.
  Provado em `architectCxse3EndToEnd.integration.test.mjs` — 14 casos.

### Uma decisão que pode ser revista

**Não há backfill.** Projetos antigos não são convertidos em massa: a conversão preserva
`key` e `resourceId`, mas o V2 exige campos que o V1 não tem, e o conversor não os inventa —
ele declara a pendência. Rodar isso em lote encheria contas de pendências que ninguém pediu.
Se o produto decidir que quer todo mundo no V2 de uma vez, esta decisão precisa ser revertida
com uma tela que mostre as pendências geradas.

---

## 7. Como voltar atrás

Desligar `ARCHITECT_BLUEPRINT_V2` e reiniciar. É tudo.

Projetos que já têm `blueprintV2` continuam funcionando: a flag controla se planos **novos**
são compilados, não se os antigos valem. Recursos já aplicados são recursos comuns do produto
e continuam nas telas normais. **Nada é apagado**, porque não há migração destrutiva a
reverter.

Para desfazer uma aplicação específica: `POST /projects/:id/rollback`, que remove apenas o que
aquela operação criou, que ainda existe e que não foi editado depois.

O procedimento completo está em `docs/architect-blueprint-v2-operacao.md`; as fronteiras de
confiança, em `docs/security/architect-blueprint-v2.md`; e as decisões, nos ADRs 001 a 006.
