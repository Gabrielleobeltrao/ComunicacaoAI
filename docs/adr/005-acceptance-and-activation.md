# ADR 005 — "Pronto" exige prova, e ligar exige duas coisas

## Contexto

No V1, um item de checklist fica verde porque o recurso **existe**. Isso confirma que a
aplicação rodou, não que a operação funciona.

O que passa despercebido por essa definição:

- uma fonte criada apontando para uma URL que responde 404;
- uma fonte que responde 200 e **não traz** o campo obrigatório — ela parece viva, e o
  monitor em cima dela nunca dispara;
- um monitor cuja comparação está invertida, que nunca reconhece a própria transição;
- um Flow com um passo dependendo de outro que não existe, pulado em silêncio pelo motor;
- um agente sem função escrita, que aparece no organograma como uma caixa muda;
- um Database sem conjunto: não há o que ler nem onde gravar.

Nenhum deles aparece em "criado com sucesso". Todos aparecem para a pessoa depois, quando o
aviso não chega.

O tipo `ChecklistCompletionMode` já previa `'test_result'` desde o começo — e **nenhum código
o usava**.

## Decisão

**1. Cada Blueprint declara os testes que provam a operação.** Oito tipos, e cada um observa
o recurso real criado naquela operação:

| Tipo | O que observa de verdade |
| --- | --- |
| `source` | bate na origem, aplica o mapeamento, confere que os campos obrigatórios chegaram |
| `monitor_simulation` | constrói a transição que a própria regra descreve e confere que ela dispara |
| `flow` | confere que existe passo e que todo `dependsOn` resolve |
| `agent_contract` | confere que a função escrita não está vazia |
| `database_permission` | lê pelo caminho canônico, que filtra por dono, e confere que há conjunto com campos |
| `channel`, `app_dry_run`, `delivery` | **pendentes**, cada um com o que fazer |

Os três últimos ficam `pending` porque não há caminho observável: o canal depende de uma
mensagem real chegar de fora, o dry-run depende de o App declarar um, e a entrega depende de
um destino concreto. **`pending` nunca vira `passed`** — marcar qualquer um deles como
aprovado seria dizer que a operação foi provada quando ninguém observou nada.

**2. Ativar exige as duas coisas, e as duas obrigatórias:**

1. o teste do alvo **passou**; e
2. a `key` veio em `approvedActivationKeys` na requisição de aplicar.

Um alvo **sem teste declarado não é ativável**. Um alvo com dois testes, um passando e um
falhando, também não: o que reprova manda.

**3. O resultado entra na Activity pela projeção que já existe.** Cada teste abre uma raiz de
execução com `environment: 'test'` e `source: 'manual'`. Um teste reprovado marca a execução
como falha, com `errorKind: 'acceptance_failed'`.

**4. O resultado fica na OPERAÇÃO, não no projeto.** É a prova daquela aplicação: uma nova
aplicação tem que provar de novo.

## Alternativas descartadas

**Marcar como pronto o que foi criado, e deixar o teste para o usuário.** É o V1. A pessoa
não volta para conferir, e o defeito aparece semanas depois, no momento em que o aviso
deveria ter chegado.

**Uma coleção própria para os resultados dos testes.** Criaria uma segunda verdade que
envelhece ao lado da linha do tempo. A raiz de execução em ambiente `test` já é o lugar onde
"o que rodou" mora.

**Ativar automaticamente o que passou.** Passar num teste prova que funciona, não que a
pessoa quer isso no ar agora. Aplicar uma proposta nunca pode colocar a operação para rodar
sozinha no mesmo instante.

**Considerar ativável o que não tem teste.** Seria ligar por falta de evidência contrária —
exatamente o defeito que este ADR fecha.

## Consequências

A prontidão passa a ter **bloqueios com texto**: um teste obrigatório que não passou aparece
em `readiness.blockers` com o que foi observado ("a fonte respondeu, mas não trouxe rsi"), e
não como um item cinza sem explicação.

Os itens de teste **não podem ser marcados à mão**. `completionMode: 'test_result'` saiu do
tipo e virou comportamento.

A saga ficou mais lenta: ela bate na origem de verdade antes de terminar. É o custo de a
aplicação responder "funciona" em vez de "criei".

Hoje a saga liga **fontes**. Monitores e Flows têm o portão no código (`activatableKeys` já os
cobre), mas publicar um monitor pede simulação com dados reais, que só existem depois da
primeira coleta — está registrado como pendência, não como pronto.
