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

### Compilador, camadas e crítico LLM — 7.13 e 7.14 (`790fa39`, `921aaf3`)

- `backend/src/architect/compile.ts`: o Blueprint deixa de vir da LLM. O `blueprintPatch`
  do modelo continua importando como SINAL de "já dá para propor", mas o conteúdo é
  descartado: o desenho é derivado do Brief pelo classificador e pelas regras. Mesmo
  Brief, mesmo catálogo, mesmo desenho — inclusive as chaves, que saem do id do trabalho.
  Os nomes são de pessoa e escolhidos por POSIÇÃO numa lista fixa, nunca sorteados.
  Chave estável não é preciosismo: é o que liga a proposta ao recurso já aplicado. Se
  `marina` virasse `agent-2` na revisão seguinte, o diff diria que um agente sumiu e
  outro nasceu — e a aplicação criaria um segundo escritório ao lado do que roda.
- Camadas: o projeto guarda o PLANO INTEIRO em `blueprint` e a camada escolhida em
  `layer`. O que a pessoa lê, o que o hash carimba, o que o crítico avalia, o que o
  ensaio percorre e o que a aplicação escreve é sempre o RECORTE (`selectLayer`). Trocar
  de camada muda o hash e derruba para rascunho — uma confirmação em voo com o hash
  antigo é recusada, e uma tela mostrando "Essencial" nunca aplica o "Completo".
- O recorte fecha as dependências: setor que perdeu membros a ponto de sobrar um deixa
  de existir, rotina sem dono não entra, e quem sobrou sozinho não continua coordenando
  o vazio. As regras de TAMANHO só valem quando algo foi cortado — sem essa distinção, o
  recorte reescreveria projeto legado, que não tem camada em item nenhum.
- `backend/src/architect/criticLlm.ts`: a leitura auxiliar do modelo roda depois da
  compilação, uma vez por revisão, cacheada por hash no projeto. Produz finding, nunca
  patch; nunca declara erro; e prazo, falha do provedor ou resposta ilegível não quebram
  a proposta — o pior caso é a proposta sem a segunda leitura. Leitura de outra revisão é
  descartada, e a tela diz que foi, em vez de apontar problema em agente que não existe.
  O prazo é injetável (`ask`) porque garantia que ninguém consegue exercitar é frase.
- Corrigir o Brief refaz o desenho na hora, sem inferência (`recompilar`). Projeto cujo
  desenho veio do modelo NÃO é recompilado: as chaves seriam outras.
- Telas: `Brief.tsx` (os fatos, corrigíveis, com desfazer), `Layers.tsx` (os três
  recortes com a contagem de cada um) e `AgentCards.tsx` (a ficha: entrega, acionamento,
  o que NÃO faz, executor, contratos, ferramentas, handoff, por que é separado). O que
  não foi declarado aparece como "não declarado".

Defeitos que os testes pegaram neste bloco:

- rotina compilada nascia sem etapa, e rotina sem etapa é recusada pelo validador — a
  proposta compilava e não aplicava. O compilador passou a emitir a etapa `agent.execute`
  do dono, por `agentKey`, que a aplicação troca pelo id real;
- o recorte cortava setor de um membro e demovia gerente mesmo quando nada tinha sido
  cortado, o que reescrevia projeto legado sem ninguém ter pedido.

### Knowledge Brain — Fase 1 e API unificada (`45dae5c`)

- `backend/src/knowledge.ts`: `KnowledgeOwnerType` cobre `building | floor | sector |
  agent`. Mesmas coleções, mesmo chunking, mesmos embeddings, mesmo índice vetorial —
  quatro coleções separadas obrigariam a busca a consultar quatro lugares e o orçamento
  de trechos a ser dividido antes de saber o que existe. `ownerFilter` mantém o ramo
  legado só para o agente, que é o único escopo com passado.
- Campos curatoriais retrocompatíveis: `format`, `lifecycleStatus`, `authority`,
  `validFrom/validUntil`, `verifiedAt/verifiedBy`, `reviewIntervalDays`, `confidence` e
  `links`. Os defaults são aplicados na LEITURA (`withKnowledgeDefaults`), nunca por
  migração: reescrever a coleção mudaria o `updatedAt` de documentos que ninguém tocou.
  `confidence` não tem default e não vem do cliente — ela decide precedência entre
  documentos que se contradizem.
- `backend/src/knowledgeScope.ts`: os resolvers dono-a-dono. O `scopeId` do cliente é um
  pedido; quem decide é o getter que já filtra por conta. Id inválido, inexistente e de
  outra conta dão a MESMA recusa. O prédio nunca vem do cliente.
- `backend/src/knowledgeService.ts`: a camada compartilhada — validação, cota e
  serialização num lugar só. Era aqui que estava o buraco: o caminho do agente conferia
  a cota da conta e o do setor não, então dava para encher o disco escolhendo a porta. A
  cota vale também na EDIÇÃO, senão bastava entrar pequeno e crescer depois.
- `backend/src/routes/knowledgeRoutes.ts`: `/api/knowledge/documents` para os quatro
  escopos. As rotas por dono continuam existindo como ADAPTADORES da mesma camada —
  mesmo caminho, mesmo contrato. A rota do agente mantém o que sempre aceitou (sem teto
  de caracteres), porque impor o teto do setor agora recusaria em silêncio um texto que
  ontem entrava.
- `backend/src/abuseGuards.ts`: a cota soma os quatro donos. Faltava `buildings` — e um
  escopo de fora não daria um número menor, daria uma porta por onde encher o disco.
- `backend/src/architect/knowledge.ts`: conhecimento de andar e prédio vira documento
  indexado. Ia para a memória determinística por falta de dono, e o efeito era visível —
  o cardápio salvo no andar não era encontrado por busca semântica e não contava para a
  cota. A memória continua sendo o que sempre foi: fato acumulado por execução.
- `backend/src/knowledgeMigration.ts` + `src/scripts/migrateArchitectKnowledge.ts`: a
  cópia do que já está gravado. Idempotente pela marca `memory:<id>` e pelo índice único
  do banco; retomável porque cada item registra o próprio resultado em
  `knowledge_migrations`; não destrutiva — a memória original fica, e a confirmação vem
  de uma LEITURA do documento, não do retorno da escrita. Não roda no boot.
- `backend/src/floors.ts`: apagar um andar leva a base dele. Sem isso, documento e chunk
  ficariam apontando para um dono que não existe — invisíveis em qualquer tela, contados
  na cota para sempre, e ainda alcançáveis pela busca vetorial.

Defeitos e decisões deste bloco:

- rodar um arquivo de teste direto (`node --test`) carrega o `.env` do desenvolvedor e
  chama o provedor de embedding DE VERDADE. A suíte (`scripts/run-tests.mjs`) zera a
  chave; fora dela, um "erro" pode ser só a rede respondendo;
- o teto de 100 mil caracteres é da nota curada, não do upload: um PDF extraído passa
  disso com facilidade, e quem limita ali é a cota. Pela rota JSON o corpo grande nem
  chega ao validador — o parser do Express recusa antes;
- `ownersFilter` nasceu sem uso e foi removido: `countUnindexedFor` já montava o mesmo
  `$or`.

## O que falta, na ordem

### Knowledge Brain — próximo bloco (Fase 2)
1. `knowledgeAccess` no agente (`own`/`building`/`floor`/`sectorMode`), com agentes
   legados resolvendo para o comportamento atual até alguém salvar uma política.
2. `resolveKnowledgeOwnersForExecution` única, usada por chat, delegação, setor, rotina
   e playground — nenhum fluxo monta a própria lista de owners.
3. Busca híbrida combinando os quatro escopos dentro do mesmo orçamento global, com
   deduplicação entre escopos e proveniência por trecho.
4. Decidir e executar a remoção da memória original já copiada (a migração deste bloco
   deixou tudo de pé de propósito).

### Arquiteto (Fase 7)
1. Nada bloqueando: o núcleo (7.7 a 7.14) está fechado. O que sobra é acabamento —
   `successMetric` por agente ainda sai vazio na ficha, e o crítico auxiliar só é
   acionado na rodada de conversa (trocar de camada não dispara outra leitura, ela fica
   marcada como obsoleta até a próxima rodada).

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
- **Chave de item é derivada e estável.** Ela é o que liga proposta e recurso aplicado;
  renomear em silêncio duplica o escritório na revisão seguinte.
- **O hash carimba o que vai ser APLICADO.** Se ele fosse do plano inteiro, trocar de
  camada não mudaria o hash — e a confirmação feita sobre um recorte aplicaria outro.
- **Uma base, quatro donos.** O documento tem um dono canônico; a leitura de vários
  escopos é política de acesso, não uma segunda base.
- **Default na leitura, nunca migração silenciosa.** Um campo novo com default correto
  não justifica reescrever o que já está gravado.
- **A recusa é a mesma para não existe e não é seu.** Distinguir os dois conta que o id
  existe em algum lugar.
- **Migração confirma antes de marcar.** "Deu certo porque não lançou" é como uma falha
  silenciosa vira dado perdido.
- **O crítico do modelo não bloqueia e não edita.** Bloquear daria a um palpite a palavra
  final sobre aplicar; editar criaria um segundo arquiteto, e ninguém saberia qual dos
  dois propôs o que está sendo aprovado.
