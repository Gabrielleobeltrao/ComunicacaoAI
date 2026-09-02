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

## Próxima ação exata

Fase 2: navegação única (OFFICE/RESOURCES/OPERATIONS/COMMUNITY), tela global de Resources,
seção contextual em andar/setor e a matriz **Access** na página do agente consumindo
`GET /api/agents/:id/resource-access`. Preservar rotas antigas com redirect e cobrir
320/360/390/768/1440.
