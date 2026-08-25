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

## Por que saga, e não transação

O produto não exige replica set. Uma transação que só existe em parte das instalações é
uma garantia falsa — funciona no ambiente de quem escreveu e não no de quem instalou.

O que substitui a transação é o `resourceMap` da operação: cada recurso criado é gravado
com a `key` que o originou **antes** do passo seguinte, numa escrita só. Disso saem as
três propriedades que importam:

- **Idempotência** — o passo consulta o mapa antes de criar. Aplicar duas vezes encontra
  o que já existe.
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

**Permissão de App exige duas condições juntas**: instalação ativa **e** aprovação
explícita naquela aplicação. Faltando qualquer uma, o passo é registrado como `skipped`
com o motivo, e o item continua na checklist. Um grant apontando para uma conexão que não
existe seria uma promessa de acesso que falha na primeira execução.

**Rotina nasce rascunho, e só manual ou agendada.** Webhook e gatilho por evento armam um
recebedor — um deles gera URL pública com segredo. Um rascunho que o dono ainda não
aprovou não deveria conseguir armar nada.

## Custo

`askAuxWithUsage()` existe porque `askAux()` sempre gastou tokens e nunca disse quanto.
`askAux()` continua com a assinatura de sempre e agora sai da nova.

A ordem em `turn.ts` é a garantia: o teto mensal é conferido **antes** da chamada, e o
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
- `frontend/e2e/architect-app.spec.ts` — a jornada, os erros, o celular e 320 px
