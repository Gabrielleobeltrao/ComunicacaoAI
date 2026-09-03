# Arquiteto Central e Office Blueprint V2 — progresso

Branch: `feat/office-blueprint-v2`, a partir de `development` em `7215e21`.

Este arquivo registra o que foi **feito e provado**, não o que foi planejado. Uma fase só é
marcada como concluída quando os testes dela passam e o caminho essencial existe de verdade.

---

## Fase 0 — caracterização e ADRs ✅

Nenhuma mudança funcional. O que esta fase entrega é a fotografia do defeito, para que a
correção seja visível no diff: sem ela, um conserto e uma regressão têm a mesma aparência.

### As 13 lacunas, verificadas no código

| # | Lacuna | Onde ela está | Como foi travada |
| --- | --- | --- | --- |
| 1 | Blueprint V1 não representa Databases, Sources, Live, Monitors, Flows, canais, entregas nem grants | `architect/types.ts` — `OfficeBlueprintV1` tem 6 listas | teste afirma quais campos existem e quais **não** existem |
| 2 | `liveDataNeeds` nunca é compilado | existe em `brief.ts`, ausente em `compile.ts` | teste prova que a necessidade não vira nem recurso nem pendência |
| 3 | Só 4 tipos reaproveitáveis | `links.ts:17` — `KINDS = ['floor','agent','sector','routine']` | teste lê a lista do fonte e afirma os 6 tipos ausentes |
| 4 | Um andar genérico, sempre `create` | `compile.ts:101` — `floorKey = 'operacao'` | teste com três áreas prova que sai **um** andar |
| 5 | `actionKeys: []` em todo requisito de App | `compile.ts:160` e `:226` | teste afirma a lista vazia em todos os requisitos |
| 6 | Canal conectado ganha do canal pedido | `compile.ts:216-219` | teste pede WhatsApp e recebe `web_chat` |
| 7 | Declarar App de canal não cria vínculo operacional | `apply.ts` não tem passo de canal | teste lista os 7 passos existentes e prova a ausência do oitavo |
| 8 | Revisão não atualiza a topologia | `apply.ts:266-278` — `update` só toca nome/cor/instrução/contratos | teste afirma o que o patch mexe e o que ele não mexe |
| 9 | Condição de dado vira cron | `compile.ts` — rotina nasce `schedule` com `0 8 * * *` | teste do RSI prova o cron inventado e a ausência de monitor |
| 10 | Simulação é estrutural | `simulate.ts` não importa domínio canônico nenhum | teste prova que nenhum subsistema é alcançado |
| 11 | Validador aceita agente sem responsabilidade | `validate.ts` | teste remove `role`/`objective`/contratos e não há erro bloqueante |
| 12 | "Montar operação" escondido no seletor de andares | `BuildingSwitcher.tsx:134`, `MobileFloorPicker.tsx:159` | E2E prova que não há chat global em `/`, `/monitoring` nem `/agents` |
| 13 | Exclusão de andar sem impacto | `floors.ts:258` — conta só agentes e setores | integração prova que andar com Source/Monitor/Flow é apagado como "vazio" |

### Testes desta fase

| Arquivo | Casos | Resultado |
| --- | --- | --- |
| `backend/test/architectV2Characterization.test.mjs` | 11 | 11 passam |
| `backend/test/architectV2FloorImpact.integration.test.mjs` | 4 | 4 passam |
| `frontend/e2e/architect-v2-characterization.spec.ts` | 2 | 2 passam |

O caso mais grave está em `architectV2FloorImpact`: um andar com fonte de monitoramento,
monitor e Flow é considerado **vazio** e apagado, deixando os três órfãos apontando para um
andar que não existe mais.

### ADRs

Registrados em `docs/adr/` nesta fase:

- **ADR 001 — roteamento de intenção**: quatro modos com saída estruturada; a LLM classifica
  e descreve, o código decide e executa. Texto do modelo nunca é comando e nunca escolhe id.
- **ADR 002 — Blueprint V2 versionado**: `version: 2` ao lado do V1, sem reinterpretar o V1.
  Leitores aceitam os dois; conversor preserva `key` e `resourceMap`.
- **ADR 003 — inventário e grafo**: `OfficeInventory` completo para o código determinístico,
  `OfficeInventorySummary` para o modelo; o `DependencyGraph` serve a impacto e ordem, e
  **não** decide autorização — cada adapter continua decidindo.
- **ADR 004 — exclusão de andar**: arquivar é o padrão; purge é separado, exige `impactHash`
  e nome digitado; recurso compartilhado é preservado e apenas desvinculado.

### Pendências reais ao fim da fase

- Nenhuma. A fase 0 não muda comportamento, e é isso que ela promete.
