# Blueprint V2 do Arquiteto — operação, rollout e volta atrás

Este documento é para quem opera o sistema, não para quem o escreveu. Ele responde a três
perguntas: **como ligar**, **o que muda quando liga**, e **como voltar** se algo der errado.

## A chave

```
ARCHITECT_BLUEPRINT_V2=1
```

`1`, `true` ou `on` ligam. Qualquer outra coisa — inclusive a ausência da variável — deixa
desligado. Não há default oculto: a leitura é `backend/src/architect/flags.ts`, uma função de
uma linha, e ela é consultada a cada compilação, não uma vez no boot. Isso significa que
**mudar a variável e reiniciar o processo basta**; não há cache a limpar.

## O que muda quando liga

| | Desligada | Ligada |
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

## Como ligar com segurança

1. Ligue em **uma conta de teste** primeiro (`ARCHITECT_BLUEPRINT_V2=1` num processo isolado).
2. Crie um projeto, valide e abra a prévia. O hash muda — é esperado: ele agora cobre os dois
   planos.
3. Aplique **sem** `approvedActivationKeys`. Confira que os recursos nasceram e que nada
   entrou no ar.
4. Confira os passos da operação: `GET /projects/:id` traz `operation.steps`. Nenhum passo
   pode estar `failed`.
5. Confira a prontidão: os itens com `completionMode: 'test_result'` refletem os testes de
   aceitação, e um obrigatório que não passou aparece em `readiness.blockers`.

## Como voltar atrás

**Desligar a variável e reiniciar.** É tudo.

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

## O que ainda não está pronto

- A tela de aplicação **não pergunta** o que entrar no ar. O cliente já aceita
  `approvedActivationKeys`; hoje só dá para autorizar pela API. O padrão seguro vale: sem a
  lista, nada liga.
- A saga liga **fontes**; monitores e Flows têm o portão no código mas dependem de dados
  reais para a simulação, que só existem depois da primeira coleta.
- `app_dry_run` fica pendente para todo App: nenhum manifesto declara execução de teste.
- `tool`, `delivery` e `channel` não têm criação automática — cada um vira pendência
  explícita, com o que falta.
