# Arquiteto do Escritório

O que este documento fixa é a **fronteira**: onde o modelo age e onde ele não age.

## A separação

```
conversa  ──►  LLM  ──►  OfficeBlueprintV1  ──►  validador  ──►  prévia  ──►  confirmação  ──►  saga
              (propõe)      (descrição)         (determinístico)  (hash)     (do dono)     (escreve)
```

A LLM produz **um** artefato: um `OfficeBlueprintV1`. Ele é uma descrição, não um
comando — e é isso que torna o resto possível de conferir.

Duas decisões carregam essa fronteira:

**Referência por `key`, nunca por ObjectId.** Um id vindo do modelo é um id inventado, e
um id inventado que case por acaso com o de outra conta é a diferença entre uma proposta
e um vazamento. As `key`s são texto escolhido dentro da própria proposta; a tradução para
id real acontece na aplicação, uma vez, com a posse já conferida.

**A posse entra por parâmetro.** `validateOfficeBlueprint(blueprint, ctx)` é puro: não
abre conexão, não consulta coleção. O `ctx` traz os conjuntos de ids que são do dono,
lidos em `context.ts`. Assim não existe caminho em que a validação consulte o banco sem
`ownerId` — porque ela não consulta o banco — e o teste consegue montar o caso "id de
outra conta" sem subir Mongo.

## Os módulos

| Arquivo | O que é |
|---|---|
| `types.ts` | O contrato do blueprint, da checklist e da operação de aplicação |
| `knowledge.ts` | Onde o conhecimento de cada escopo realmente mora |
| `routineSteps.ts` | A tradução `key` → id das etapas de rotina |
| `links.ts` | Ligar um item da proposta a um recurso real do dono |
| `limits.ts` | Os tetos, num lugar só — quem valida e quem monta o prompt concordam sobre eles |
| `secrets.ts` | Máscara de credencial, aplicada na **entrada** |
| `blueprint.ts` | Blueprint vazio, merge de patch por `key`, hash canônico |
| `validate.ts` | A validação determinística. Puro |
| `checklist.ts` | Deriva a checklist do blueprint e calcula prontidão. Puro |
| `state.ts` | A máquina de estados do projeto, como tabela |
| `prompt.ts` | O prompt, com a conversa delimitada como dado não confiável |
| `turn.ts` | Uma rodada: limite → chamada → contabilização → parser → um reparo |
| `context.ts` | O que a conta realmente tem, lido do banco |
| `preview.ts` | A prévia determinística e o hash |
| `apply.ts` | A saga: cria, retoma, desfaz |
| `recheck.ts` | A prontidão apurada contra o estado real |
| `repository.ts` | As três coleções, todas com `ownerId` no filtro |
| `service.ts` | O que as rotas chamam |
| `guard.ts` | Ritmo por dono e uma rodada por projeto |

## Onde cada conhecimento mora

O produto tem dois mecanismos, e eles não são intercambiáveis:

| Escopo | Mecanismo | Por quê |
|---|---|---|
| `agent`, `sector` | base de conhecimento (documento + chunks) | é o que `KnowledgeOwnerType` aceita |
| `floor`, `building` | memória determinística | a base não aceita esses donos |

Mandar um andar para a base exigiria inventar um dono — e foi exatamente esse o defeito
da primeira versão: um documento gravado sob um ObjectId que não era de ninguém, invisível
na tela do andar, invisível na do agente, ocupando espaço para sempre. Hoje um alvo que
não está no mapa faz a etapa **falhar**; nunca vira id novo.

## Etapas de rotina, e o problema do id

Uma etapa fala de recurso por id (`agentId`, `sectorId`). O blueprint fala por `key`.
`routineSteps.ts` traduz na aplicação, com o id real do que acabou de ser criado, e o
prédio vem do servidor. Sem essa tradução haveria duas saídas, as duas ruins: o modelo
inventando ids, ou o Arquiteto só conseguindo propor rotinas sem etapa nenhuma.

Na validação, a mesma tradução roda com **marcadores** — ObjectIds válidos e descartáveis
— só para o validador de rotinas conferir a estrutura. A existência de cada `key` é
conferida à parte, contra a própria proposta.

## Create, reuse e update

`reuse` não toca no recurso. `update` aplica **apenas** os campos que a proposta declara,
pelos serviços canônicos, e **apenas** com aprovação individual: `approvedUpdateKeys` sai
da tela e é conferido de novo na saga. O checkbox decide o que é enviado; o servidor decide
o que é feito.

`resourceId` nunca vem do modelo — é arrancado de qualquer profundidade da resposta. Quem
preenche é a tela, escolhendo de `GET /targets` (só recurso do dono), e `PATCH /links`
confere a posse de novo antes de gravar.

O `buildingPatch` é um item de prévia como qualquer outro, com aprovação própria. Antes era
ignorado em silêncio: a proposta pedia renomear o prédio e nada acontecia.

## Por que saga, e não transação

O produto não exige replica set. Uma transação que só existe em parte das instalações é
uma garantia falsa — funciona no ambiente de quem escreveu e não no de quem instalou.

O que substitui a transação é o `resourceMap` da operação: cada recurso criado é gravado
com a `key` que o originou **antes** do passo seguinte, numa escrita só. Disso saem as
três propriedades que importam:

- **Idempotência** — o passo consulta o mapa antes de criar. Aplicar duas vezes encontra
  o que já existe.
- **A janela entre criar e registrar** — o instante em que o recurso existe e a operação
  ainda não sabe. É o que a **marca de origem** (`architectStamp.ts`) cobre: cada recurso
  criado carrega projeto, operação e `key`, gravados na mesma escrita, e a saga procura por
  ela antes de criar. Um índice único parcial recusa o duplicado mesmo numa corrida.
- **Uma retomada por vez** — `claimOperation` é um `findOneAndUpdate` atômico com
  arrendamento que expira. O estado do projeto não bastava: um projeto travado em
  `applying` aceita retomar, e duas abas passariam as duas por lá.
- **Retomada** — a operação recomeça com o mapa que já tinha. Uma queda no meio não
  recria o que ficou pronto.
- **Compensação segura** — o desfazer só olha para passos com `status: 'created'` desta
  operação, que ainda existem e que ninguém editou depois. O que não é seguro remover
  fica de pé e vira aviso; um rollback que apaga o que não devia é pior do que um que não
  completa.

O lock é uma troca de estado atômica (`ready → applying`), não um `findOne` seguido de
`update` — que perderia a corrida entre dois cliques.

## O que nunca acontece sozinho

**Conhecimento sem conteúdo não vira documento.** O requisito fica `missing`, a checklist
mostra a pendência e quem depende dela não fica pronto. É o ponto onde um cardápio
inventado entraria no sistema parecendo verdade.

**Conectado não é concedido.** O App conectado é da conta; a permissão é de cada agente. O
item de checklist só fica pronto quando existem instalação ativa, grant no agente e as ações
que o requisito pede. Conectado sem permissão continua pendente, com o link levando ao
agente que falta.

**Permissão de App exige duas condições juntas**: instalação ativa **e** aprovação
explícita naquela aplicação. Faltando qualquer uma, o passo é registrado como `skipped`
com o motivo, e o item continua na checklist. Um grant apontando para uma conexão que não
existe seria uma promessa de acesso que falha na primeira execução.

**Rotina nasce rascunho, e só manual ou agendada.** Webhook e gatilho por evento armam um
recebedor — um deles gera URL pública com segredo. Um rascunho que o dono ainda não
aprovou não deveria conseguir armar nada.

## Desfazer

Só o que **esta** operação criou, que ainda existe, que ninguém editou depois e cuja marca
de origem aponta para ela. E sempre pelo caminho canônico: documento sai por
`deleteDocumentFor` (que leva os chunks), agente por `deleteAllForAgent` + `deleteAgent`,
rotina por `deleteAutomationCascade` (que leva versões, execuções e artefatos). Um
`deleteOne` direto deixaria pedaço indexado aparecendo na busca de um documento que não
existe mais.

O que não é seguro remover fica de pé e vira aviso — inclusive o andar quando é o único do
prédio, porque o domínio recusa removê-lo e o desfazer não é caminho privilegiado.

## Custo

`askAuxWithUsage()` existe porque `askAux()` sempre gastou tokens e nunca disse quanto.
`askAux()` continua com a assinatura de sempre e agora sai da nova.

A ordem em `turn.ts` é a garantia: o teto mensal é conferido **antes de cada chamada** —
inclusive o reparo, porque a primeira já pode ter estourado o limite —, e o
consumo é registrado **mesmo quando a resposta veio ilegível** — o provedor já cobrou, e
não registrar aí seria gasto invisível. A chave de cobrança sai do id da mensagem, então
repetir a rodada depois de um erro de rede não cobra duas vezes.

Um reparo, e só um. Insistir em ciclo transforma uma resposta ruim numa conta alta, e é
justamente quando o modelo está confuso que ele erra de novo.

## Testes

- `architectBlueprint.test.mjs` — validação, merge, hash, checklist, máquina de estados (puro)
- `architectTurn.test.mjs` — parser, forma da resposta, prompt, dublê (puro)
- `architectTurn.integration.test.mjs` — limite antes do gasto, cobrança única, reparo único
- `architectRoutes.integration.test.mjs` — fronteira da conta, conversa, prévia, checklist
- `architectApply.integration.test.mjs` — confirmação, idempotência, retomada, rollback, reconferência
- `architectCorrections.integration.test.mjs` — escopos de conhecimento, reuse/update/aprovação, marca de origem, queda entre criar e registrar, retomadas concorrentes, desfazer sem órfão
- `frontend/e2e/architect-app.spec.ts` — a jornada, os erros, o celular e 320 px
