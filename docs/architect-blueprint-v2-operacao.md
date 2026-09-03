# Blueprint V2 do Arquiteto — operação, rollout e volta atrás

Este documento é para quem opera o sistema, não para quem o escreveu. Ele responde a três
perguntas: **como ligar**, **o que muda quando liga**, e **como voltar** se algo der errado.

## A chave

O V2 é o padrão. Para **desligar**:

```
ARCHITECT_BLUEPRINT_V2=0
```

`0`, `false` ou `off` desligam. Qualquer outra coisa — inclusive a ausência da variável —
deixa **ligado**. Um valor mal digitado não derruba o produto por acidente: só o "não"
explícito desliga.

A leitura é `backend/src/architect/flags.ts`, uma função de uma linha consultada a cada
compilação, não uma vez no boot. **Mudar a variável e reiniciar o processo basta**; não há
cache a limpar.

## O que muda quando liga

| | Desligada (`=0`) | Ligada (padrão) |
| --- | --- | --- |
| Plano V1 | montado como sempre | montado como sempre |
| Plano V2 | não existe | compilado do mesmo Brief e gravado em `blueprintV2` |
| `blueprintVersion` | `1` | `2` |
| Hash da revisão | do recorte V1 | do recorte V1 **+** do plano V2 |
| Aplicação | organização, conhecimento, rotinas, grants | o mesmo **+** Databases, datasets, fontes, destinos, monitores e Flows |
| Templates da Comunidade | proposta V1 | proposta V2 convertida, com as mesmas `key`s |

O que **não** muda: a saga é a mesma, os passos entram na mesma lista, o `resourceMap` é o
mesmo, a retomada e o desfazer são os mesmos. Não há segunda engine.

### Uma organização, dois documentos

Enquanto a flag rola, quem cria andares e agentes continua sendo a saga do V1. O compilador
V2 recebe os andares prontos e os usa **como estão** — ele não inventa `key` nenhuma. Sem
isso, um Flow do V2 apontaria para `floor:atendimento` enquanto a saga criou
`floor:operacao`, e a aplicação falharia num passo que não tem defeito.

A garantia está travada em teste: `test/architectV2Flag.integration.test.mjs` compara as
chaves dos dois planos e confere que aplicar cria **um** andar, não um por plano.

### Nada nasce ligado

Fonte, monitor e Flow nascem rascunho. Entrar no ar exige **as duas coisas**:

1. o teste de aceitação do alvo **passou**; e
2. a `key` veio em `approvedActivationKeys` no corpo do `POST /projects/:id/apply`.

Um alvo sem teste declarado **não é ativável**. Ausência de teste não é prova.

## Como conferir depois de subir

1. Crie um projeto, valide e abra a prévia. O hash muda — é esperado: ele agora cobre os dois
   planos. A proposta passa a mostrar Databases, fontes e monitores, agrupados.
2. Aplique **sem** marcar nada em "O que já entra no ar". Confira que os recursos nasceram e
   que nada entrou no ar.
3. Aplique de novo marcando a fonte. Confira que ela só entra no ar se o teste passar.
4. Confira os passos da operação: `GET /projects/:id` traz `operation.steps`. Nenhum passo
   pode estar `failed`.
5. Confira a prontidão: os itens com `completionMode: 'test_result'` refletem os testes de
   aceitação, e um obrigatório que não passou aparece em `readiness.blockers`.

## Como voltar atrás

**`ARCHITECT_BLUEPRINT_V2=0` e reiniciar.** É tudo.

O que acontece com o que já foi criado:

- **Projetos que já têm `blueprintV2`** continuam funcionando. A saga continua sabendo
  aplicá-los; a flag controla se planos **novos** são compilados, não se os antigos valem.
  Isso está travado em teste ("desligar a flag DEPOIS não quebra um projeto que já tem plano
  V2").
- **Recursos já aplicados** (Databases, fontes, monitores) continuam existindo e são
  gerenciados pelas telas normais — eles são recursos comuns do produto, não objetos do
  Arquiteto.
- **Nada é apagado.** Não há migração destrutiva a reverter, porque não há migração
  destrutiva: projetos antigos nunca são reescritos.

Se for preciso desfazer uma aplicação específica, o caminho é o que já existia:
`POST /projects/:id/rollback`. Ele remove **apenas** o que aquela operação criou, que ainda
existe e que não foi editado depois — e agora conhece também os recursos do V2. `live` e
`history` ficam de fora de propósito: são destinos ligados numa fonte que pode ser
preexistente, e desligá-los às cegas apagaria histórico que alguém já vinha alimentando.

## Backfill: por que não existe

Projetos antigos **não são convertidos em massa**, e é uma decisão, não uma pendência.

A conversão V1→V2 (`convertV1ToV2`) preserva `key` e `resourceId`, mas o V2 exige campos que
o V1 não tem — função, gatilho, contrato de entrada e de saída de cada agente. O conversor
**não inventa** esses campos: ele os deixa vazios e declara a pendência. Rodar isso em massa
encheria as contas de pendências que ninguém pediu, num plano que talvez nunca seja aplicado
de novo.

A conversão acontece sob demanda, quando alguém realmente vai usar o documento — na
instalação de um template, por exemplo. É o único momento em que a pendência tem para quem
aparecer.

## Onde olhar quando algo dá errado

| Sintoma | Onde | O que procurar |
| --- | --- | --- |
| Aplicação retorna 502 | corpo da resposta | `code: 'apply_failed'`, `message` com o passo, `operationId` para retomar |
| Um recurso do V2 não nasceu | `operation.steps` | o passo com `status: 'failed'` e a mensagem dele |
| Fonte não entrou no ar | `operation.acceptance` | o teste do alvo; e se a `key` veio em `approvedActivationKeys` |
| "Pronto" não fica verde | `readiness.blockers` | o texto do que o teste observou |
| Um teste de aceitação | Activity | execução com `environment: 'test'` e `errorKind: 'acceptance_failed'` |

## O que ainda fica pendente, e por quê

- **`tool` com `provider: 'function'`** — um cálculo a registrar precisa de código, e código
  não se infere de uma descrição. Os outros dois providers funcionam: `existing` liga a
  ferramenta que a conta já tem, `app_action` aponta o bloco de Apps.
- **Canal de App** (WhatsApp, Telegram) — depende do número, do token e da instalação
  conectada. O canal nativo do site é criado.
- **`app_dry_run`** — nenhum App do catálogo declara execução de teste. O plano qualifica com
  "quando suportado"; implementar exige criar a capacidade nos Apps primeiro.
- **Streaming da conversa** — nenhum provider desta base faz streaming, e o plano qualifica
  com "quando suportado pelo provider".
