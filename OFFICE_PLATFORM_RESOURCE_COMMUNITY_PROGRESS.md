# Office Platform — Resources, Databases, Monitors e Community

Progresso da execução de `OFFICE_PLATFORM_RESOURCE_COMMUNITY_GOAL.md`. Este arquivo é o
que permite continuar sem reler a implementação inteira: cada fase registra o commit
verde, o que foi feito, o que foi conferido e qual é a próxima ação exata.

## Baseline

- branch: `development`
- commit base: `d0d2ade` (2026-09-01) — igual ao `origin/development` no início; a base
  auditada pelo objetivo confere, sem diferenças a registrar
- `main` permanece em `0393b20` e não é tocada

### Comandos do baseline (nomes reais do repositório)

| comando | exit | resultado |
|---|---|---|
| `npm run secret-scan` | 0 | 2106 arquivos, nada encontrado |
| `npm run lint -w frontend` (`oxlint`) | 0 | só avisos de fast-refresh pré-existentes em `i18n/index.tsx` |
| `npm run test -w backend` | 0 | 1354 + 1617 testes |
| `npm run test -w frontend` (vitest) | 0 | 286 testes |
| `npm run build` | 0 | frontend + backend |
| `npm run test:e2e -w frontend` | 0 | 615 passaram, 17 pulados |
| `npm run smoke` | 0 | 6 casos + prontidão + SIGTERM |

`npm ci` não foi executado: as dependências já estão instaladas e reinstalar não faz
parte de conferir a base — se algum comando falhasse por dependência, aí sim.

## ADR 001 — Quatro camadas, uma fonte canônica por tipo

**Contexto.** O produto cresceu por subsistemas independentes (Knowledge, Apps, Tools,
histórico, automações). Cada um resolve dono e acesso do seu jeito, e a interface mistura
"o que existe" com "quem pode usar".

**Decisão.** Separar em Organization, Resources, Operations e Platform, e criar uma camada
de contrato comum para LISTAR, REFERENCIAR e EXPLICAR acesso — sem mover dado nenhum.

**O que NÃO fazemos, e por quê.** Uma supercoleção polimórfica de recursos parece
simplificar e cobra depois: cada tipo tem ciclo de vida, validação e política próprios, e
uma tabela comum vira um `if` por tipo em todo lugar, com o agravante de ter duas verdades
sobre o mesmo objeto. A projeção de catálogo guarda só metadado reconstruível.

**Consequência.** Toda regra de acesso continua morando no subsistema que a entende. A
camada comum delega — e delegar é o ponto: uma abstração que enfraquece o gate do App para
caber no formato genérico é pior que não ter abstração.

## Matriz canônico versus projeção

| Domínio | Fonte canônica | Projeção/derivado | Nunca copiado |
|---|---|---|---|
| Knowledge | `knowledge_documents`, `knowledge_chunks`, `knowledgeAccess.ts` | resumo no catálogo (id, título, dono, estado) | conteúdo, chunks, embeddings |
| App | `app_definitions`, `connections` (instalação), grants no agente | resumo (appKey, nome, risco das ações) | credenciais, tokens, config de conexão |
| Tool | coleção `tools` | resumo (nome, risco, runtime, estado) | segredo cifrado, headers, corpo |
| Database | (Fase 3) `data_stores`, `dataset_definitions` + adapters | resumo (nome, adapter, datasets, freshness) | registros, séries, credencial da fonte |
| Monitor/Flow | `automations` + `automation_versions` | estado ao vivo | payload integral, prompt, resposta |
| Extension | (Fase 7) `extension_packages`, `extension_versions` | catálogo | secret, dado do autor, config local |

## Fases

### Fase 0 — Baseline e ADR ✅ `c9e4bfe`

Baseline reproduzido, ADR e matriz acima registrados. Nenhum comportamento alterado.

### Fase 1 — Resource contracts e access facade ✅

`backend/src/resources/`: `types.ts` (contratos, catálogos de capacidade e a trava
`agentCapabilitiesOnly`), `scope.ts` (sujeito resolvido pelo servidor, com a hierarquia
lida agora e não copiada para dentro de grant), `registry.ts`, `catalog.ts`, `access.ts`,
`audit.ts` e adapters de LEITURA para Knowledge, App e Tool.

Decisões que valem registro:

- a camada comum **delega**. Knowledge decide pela política de conhecimento (a mesma que
  roda quando o agente responde), App pelos três gates (instalação utilizável + ação
  concedida + escrita autônoma), Tool por atribuição + habilitada + escrita autônoma. Uma
  regra genérica de herança por cima disso só poderia afrouxá-los;
- `database` está no contrato e **não** tem adapter: um adapter vazio responderia "nada
  encontrado" como se fosse verdade. Ele chega na Fase 3;
- escopo de outra conta responde 404 na rota, e não 200 com lista vazia — a diferença
  entre "não é seu" e "está vazio" é o que um inventário de contas alheias precisa;
- pendência ≠ acesso: conexão pausada, versão incompatível, App "em breve" e ferramenta
  desligada aparecem com código e ação corretiva, nunca como acesso funcional;
- `RESOURCE_PLATFORM_ENABLED=0` **nega a rota** (404), não só esconde a tela.

Rotas (leitura; mutação continua nas rotas canônicas de cada tipo):
`GET /api/resources`, `/:kind/:id`, `/:kind/:id/access`, `/:kind/:id/impact` e
`GET /api/agents/:id/resource-access`.

Testes: 22 em `backend/test/resources.integration.test.mjs` — isolamento entre contas nas
quatro entradas, recusa idêntica para id inválido/inexistente/alheio, delegação de
Knowledge com origem correta, atribuição como permissão de Tool, escrita exigindo
autorização, os três gates de App, matriz mostrando o negado com motivo, impacto separando
pode-usar de usou, e a flag negando. **Teeth**: revertendo a exigência de escrita autônoma,
a flag e a trava de capacidade, caem 3 testes.

Suíte: 1354 + 1640, verde.

### Fase 2 — UI organizacional e Access do agente ✅

- `navConfig.ts` ganhou o grupo **RECURSOS** e renomeou os outros: ESCRITÓRIO, RECURSOS,
  OPERAÇÕES. Apps e Históricos saíram de "controle" — "o que o escritório possui" e "o que
  aconteceu" eram duas perguntas no mesmo grupo. **COMUNIDADE não entrou**: um item de menu
  que leva a uma tela inexistente promete e não entrega; ele chega com o Marketplace.
- `pages/Resources.tsx` (`/resources`): catálogo global com filtro por tipo na URL, busca e
  os quatro estados distintos. Dono e estado aparecem separados — confundi-los é o que faz
  alguém achar que um App conectado está disponível para todo agente.
- `components/ResourceAccessMatrix.tsx` na página do agente: mostra o **negado** com o
  motivo, e a pendência com a ação. A pergunta que alguém traz até essa tela é quase sempre
  "por que ele não usa aquilo?", e uma matriz só do permitido não a responde.
- `components/FloorResources.tsx`: contagens do andar vindas do MESMO catálogo, filtradas
  por escopo — uma segunda lista divergiria na primeira regra esquecida.
- Rotas antigas preservadas: nenhuma foi movida ou removida nesta fase.

Defeito encontrado pelo smoke: os atalhos de recurso no andar nasceram com alvo de toque
de 26 px, abaixo do mínimo de 44. Corrigido no link (o `Badge` desenha; quem precisa ser
tocável é o link).

Testes: 6 novos em `frontend/e2e/resources.spec.ts` (lista com dono e estado, filtro e
busca com o tipo na URL, erro que não vira vazio, vazio dito como vazio, 320 px sem
overflow, grupos da navegação) e o teste de navegação atualizado. Vitest 287, E2E 621,
smoke 6, lint sem erro novo.

### Fase 3 — Data Stores/Databases (backend) ✅

`backend/src/databases/`: `types.ts`, `store.ts` (stores, datasets, grants, telemetria,
cotas e índices), `queryDsl.ts`, `schemaValidation.ts`, `access.ts`, `adapters.ts` e
`agentTools.ts`. Rotas em `routes/databaseRoutes.ts` (`/api/databases`).

Decisões que valem registro:

- **nenhum registro é copiado**. `data_history` lê a coleção que os recorders já
  alimentam; `market_data` lê `market_candles` e é somente leitura, porque candle e
  indicador vêm de um pipeline que já sabe fechar janela e deduplicar. Duplicar criaria
  duas séries com o mesmo nome e valores diferentes;
- **DSL fechada, não lista de bloqueio**. Não existe lista de bloqueio confiável para uma
  linguagem inteira: `$where` executa JavaScript, `$lookup` atravessa coleções, um
  `$regex` mal construído derruba o banco. O que passa é campo declarado no schema, sete
  operadores, `and`/`or` com teto de profundidade **e de nós** (mil irmãos têm
  profundidade 1 e derrubam igual), ordenação por campo conhecido e limite do servidor;
- **o prefixo `value.` é do servidor**: um campo chamado `ownerId` no schema vira
  `value.ownerId` e nunca alcança a raiz do documento, onde moram escopo e identidade;
- **precedência**: `deny` vence sempre; direto > setor > andar > prédio; sem grant, sem
  acesso. A hierarquia é lida na hora — tirar o agente do setor tira o acesso na próxima
  execução, sem limpar grant nenhum;
- **mutabilidade é do dataset e independe de grant**: `append_only` recusa update/delete
  mesmo para quem administra a conta, porque alterar o passado de uma série não é uma
  questão de permissão;
- **a permissão é reconferida imediatamente antes de cada leitura** da ferramenta, e não
  ao montar a lista: entre montar e o modelo chamar cabe uma revogação;
- **credencial não entra na config do adapter** — qualquer chave com cara de segredo é
  recusada na escrita, porque a config viaja para a tela e para o catálogo;
- `DATABASES_ENABLED=0` **nega a rota**.

Testes: 30 em `backend/test/databases.integration.test.mjs` — DSL (campo, operador,
operador de Mongo como valor, bomba por profundidade e por contagem, escape do
`contains`, tetos), schema, precedência completa com deny, membership que muda o acesso,
dataset restrito, store pausado, mutabilidade, consulta real sem cópia, isolamento entre
contas com o MESMO recorder, telemetria sem conteúdo, ferramentas do agente (sem grant não
existem; revogação bloqueia a próxima chamada; o motivo do filtro recusado volta), rotas e
flag. **Teeth**: revertendo a precedência do deny e a lista de campos da DSL, caem 3.

Suíte: 1354 + 1670, verde. Vitest 287, smoke 6.

### Fase 3 (continuação) — catálogo e UI ✅

- `resources/adapters/databaseAdapter.ts` registrado: Database entra no catálogo comum,
  na matriz do agente e na análise de impacto, delegando a decisão para
  `databases/access.ts`. `availableKinds()` agora devolve os quatro tipos.
- `pages/Databases.tsx` (`/databases`) + `lib/databases.ts`: lista com a ORIGEM dita em
  voz alta (mercado não é memória nem conhecimento), detalhe com datasets e mutabilidade,
  criação de dataset por `campo:tipo` (JSON cru na tela é pedir para errar), e consulta
  mostrando "quantos vieram de quantos existem" — a diferença muda a conclusão de quem lê.
- Item **Databases** na navegação, em RECURSOS. `/historicos` permanece: ele é a REGRA de
  gravação e Databases é o recurso que a expõe; mover a rota agora quebraria bookmark por
  uma reorganização que ainda não terminou.

Testes: 7 em `frontend/e2e/databases.spec.ts`. E2E 628, smoke 6, secret-scan limpo.

## Pendências honestas da Fase 3

- `external_app` está declarado e recusa consulta com `not_implemented` — um adapter que
  respondesse vazio seria pior que a recusa honesta.
- Tela de **grants de database** não foi feita: a API existe (`PUT/DELETE
  /api/databases/:id/grants`) e é testada, mas quem quiser conceder hoje precisa chamá-la.
  A tela precisa mostrar o impacto de um grant de setor ANTES de salvar, e isso é o
  próximo item, não um detalhe visual.
- Migração 9.2 (Data Store padrão apontando para recorders existentes, em dual-read) não
  começou.

## Próxima ação exata

1. Tela de grants de Database, com o impacto de setor mostrado antes de salvar.
2. Migração 9.2 em dual-read, sem mover registro.
3. Fase 4 — Tool versionada: `runtimeKind` (`http` preservando IDs e `customToolIds`,
   `app_action`, `registered_function`), versões imutáveis com hash, e o dispatcher único.

Fases 4 a 11 (Tools versionadas, Flows/Monitors, Activity, Extensions, Marketplace,
Sandbox, hardening) **não foram iniciadas**.
