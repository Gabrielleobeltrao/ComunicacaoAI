# Arquitetura de executores

Como um agente é executado — e por que nem toda execução passa por um modelo.

## O problema

Todo agente era uma chamada a um provedor de modelo. Isso funciona e continua
funcionando, mas nem todo trabalho precisa de um: somar uma coluna, chamar um
endpoint, formatar um documento. Fazer essas coisas por modelo é caro, lento e
não determinístico — a mesma entrada pode dar respostas diferentes, e para uma
soma isso não é aceitável.

O segundo problema era o acoplamento por texto. Uma etapa entregava uma frase à
seguinte, que precisava achar o número dentro dela. Quando errava, errava em
silêncio: a resposta saía completa, com aparência de fundamentada, e falsa.

## As peças

```
backend/src/executors/
├── types.ts             o contrato: ExecutorKind, ResponseMode, ExecutorResult
├── contract.ts          leitura leniente (agentContractOf) e escrita estrita
├── functionRegistry.ts  o registro FECHADO de funções + a porta de adaptadores
├── functionExecutor.ts  valida → timeout → roda → valida
├── toolExecutor.ts      grants, instalações e a chamada externa que já existia
├── dispatcher.ts        o ÚNICO ponto que decide quem executa
└── stepExecution.ts     as duas conferências em volta de uma etapa de plano

backend/src/sectorPlanner.ts   o plano: seleção, bindings, compilação
backend/src/delegation.ts      o runtime que executa o plano e audita cada etapa
```

### `ExecutorKind`

| tipo | quem faz o trabalho | custo em token |
|---|---|---|
| `llm` | um provedor de modelo | sim |
| `function` | código deste repositório, registrado por nome | zero |
| `tool` | uma ferramenta da conta ou uma ação de App instalado | zero (paga a API de terceiro) |

**Ausente é `llm`.** Um agente criado antes de qualquer um destes campos lê como
`llm`, com `responseMode: 'text'` e sem schemas — exatamente o comportamento que
ele sempre teve. Nenhuma migração destrutiva, nenhum documento tocado.

### `ResponseMode`

`structured` entrega só o dado; `text` só o texto; `structured_and_text` os dois.
Entregar o que não foi pedido não é generosidade: é como um dado intermediário
vira frase e a frase vira a entrada do próximo.

## O plano

O planejador recebe cada membro com o CONTRATO, não só com a descrição: tipo de
executor, `inputJsonSchema`, `outputJsonSchema`, ferramentas e ações autorizadas.
A nota de afinidade pesa capacidade (3), ferramenta (3) e roteamento (3) acima do
nome (0,5) — um agente batizado de "Financeiro" casa com metade das perguntas de
uma empresa sem que isso diga nada sobre o que ele entrega.

### A gramática dos bindings

Uma tarefa declara DE ONDE vem cada campo. Três origens, e só três:

```
$context.campo          o pedido
$steps.<id>.campo       o resultado de uma etapa anterior
42, "BRL", {...}        um valor literal JSON  ($$ escapa um literal com cifrão)
```

Não há expressão, JSONPath, filtro nem fórmula. O plano é redigido por um modelo
a partir de uma pergunta que qualquer pessoa faz; uma expressão avaliável nesse
caminho é execução arbitrária com passos a mais. Uma referência escrita errado é
**erro**, não literal — aceitá-la como texto entregaria `"$contexto.cnpj"` ao
agente como se fosse o CNPJ.

`__proto__`, `prototype` e `constructor` são recusados no caminho, no destino e
dentro de literais.

### `compilePlan`

Roda ANTES de qualquer execução e confere: agente é membro do setor; capacidade
adequada; ids válidos e únicos; dependência existente e só para trás; ausência de
ciclo; origem para todo campo obrigatório; compatibilidade entre a saída de um e a
entrada do outro; e existência da função ou da ação.

Quando falta um campo que ninguém produz, há três saídas, nesta ordem: convocar
quem produz, pedir esclarecimento, ou falhar dizendo qual campo falta. **Não
existe a quarta** — preencher com um valor plausível.

## A execução de uma etapa

```
resolve bindings → valida contra inputJsonSchema → [NÃO EXECUTA se falhar]
                 → dispatcher → executa
                 → valida data contra outputJsonSchema → [não vira entrada de ninguém se falhar]
                 → aplica responseMode
```

Um campo declarado e não entregue **para** a tarefa: seguir sem ele é entregar a
prosa ao agente e deixá-lo deduzir o número.

### O teto de tempo NÃO cancela CPU síncrona

`timeoutMs` corre num `setTimeout` do mesmo processo. Isso interrompe a **espera** por uma
promessa — não a CPU de um laço síncrono. Um handler que trava o event loop trava o
servidor inteiro, e nenhum timeout aqui salva ninguém.

É por isso que handler registrado é código deste repositório, revisado como qualquer
outro. Ao escrever um:

- mantenha-o não bloqueante: nada de laço sobre entrada de tamanho arbitrário, nada de
  regex com retrocesso exponencial, nada de `while` esperando condição;
- confie no teto de entrada (256k) e no schema para limitar o trabalho, não no timeout;
- trabalho pesado vai para **outro processo**, atrás de um `FunctionAdapter` — lá o
  timeout vale, porque o que se cancela é uma espera de rede.

## Criar uma nova função registrada

Uma função é código deste repositório. O agente guarda o NOME; o corpo vive no
servidor. Em `backend/src/executors/functionRegistry.ts`:

```ts
registerFunction({
  functionName: 'financeiro.margem',   // chave ESTÁVEL: mudá-la quebra os agentes que a usam
  version: '1.0.0',                    // fixável pelo agente, para ele não mudar sozinho
  description: 'Margem sobre receita e custo',
  capabilities: ['calculo'],           // o mesmo vocabulário do resto do sistema
  inputSchema: {
    type: 'object',
    properties: { receita: { type: 'number' }, custo: { type: 'number' } },
    required: ['receita', 'custo'],
  },
  outputSchema: {
    type: 'object',
    properties: { margem: { type: 'number' } },
    required: ['margem'],
  },
  // `config` são os PARÂMETROS que o dono fixou no agente (uma moeda, um arredondamento).
  // Dados, nunca segredo: o executor recusa chaves que pareçam credencial antes de chamar.
  handler: ({ receita, custo }, config) => ({
    margem: Number((((receita - custo) / receita) * 100).toFixed(Number(config?.casas ?? 2))),
  }),
  timeoutMs: 5_000,                    // obrigatório: sem teto é uma execução que pode não terminar
})
```

O contrato do AGENTE é derivado daqui. Ao escolher esta função no formulário, o servidor
grava `inputJsonSchema`, `outputJsonSchema`, a versão e as capacidades a partir do
registro, e ignora o que o cliente enviar. Uma verdade só.

Regras que o registro impõe (`assertRegistryIsSound`):

- schema de entrada e de saída com raiz `object`;
- `timeoutMs` presente e finito;
- nome estável e único.

A função aparece sozinha no catálogo (`GET /api/executors/catalog`) e no seletor
do formulário. **O `handler` nunca sai para o cliente.**

Ao mudar o comportamento de uma função, suba a `version`. Um agente que fixou a
versão anterior passa a recusar com `not_configured` em vez de mudar de
comportamento em silêncio.

## O adaptador ML/Python (futuro)

`FunctionAdapter` é a porta para executores de outro tipo — worker Python, serviço
de modelo próprio, o que vier:

```ts
export interface FunctionAdapter {
  readonly name: string
  supports(functionName: string): boolean
  invoke(functionName: string, input: Record<string, unknown>, opts: { timeoutMs: number }): Promise<unknown>
}
```

O que ela **não** faz, e é o ponto: não recebe código. Recebe o NOME de uma função
que o outro lado já conhece, exatamente como o registro local. Um adaptador que
aceitasse script seria a mesma porta que esta arquitetura existe para fechar.

Ao implementar um, mantenha:

1. o nome como única coisa que atravessa a fronteira;
2. o `timeoutMs` respeitado do lado de lá também — um teto que só existe aqui não é teto;
3. a validação de entrada e de saída acontecendo **aqui**, contra os schemas registrados,
   e não confiada ao processo remoto;
4. nenhuma credencial no payload: o worker autentica pelo canal dele.

## Limites de segurança

| limite | onde | por quê |
|---|---|---|
| sem `eval`, `new Function`, shell, `vm`, `import()` com variável | varrido por teste sobre o fonte | a fronteira é: o código vem do repositório, o agente guarda o nome |
| registro fechado de funções | `functionRegistry.ts` | um nome fora da lista não roda |
| gramática de bindings sem expressão | `sectorPlanner.ts` | o plano é escrito por um modelo a partir de texto de qualquer pessoa |
| `__proto__`/`prototype`/`constructor` recusados | parse, compilação, runtime e sanitização | poluição de protótipo |
| teto de tempo obrigatório por função | `functionRegistry.ts` | execução que não termina |
| teto de tamanho da entrada (256k) | `functionExecutor.ts` | o validador percorre a estrutura inteira antes de recusar |
| `config` sem chave que pareça credencial | `functionExecutor.ts` | ela ficaria em texto claro no documento do agente |
| ação de App por correspondência EXATA | `toolExecutor.ts` | "a primeira ação" executaria `apagar` no lugar de `criar` |
| escopo de dono em ferramenta e agente | `getToolsByIds`, `resolveGrant`, membros do setor | um agente de outra conta não existe para este |
| credencial só na instalação cifrada | `resolveGrant` | um documento de agente vazado não vira acesso vazado |
| erro sem stack nem mensagem crua | executores | caminho de arquivo e valor de variável não saem |
| redação central + teto de tamanho + hash | `executionTrace.ts` | um painel não é um arquivo, e não é lugar de credencial |

## Idempotência

Índice e migração rodam no arranque de TODA instância: num deploy com mais de uma, rodam
concorrentes; num rollback, rodam de novo sobre dados que já passaram por elas. Se a
segunda execução não for igual à primeira, o defeito aparece durante um deploy — e
sempre em produção, porque em desenvolvimento ninguém sobe o processo duas vezes contra
o mesmo banco. `test/executorMigrations.integration.test.mjs` roda tudo duas vezes contra
um mongod real e compara a assinatura dos índices.

O índice único em `agent_execution_events.eventKey` é o que impede uma rotina
reexecutada de contar duas vezes — e é a razão de a criação dele precisar ser idempotente.

## Auditoria

Não há sistema de log paralelo: os quatro que já existiam continuam sendo os
únicos — `executionTrace` (ao vivo, na tela), `agent_execution_events` (o
registro por execução), `delegationLog` e o Execution Center.

Cada etapa registra, nos dois destinos e com o mesmo vocabulário:

- `executionId` e `rootExecutionId` — sem eles a etapa é um fato solto, sem ligação
  com o pedido que a causou;
- `planId` (derivado do conteúdo do plano), `stepId`, `agentId`;
- `attempt`, `startedAt` e `finishedAt` — o plano é replanejado até duas vezes, e sem
  o número duas linhas idênticas não dizem se foram duas tentativas ou duas etapas;
- `executorKind` e a `capability` que casou — o "por que este agente";
- `functionName@version`, `appKey.actionKey` ou `provider`/`model`, conforme o tipo;
- `inputSchemaHash` e `outputSchemaHash` — o hash responde "mudou?" sem guardar o quê;
- `inputValid`, `outputValid`, `error`, `field`;
- `dependsOn` e `inputOrigins` (as ORIGENS, nunca os valores);
- `hasStructured` / `hasText`, `outputRepaired`;
- `durationMs` (a etapa inteira) e `latencyMs` (só o provedor) — quando uma etapa
  demora, a primeira pergunta é se demorou o modelo ou a busca na base;
- `usage.inputTokens`, `usage.outputTokens`.

**Custo é medido em TOKEN, não em moeda.** Não há tabela de preços neste repositório, e
inventar uma produziria um número com cara de autoridade que envelhece na primeira
mudança de tabela do provedor — e que ninguém sabe que envelheceu. O que se compara é
token e tempo; a conversão para dinheiro é de quem tem a fatura.

A ficha vai para os dois lugares com o mesmo vocabulário: para a trilha ao vivo, que
some com a aba, e para `agent_execution_events`, que é o detalhe que FICA — e é ele que
alimenta `GET /api/sectors/:id/executions/:execId`. Uma participação gravada antes desta
fase não tem ficha, e ausente quer dizer o de sempre: execução por modelo.

O painel lê os MESMOS eventos por outro ângulo (aba "Auditoria"): plano com
dependências, origem dos inputs, validações separadas por entrada e saída, dado e
texto contados à parte, correções de formato, erro seguro, e o custo somado por
tipo de executor — que é a comparação que justifica tirar um trabalho do modelo.

### O que NUNCA entra

Credencial, cabeçalho de autorização, token de integração, prompt de sistema,
raciocínio privado do modelo, corpo de schema, valor de campo de cliente e payload
sem limite. A redação central (`sanitize`) remove por nome de campo (por
contenção: `refreshToken`, `x_api_token`), por formato de valor solto (`sk-…`,
`Bearer …`, `ghp_…`, JWT, `AKIA…`), corta o que passa do tamanho deixando um
preview **com hash** e para de descer na quarta profundidade.

Os contadores `inputTokens`/`outputTokens` estão numa lista de exceções explícita:
eles contêm "token" e são a conta que o dono precisa ver. Uma proteção que apaga a
conta não protege nada — só cega quem paga.
