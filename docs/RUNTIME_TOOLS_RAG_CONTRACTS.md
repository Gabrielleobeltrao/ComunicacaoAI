# Runtime: ferramentas, RAG e contratos executáveis

Decisões desta rodada, o que muda para quem já usa o produto e o que foi testado.
Nada aqui altera a Central de execuções nem os logs/auditoria já estabilizados.

## 1. Um único caminho para ferramentas HTTP

**Antes** havia dois executores. As Custom Tools passavam por `executeToolCall`
(schema, credencial só em memória, `safeFetch` com SSRF inclusive em redirect,
lista de domínios, timeout, limite de chamadas, mascaramento e autorização para
métodos mutáveis). As ferramentas legadas do agente (`agent.tools[]`) usavam um
`fetch` direto sem nenhuma dessas regras.

**Agora** o `fetch` legado não existe mais. `legacyToolToExecutable` adapta o
formato antigo para a forma canônica em tempo de resolução e a chamada segue pelo
mesmo executor. Nada é apagado nem migrado no banco: a adaptação acontece na
leitura, então os dados do usuário continuam como estão. O tipo `AgentTool` está
marcado como deprecated.

- **Compatibilidade:** uma ferramenta legada de leitura (GET) continua funcionando,
  agora com validação de argumentos, host restrito ao próprio domínio, resposta
  limitada e mascaramento.
- **Mudança de comportamento deliberada:** uma ferramenta legada com método
  mutável (POST/PUT/PATCH/DELETE) passa a exigir autorização explícita, como
  qualquer Custom Tool. Sem ela o agente recebe uma *capacidade ausente* e a
  requisição não é feita. É o objetivo da rodada: escrita autônoma não acontece por
  omissão.

**Capacidade ausente é estruturada.** Ferramenta desativada, sem autorização ou
inexistente devolve `{"status":"capability_unavailable","executed":false,...}` com
a instrução de não afirmar que executou — uma frase em prosa era lida pelo modelo
como resultado.

**Validação no despachante.** `runResolvedTool` é o ponto único por onde passam
custom tools, legadas, built-ins e delegação: os argumentos são validados contra o
schema declarado antes de qualquer adapter rodar. O limite global de 6 iterações
(`MAX_TOOL_ITERATIONS`), o timeout e o cancelamento continuam onde estavam, nos
dois provedores.

## 2. Contratos de entrada/saída executáveis

`inputContract`/`outputContract` continuam texto livre e agora **chegam ao modelo**
nas instruções de execução e de delegação — antes eram configurados e nunca saíam
do banco.

Três campos opcionais no agente (ausentes = comportamento atual):

- `defaultOutputFormat` (`text|markdown|json`) — o formato quando quem chama não
  pede um específico;
- `outputJsonSchema` — validado com o mesmo validador das ferramentas; entra no
  prompt apenas quando é pequeno e raso o bastante (4000 chars / 8 níveis), mas é
  **sempre** aplicado na resposta;
- `requireGrounding` — recusar em vez de responder sem base.

**JSON é contrato:** a resposta é parseada *e* validada. Uma falha dá direito a
**uma** correção (o modelo recebe o erro), cujos tokens são cobrados normalmente;
persistindo, a execução termina como `validation` e a saída inválida não é
entregue.

**Delegação** respeita o alvo: o formato é o do agente chamado quando o chamador
não especifica, o schema viaja junto, os contratos dele entram na instrução, e o
input pode ser string ou JSON.

**Pipeline:** o `expectedOutput` da etapa entra na instrução e a entrega é
verificada antes da etapa seguinte — um resultado vazio para a cadeia em vez de
descer silenciosamente. O `onError`/retry continua como está e nenhuma etapa
concluída é chamada duas vezes.

## 3. RAG consistente

- **A pergunta** passa a ser objetivo + instruções + input, com o input
  serializado quando é objeto ou array (limitado). Um passo cujo input era JSON —
  um webhook, a saída de outra etapa — não recuperava nada.
- **Score mínimo** configurável (`KNOWLEDGE_MIN_SCORE`, padrão 0.5): abaixo dele o
  trecho não entra no prompt. Deduplicação e orçamento de contexto continuam.
- **Proveniência**: cada trecho selecionado carrega `documentId`, título curto e
  agente/setor de origem, sempre dentro da mesma conta.
- **Falha nunca vira contexto.** O status é explícito: `ok`, `empty`, `no_base` ou
  `unavailable`. Com `requireGrounding`, `unavailable` e `empty` falham como
  `knowledge_unavailable` (retryable) sem gastar inferência; no padrão opcional a
  execução segue e o status fica registrado.
- O contexto continua tratado como dado não confiável contra prompt injection.

## 4. Telemetria

O evento por execução ganhou apenas escalares seguros: `grounding`, `ragChunks`,
`toolsAvailable`, `outputFormat`, `outputRepaired` e a contagem de tool calls
concluídas. Nenhum prompt, trecho, payload, resposta ou segredo — a asserção está
no teste.

## Testes

- `toolUnification.test.mjs` — adaptação da ferramenta legada, validação de
  argumentos, domínio, SSRF, escrita autônoma recusada, resposta limitada,
  capacidade ausente estruturada, validação no despachante, cap de iterações.
- `outputContract.test.mjs` — contratos na instrução, schema limitado, JSON válido,
  correção única com tokens cobrados, segunda falha como `validation`, text/markdown
  intactos.
- `groundingContract.test.mjs` — pergunta com input JSON, limites, status de
  grounding, obrigatório vs opcional, telemetria sem conteúdo, formato do agente.
- `delegation.test.mjs` (novos casos) — formato/contrato do alvo, input JSON,
  `expectedOutput` na etapa, entrega vazia interrompendo o pipeline sem repetir
  etapa concluída.
- `knowledge.test.mjs` — score mínimo, proveniência preservada.
- E2E — bloco "Contrato de saída" em Avançado, schema só em JSON, seções simples
  sem schema.

---

# Correções de produção (rodada final)

Seis defeitos encontrados na revisão do runtime autônomo. Nenhum contrato público
mudou; os campos novos continuam opcionais.

## 1. A correção de JSON não repete efeitos

A segunda chamada existe só para reformatar a resposta que já existe. Ela agora roda
**sem ferramenta nenhuma** — antes recebia a mesma lista e podia repetir um POST, um
GET ou uma delegação enquanto "consertava" o JSON. Os tokens das duas chamadas
continuam cobrados; os `toolCalls` reportados são apenas os da execução original,
porque a correção não fez nenhum.

## 2. O contrato declarado das delegações

`delegate_to_agent` e `delegate_to_sector` declaravam `input: { type: 'string' }` e
nem declaravam `format`, enquanto o código já aceitava JSON e um formato. Agora
`input` aceita texto ou qualquer valor JSON (`additionalProperties: true` no
sub-schema é o que deixa um OBJETO passar pelo validador) e `format` é um enum
`text|markdown|json`. `additionalProperties: false` na raiz continua: um campo
inventado é recusado. Os testes passam pelo `runResolvedTool`, o mesmo despachante
que os dois provedores usam.

## 3. requireGrounding vale em delegação e setor

`DelegationDeps.retrieveContext` devolvia `string[]`, o que transformava falha em
lista vazia e apagava a diferença entre "não achei" e "não consegui procurar". Agora
o `RetrievalResult` inteiro viaja (context, sources, status, failed). Antes de
chamar o modelo, um alvo com `requireGrounding` e status diferente de `ok` encerra
sem inferência e devolve `{"status":"knowledge_unavailable","grounding":...}`
distinguindo `unavailable`, `empty` e `no_base`. No pipeline, `empty` e `no_base` não
consomem tentativas do `retryPolicy` (repetir não muda a resposta); `unavailable`
sim. O setor continua entrando apenas quando já validado no escopo do owner.

## 4. Credenciais de ferramentas legadas

O formato antigo guarda a credencial num header comum, que pode se chamar qualquer
coisa — a heurística por nome não bastava. Toda ferramenta legada agora executa com
`allHeadersAreSecret`: **todos** os seus headers entram na máscara forçada do detalhe
e seus valores na redaction do corpo, da resposta ecoada e da mensagem de erro. Na
saída da API o valor é substituído por `***` (`toPublicAgent`, aplicado nas quatro
rotas que devolvem o agente) e, no salvamento, um valor que volta mascarado significa
"mantenha o guardado" — nada é apagado. Escrita legada (POST/PUT/PATCH/DELETE)
continua bloqueada até autorização explícita, e a recusa aponta a conversão segura
para Custom Tool, onde a credencial fica criptografada.

## 5. Procedência utilizável

Cada trecho vai ao modelo como `[n] Título · doc <id>` seguido do texto, mantendo a
marcação de dado não confiável. O `ownerId` nunca aparece. Na telemetria vai apenas
a contagem de documentos distintos (`ragSources`) — nunca título, trecho, prompt ou
resposta.

## 6. Pipeline e observabilidade, sem exagero na promessa

`expectedOutput` entra na instrução da etapa. A verificação antes da próxima etapa é:

- **estrutural** quando a etapa produz JSON — parse e, havendo `outputJsonSchema`,
  validação contra ele;
- **apenas não-vazio** para contratos em texto. `expectedOutput` é prosa e não há
  como verificar deterministicamente que foi cumprida; o código não afirma que
  verificou. Essa é a limitação, declarada.

Rotina, delegação e setor registram os mesmos escalares seguros: `grounding`,
`ragChunks`, `ragSources`, `outputFormat`, `outputValid`, `outputRepaired`,
`toolsAvailable`, `toolsExecuted`, `durationMs` e tokens.

## Caminhos de chamada auditados

`claude.ts` e `openai.ts` despacham exclusivamente por `runResolvedTool`; toda
ferramenta HTTP (custom, legada) executa por `executeToolCall`. Built-ins e
delegação têm adapters próprios, mas passam pela validação de argumentos do
despachante e pelo teto de 6 iterações.
