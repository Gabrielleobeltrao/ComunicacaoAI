# Executar sem IA, e guardar informação sem IA

Duas coisas que andam juntas: um gatilho pode processar o que chega **sem chamar
modelo nenhum**, e pode **guardar** o que chegou num lugar do prédio.

O problema que isso resolve: hoje, para um webhook "salvar o pedido que chegou", a
única saída é mandar o corpo para um agente e torcer para ele gravar. Custa tokens a
cada evento, demora, e o resultado varia. Um pedido que chega mil vezes por dia não
precisa de inteligência para ser guardado — precisa de um INSERT.

## Modos de execução

Declarado em `AutomationDefinition.executionMode`. **Ausente = `ai`**, e é isso que
faz todo gatilho e toda rotina criados antes disto continuarem exatamente como eram.

| Modo | O que faz | Custo |
|------|-----------|-------|
| `collect_only` | recebe, valida, transforma e guarda | 0 tokens |
| `deterministic` | o acima + regras, apps compatíveis e entrega | 0 tokens |
| `ai` | o comportamento de sempre: o agente lê cada evento | por evento |
| `hybrid` | processa sem IA e chama o agente **só** quando a condição bate | só quando bate |
| `automatic` | igual ao híbrido, com a regra escolhida de uma lista | só quando bate |

### A garantia, e por que ela tem duas travas

**Só `agent.execute` fala com um modelo.** É a regra que sustenta tudo aqui, e está
declarada em código (`AI_STEP_TYPES`): se um dia outra etapa passar a inferir, ela
entra nessa lista e os testes de "zero token" quebram — que é exatamente o que deve
acontecer.

1. **Na compilação.** Num modo sem IA, a etapa `agent.execute` **não é gerada**. Não
   há passo para pular, não há flag para inverter, e quem abrir a definição publicada
   vê que não existe passo de modelo nenhum.
2. **Na execução.** O runner recusa rodar uma etapa de IA num modo sem IA, para uma
   definição que tenha vindo por outro caminho — importada, editada à mão, criada por
   uma versão anterior.

Duas travas para o mesmo erro é proposital: este é o erro que gasta dinheiro do
usuário sem ele ter pedido.

### Híbrido e automático nunca chamam em silêncio

`hybrid` e `automatic` **sem condição não geram etapa de IA**. Sem isso, "automático"
seria "sempre" — o modo `ai` com outro nome e uma conta que o dono não escolheu.

A condição (`StepDefinition.runIf`) é avaliada por código puro, nunca por um modelo:
se a decisão de chamar a IA passasse por uma IA, o modo custaria tokens justamente
nas vezes em que promete não custar.

Ela **falha fechada**: operador desconhecido, caminho que não existe, expressão
regular inválida — tudo devolve `false`. Numa decisão sobre gastar, a dúvida tem que
significar "não gaste"; o contrário transformaria um erro de digitação em conta no
fim do mês.

Operadores: `exists`, `absent`, `equals`, `not_equals`, `contains`, `gt`, `lt`,
`matches`.

## Memória determinística

Coleção `memories`. Nenhuma operação passa por modelo.

```ts
{
  tenantId, scope, agentId, sectorId, floorId, buildingId,
  scopeKey,        // 'agent:<id>' | 'sector:<id>' | 'floor:<id>' | 'building:<id>'
  initialized: …,  // ver abaixo
  key, payload, sourceType, sourceId, metadata, dedupeKey,
  searchText,      // chave + conteúdo achatados, para a busca
  createdAt, updatedAt, expiresAt
}
```

`scopeKey` existe para os índices: um índice único sobre quatro campos opcionais
depende do comportamento do Mongo com nulos e vira armadilha; sobre uma string só, a
unicidade é óbvia.

### Estratégias

| Estratégia | Comportamento | Quando |
|------------|---------------|--------|
| `append` | um registro por evento | histórico — apagar o anterior perderia o pedido de ontem |
| `upsert` | um por chave, **mistura** os campos | cadastro que chega em pedaços: o evento com só o telefone não apaga o e-mail |
| `replace` | um por chave, **troca** o conteúdo | estado atual: o preço de hoje não é a soma dos preços passados |

Um campo mapeado que **não veio** no evento fica de fora do payload, em vez de entrar
como nulo. Escrever nulo diria que o evento afirmou "não tem" — e num `upsert`
apagaria o que um evento anterior trouxe.

### Não duplicar

`dedupeKey` + índice único parcial. A trava é o índice, **não** uma consulta antes de
escrever: entre "já existe?" e "então insiro" cabe outra tentativa do mesmo evento, e
é exatamente isso que acontece quando um remetente reenvia por timeout. Erro de chave
duplicada vira desfecho `duplicate`, que é **sucesso** — o evento já está guardado.

Sem `dedupeKey`, nada é barrado: quem não soube dizer o que torna o evento único não
pode ter o segundo evento legítimo recusado como repetido.

### Limites e sanitização

Chave ≤ 200 caracteres, payload ≤ 64 KB, metadados ≤ 4 KB, página ≤ 100. Um webhook
público recebe o que mandarem; sem teto, um remetente distraído enche a coleção.
Excesso é **recusado, não truncado** — truncar guardaria um registro que parece
completo e não é.

Chave de payload começando com `$` ou contendo ponto é neutralizada (`$set` → `_$set`,
`a.b` → `a_b`): guardar cru é deixar o conteúdo do payload falar com o banco. Ciclo é
recusado, não achatado.

### TTL

`ttlSeconds` vira `expiresAt`, apagado por índice TTL do Mongo. Ausente = para sempre.

## Permissões

Memória pertence a um **lugar** do prédio, e quem está naquele lugar enxerga:

- **agente**: a própria, os setores de que **participa**, o andar, o prédio;
- **dono da conta**: todo o prédio dele.

O setor entra por participação (estar na lista de membros), não por poder chamar:
poder pedir uma tarefa a um setor não é o mesmo que poder ler o que ele guardou.

A lista de alvos de uma consulta é montada **a partir de quem pergunta** — nunca
recebida do cliente. Um id de outra conta simplesmente não aparece na lista, então
não há o que vazar mesmo que ele seja adivinhado.

A etapa de gravação carrega `ownerAgentId`: é sob a permissão desse agente que ela
grava. Deduzi-lo do passo de IA funcionaria só nos modos que têm um — e é justamente
nos modos sem IA que a checagem não pode sumir.

## `buscar_memoria`: a ferramenta, não o prompt

Todo agente ganha a ferramenta. A alternativa óbvia — injetar a memória no prompt — é
errada por três razões que aparecem no primeiro mês:

- **custo**: mil registros viram mil registros de contexto em toda mensagem;
- **limite**: a janela acaba, e o corte é por tamanho, não por relevância — some
  justamente o registro que importava;
- **ruído**: um modelo com quinhentos pedidos antigos na frente responde pior sobre o
  pedido de agora.

A busca é textual e determinística. O modelo pode pedir um escopo, mas só consegue
**estreitar** o que já lhe é permitido. Busca semântica não existe nesta fase; se um
dia existir, será opcional e com o custo dito na tela.

## Executar um App sem LLM

A etapa `app.execute` chama uma ação de App direto. **Não existe executor paralelo**:
ela resolve o grant do agente pelo mesmo `resolveGrant` que monta as ferramentas do
modelo, e chama o mesmo `run`. Com isso vêm, sem cópia, a instalação resolvida por
`{ownerId, _id}`, a credencial descriptografada fora do alcance de qualquer argumento,
a autorização de escrita, a validação de schema, os limites, o SSRF e a telemetria.

Um segundo executor "só para automações" seria a forma mais rápida de perder uma
dessas garantias sem ninguém notar.

- A permissão é do **agente**, sempre: um gatilho não ganha acesso a um App por estar
  na mesma conta.
- Uma **recusa** (conexão revogada, ação não concedida, escrita não autorizada) FALHA a
  etapa. Deixar passar faria o fluxo gravar e entregar algo que nunca aconteceu.
- `args` aceita `{{campo}}`. Quando o valor é exatamente um template, o valor original
  é passado adiante — é o que permite entregar 500 candles sem transformá-los em texto.
- A interface oferece **somente** App conectado e ação concedida
  (`GET /api/agents/:id/app-actions`), com "0 tokens de LLM" no rótulo. Oferecer o
  catálogo inteiro levaria o dono a montar um fluxo que falha na primeira execução.

Ordem no fluxo: `origem → ação → memória → IA (se a condição bater) → entrega`. A ação
vem antes de guardar porque é o resultado dela que costuma valer a pena guardar, não o
evento cru.

## Apps oficiais são módulos

`backend/src/apps/official/<app>/` com `manifest.ts`, `adapter.ts` (quando há ação
nativa) e `index.ts`. `official/index.ts` agrega; `registry.ts` continua a fachada,
porque metade do sistema importa dela.

O que a divisão fechou: antes havia o manifesto num arquivo e um mapa
`NATIVE_FACTORIES` escrito à mão em outro — duas listas para a mesma verdade. Dava para
adicionar um App e esquecer o adapter, e o sintoma aparecia como "configuração
incompleta" quando alguém tentava usar a ação. Agora cada módulo exporta o que tem, e
`assertOfficialAppsConsistent` **para o processo no arranque** se um manifesto declarar
ação nativa sem adapter, se dois módulos disputarem a mesma key, ou se algo que não é
`source: 'system'` estiver ali.

Nada mudou de nome: keys, versões e action keys são as mesmas, porque todo grant,
instalação e migração já gravados apontam para elas. Há teste travando isso.

Internamente continua `source: 'system'`; a interface mostra **"Oficial"** — o dono
decide se confia pela procedência, não pela implementação. O catálogo separa Oficiais,
Comunidade e Meus Apps, porque a procedência muda o que o App pode fazer: só um oficial
roda código compilado, os outros são DATA-only/HTTP declarado no manifesto.

## App oficial: Análise de candles

`candle_analyzer`, `auth: none`, `allowedDomains: []`, ativação instantânea. Três ações
de leitura: `candles_calculate_indicators`, `candles_detect_patterns`,
`candles_find_opportunities`.

Não busca cotação e não conhece corretora — e é por isso que serve para qualquer origem
de dados. Quem traz os candles é outra peça do fluxo.

**O que ele nunca faz:** rede, modelo, ordem de compra ou venda. Ele descreve o que a
série mostra e dá uma nota. Há teste garantindo que a saída não contém BUY/SELL nem
"comprar"/"vender": decidir operar é de gente, ou de um App de risco que ainda não
existe, e essa separação é o que impede um bug de padrão de virar uma ordem enviada.

Entrada validada, não saneada: número não finito, OHLC incoerente (`high` menor que
`low`), timestamp repetido e série curta são **recusados** com o motivo. Calcular sobre
dado corrompido não dá erro — dá um número plausível e errado, e a diferença entre
"erro" e "número errado" é que o segundo alguém usa. Limite de 500 velas; vela em
formação é ignorada por padrão, com aviso, porque ela muda até fechar.

Indicadores pela convenção de Wilder (RSI, ATR) — a mesma das plataformas de gráfico,
senão o dono compararia com o gráfico dele e acharia o nosso errado. Funções puras: a
mesma série dá exatamente a mesma saída, sempre. Um agente que decide com base num
número que varia entre execuções é impossível de depurar.

Padrões só na **ponta** da série: um martelo de trinta velas atrás não é oportunidade
agora, e devolver o histórico daria ao agente uma lista para escolher — a decisão que
este App existe para não delegar. Padrões opostos na mesma vela se cancelam.

Saída: `schemaVersion`, `symbol`, `timeframe`, `candleCount`, `lastClosedAt`,
`opportunityFound`, `direction`, `score` (0..100), `patterns`, `indicators`, `reasons`,
`warnings`. Os pesos do escore estão escritos e nomeados no código, e cada fator que
entra deixa uma frase em `reasons` — um número sem razões é impossível de contestar.

Fluxo pretendido: **App de dados/HTTP → Candle Analyzer → condição
`opportunityFound = true` → memória → agente (opcional) → futuro App de risco**. Na
memória vai o SINAL, não os candles: guardar 500 velas por execução encheria o banco
com dado que já está na origem.

## Contrato da API

### Gatilho por evento — `POST` / `PATCH /api/agents/:id/event-triggers`

```ts
{
  executionMode?: 'collect_only'|'deterministic'|'ai'|'hybrid'|'automatic',
  memory?: { enabled, scope, sectorId?, floorId?, buildingId?, strategy, key,
             dedupeKey?, fieldMap?, ttlSeconds? },
  aiCondition?: { source, path, operator, value? } | null
}
```

Ausentes = comportamento de sempre. `objective` deixa de ser obrigatório quando o
fluxo não tem IA — não há a quem instruir.

### Memórias — `/api/memories`

- `GET /scopes` — os lugares desta conta, com contagem e data do último registro.
- `GET /` — busca. `scopeKey`, `scope`, `q`, `key`, `sourceType`, `since`, `until`,
  `limit`, `skip`. Sem `scopeKey`, procura em tudo que a conta pode ver.
- `DELETE /:id` — auditado.
- `POST /clear` — `{ scopeKey, key? }`. `scopeKey` é **obrigatório**: um corpo vazio
  apagaria a memória inteira do prédio. Auditado.

## Observabilidade

O run grava `executionMode` e `usedAI`. `usedAI: false` com `usage` zerado é a prova
auditável de que o modo sem IA cumpriu o combinado. `usedAI` vira `true` no instante
em que uma etapa de IA de fato roda — não quando ela existe na definição: uma etapa
pulada por condição não usou IA.

Etapas puladas ficam no histórico como `skipped`, não ausentes: quem for conferir
precisa ver que elas existiam e não rodaram.

## Configuração que não faz nada é recusada

"Somente coletar" sem fonte, sem destino de memória e sem ação responderia 200 e
encerraria: nenhuma etapa, nenhum efeito. Aceitar salvaria uma configuração que parece
pronta e não é, e o dono só descobriria quando o relatório viesse vazio. A recusa diz
qual das saídas tomar.

E a entrega nunca aponta para uma etapa inexistente: sem IA e sem fonte, a origem da
entrega é a gravação; se nem ela existe, a entrega não é gerada. Apontar para o vazio
produziria uma definição inválida na publicação, com um erro que não diz nada ao dono.

## Validação na publicação

`validateDefinition` confere `executionMode`, `runIf` e as configurações de
`memory.*` e `app.execute`. Uma condição malformada é avaliada como falsa em execução
— seguro, mas silencioso: o dono configuraria "chamar a IA quando o valor passar de
1000", nunca seria chamado, e não teria como saber por quê. Recusar na publicação diz
o problema na hora.

## Migração

Aditiva, sem backfill de dados:

- índices de `memories` criados na migração (consulta, chave, busca, dedupe, TTL);
- definições sem `executionMode` são lidas como `ai`;
- runs sem `usedAI` são de antes — e eram todos com IA.

Nenhuma variável de ambiente nova.
