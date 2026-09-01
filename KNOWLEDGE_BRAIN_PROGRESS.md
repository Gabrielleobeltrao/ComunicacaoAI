# Knowledge Brain + Architect Engine — estado da implementação

Documento de acompanhamento do `KNOWLEDGE_BRAIN_GOAL.md`. Ele existe para o trabalho
poder ser retomado sem reconstruir o raciocínio: o que já está pronto, o que foi
decidido e por quê, e o que falta com a ordem em que deve ser feito.

## Auditoria contra o commit-base

A especificação foi escrita sobre `cc10bbc76c8edc07ca8ca6d7862ee0449b18735f`
(2026-08-31). O repositório avançou cinco commits desde então, todos no Arquiteto:

| commit | o que mudou |
| --- | --- |
| `f50764b` | conserto determinístico do que o modelo entrega torto (reuse inexistente, delegação sem lista, etapa de rotina sem forma) |
| `3cd46b0` | área de trabalho com quatro telas, chat flutuante e prévia do escritório |
| `3570582` | prévia realmente somente-leitura (sem estado ao vivo, sem navegação), acessibilidade do mapa |
| `935c7b2` | varredura de 320 px nas quatro telas |
| `8fa6b24` | npm fora da imagem de produção, base do nginx atualizada |

Nada disso conflita com a especificação. Três itens dela já estavam atendidos por
esses commits:

- **7.13** (chat que abre/fecha sem prender a proposta numa coluna estreita) — feito;
- **prévia do escritório atualizada e sem efeitos colaterais** — feito, com o mesmo
  `OfficeFloor` da página inicial em modo somente-leitura;
- **critério 14** (320 px sem overflow) — coberto por teste nas quatro telas.

## Fases concluídas

### Fase 3 — Constituição e catálogo vivo (`5dcc8fe`)

- `backend/src/architect/constitution.ts`: catorze regras versionadas que entram
  inteiras no system prompt. Regra obrigatória recuperada por RAG é regra que às vezes
  não chega — o exemplo pode faltar, "não invente ferramenta" não pode.
- `backend/src/architect/capabilities.ts`: `ArchitectCapabilityManifest` montado a cada
  rodada a partir das fontes reais — presets, o mesmo `roleConfig` que o runtime
  consulta, registro de funções, catálogo de Apps com o `risk` que cada ação declara,
  ferramentas da conta e o que está conectado agora.
- `architectConstitutionVersion` gravada no projeto: uma decisão de ontem continua
  explicável depois de o texto mudar.
- Teste de deriva (`architectCapabilities.integration.test.mjs`, 6 casos) comparando o
  manifesto com cada fonte real.

### Fase 4 — OperationBrief (`18dd297`)

- `backend/src/architect/brief.ts`: o entendimento do negócio como artefato próprio,
  com patch campo a campo, tetos por lista e casamento de trabalho por id.
  `connected` nunca vem do modelo: quem responde é o servidor com o manifesto.
- `backend/src/architect/nextQuestion.ts`: lacunas detectadas por regra e ordenadas por
  impacto; no máximo duas por turno, e a fundacional vai sozinha.
- `PATCH /api/architect/projects/:id/brief` corrige "O que entendi" sem gastar
  inferência, com desfazer de uma versão.
- 13 casos puros + 4 de integração.

### Fase 5 — Classificador de recurso (`9d3559f`)

- `backend/src/architect/classify.ts`: decide agente, função, ferramenta ou rotina para
  cada trabalho, na ordem do custo, com a alternativa recusada registrada.
- 13 casos puros, incluindo o restaurante da especificação que vira **um** agente com
  ferramenta, função e rotina — não quatro agentes.

### Núcleo arquitetural — 7.7 a 7.12

- `backend/src/architect/responsibility.ts`: a ficha de cada agente e a função como
  CONTRATO. Gerente sem equipe, pesquisador sem fonte, analista sem entrada, operador
  sem ferramenta, monitor sem gatilho e `custom` sem justificativa são recusados. O
  perfil é conferido contra o catálogo real — um preset inventado vira agente sem papel.
- `backend/src/architect/executorContract.ts`: `function` exige nome do registro e
  schemas; `tool` exige App e ação que existam; e não há queda silenciosa para LLM —
  cálculo entregue a modelo de linguagem é erro, não fallback. Ação de risco alto sem
  aprovação vira aviso com o nome da ação.
- `backend/src/architect/architecture.ts`: os sete detectores (superagente, microagente,
  responsabilidade duplicada, limite vago, órfão, executor incompatível, permissão
  incompatível), o orçamento de complexidade e o `architectureScore` — seis leituras
  verificáveis, cada uma com os fatos que a formaram. Score não bloqueia nada e não se
  chama confiança: quem bloqueia é a validação. `mergeSplitRationale` responde "por que
  estes dois não foram juntados?" sem depender da memória de quem revisou.
- `backend/src/architect/critic.ts`: junta as três camadas determinísticas, ordena erro
  antes de aviso, e normaliza os achados do crítico LLM — que produz FINDING, nunca
  patch, e nunca erro. Um crítico que edita o desenho é um segundo arquiteto.
- `backend/src/architect/simulate.ts`: de 3 a 8 cenários derivados do Brief (ou do
  desenho, nos projetos sem Brief), percorridos sem efeito nenhum — as ferramentas são
  chamadas em dublê e a intenção fica registrada em `sideEffectsAvoided`. Rota esperada
  comparada com a observada pela RESPONSABILIDADE declarada, nunca pelo nome (os agentes
  têm nome de pessoa por desenho). Versionado no projeto para comparar revisões.
- `frontend/src/pages/architect/Critique.tsx`: os achados com o conserto ao lado, a
  leitura da operação com o fato de cada nota, o ensaio com o caminho e o aviso de que
  nada foi executado, e o motivo de cada agente existir.

Dois defeitos que os testes pegaram e que valem ser lembrados:

- o ensaio carimbava a hora dentro da prévia, e isso quebrava a garantia de que duas
  leituras da mesma proposta são idênticas — é sobre a prévia que a confirmação carrega
  o hash. O carimbo ficou só no que é gravado;
- com Brief vazio saía um cenário só. Projetos anteriores ao Brief ficariam sem ensaio
  de verdade; agora os cenários saem do desenho quando não há trabalhos mapeados.

## O que falta, na ordem

### Arquiteto (Fase 7)
1. Camadas Essencial/Recomendado/Completo do mesmo plano (7.10, 7.13).
2. Compilador Brief → Blueprint ligado ao preview/diff/apply existente (7.14).
3. Telas: "O que entendi" corrigível na interface, cards de agente com responsabilidade
   e limites (a API já existe; falta a tela).
4. Crítico LLM acionado de verdade numa etapa própria (o contrato e o normalizador já
   existem; hoje só a camada determinística roda).

### Knowledge Brain (Fases 1–6)
8. `KnowledgeOwnerType` para os quatro escopos, migração idempotente e cota em todos
   (Fase 1).
9. API unificada `/api/knowledge/documents` com os endpoints antigos como adapters.
10. `knowledgeAccess` no agente e `resolveKnowledgeOwnersForExecution` única (Fase 2).
11. `ContextRequirement` no Planner e `ContextManifest` por execução (3.1, 3.2).
12. Fontes internas, lacunas, propostas, validade, autoridade e conflitos (3.3–3.7).
13. Links Markdown, expansão controlada pelo grafo e endpoint do grafo (3.8, Fase 4).
14. Análise de impacto (3.9) e evals do Context Engine (3.10).
15. `KnowledgeMap`, inspector e editor no frontend (Fase 5) e integração ao `FloorView`
    com `?view=office|knowledge` (Fase 6).

## Decisões que valem ser preservadas

- **Constituição no prompt, exemplos por recuperação.** Regra obrigatória não pode
  depender de busca.
- **Manifesto derivado, nunca escrito.** Uma lista escrita envelhece sozinha e passa a
  oferecer o que foi removido.
- **O servidor escolhe a pergunta; o modelo redige.** Deixar o modelo escolher produzia
  pergunta já respondida e pergunta técnica que ele deveria deduzir.
- **Resolução errada é pior que nenhuma.** Um recurso apontado por semelhança vaga vira
  proposta aprovada sobre algo que não serve. Sem casamento exato, é pendência.
- **`connected`, `risk` e capacidades vêm da fonte real.** Toda cópia dessas verdades
  diverge na primeira mudança.
