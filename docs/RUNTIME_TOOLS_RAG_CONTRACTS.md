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
