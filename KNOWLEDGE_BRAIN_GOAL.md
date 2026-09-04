# /goal — Knowledge Brain + Architect Engine para Montar Operação

## Contexto do projeto analisado

Implementar este objetivo no repositório `Gabrielleobeltrao/ComunicacaoAI`, tomando como base o estado atual do código e preservando tudo que já funciona.

Base analisada:

- commit: `cc10bbc76c8edc07ca8ca6d7862ee0449b18735f`
- data do commit: `2026-08-31 20:35:44 -0400`
- frontend: React 19 + TypeScript + Vite
- backend: Express 5 + TypeScript + MongoDB
- RAG existente: `knowledge_documents`, `knowledge_chunks`, Voyage embeddings e Atlas Vector Search
- escopos indexados existentes: `agent` e `sector`
- memórias determinísticas existentes: `agent`, `sector`, `floor` e `building`
- mapa atual do andar: `FloorView` → `OfficeFloor` → `OfficeMap`
- conhecimento de setor atual: `SectorKnowledge`
- retratos atuais dos agentes: `buildCharacterResolver(...).portrait`

Não criar um produto paralelo nem substituir o RAG existente. Evoluir a base atual para formar um cérebro hierárquico e adicionar uma segunda visualização ao mesmo andar.

Este mesmo objetivo também deve reformular o módulo `Montar operação`. O Arquiteto precisa usar as funções e executores reais do sistema para criar escritórios menores, coerentes e verificáveis, evitando tanto o “agente que faz tudo” quanto dezenas de agentes sem responsabilidade concreta.

---

## Objetivo do produto

O sistema deve oferecer dois “raios-X” do mesmo escritório:

1. **Visão do escritório:** quem está trabalhando e onde.
2. **Mapa de conhecimento:** o que os agentes sabem, a qual escopo cada conhecimento pertence e quais agentes conseguem acessá-lo.

O mapa é o painel de controle, não o produto inteiro. O valor principal deve acontecer no runtime: Planner, Context Engine e RAG precisam usar essa estrutura para decidir que conhecimento entra em cada chamada de LLM, registrar por que entrou e detectar quando faltou informação confiável.

Na página atual do andar, adicionar um seletor:

`[ Escritório ] [ Conhecimento ]`

- **Escritório** mantém exatamente o mapa atual.
- **Conhecimento** troca somente a área central pelo `KnowledgeMap` do andar.
- A escolha deve ficar refletida na URL, por exemplo `?view=office` e `?view=knowledge`, para permitir compartilhar/reabrir a visão.
- Deve existir a ação **Expandir mapa**, usando a largura útil inteira ou fullscreen, sem criar uma experiência desconectada do andar.

---

## Decisões visuais já fechadas

Não reinterpretar estas decisões:

- Nós devem ser compactos, circulares e personalizados, sem cards enormes dentro do grafo.
- **Setor:** círculo com a cor real do setor e a primeira letra do nome centralizada. Essa inicial funciona como o ícone do setor; não criar agora um novo sistema de upload de ícone.
- **Agente:** círculo com o retrato que o sistema já utiliza. Reusar `buildCharacterResolver(ids).portrait(agentId)` para manter a mesma pessoa em todas as telas. Não criar outro avatar e não usar a cor do agente nas conexões.
- **Documento:** círculo neutro com ícone pequeno de documento/Markdown e indicação discreta do estado de indexação.
- **Prédio/Global:** círculo com ícone de prédio/cérebro em cor neutra da marca.
- **Andar:** círculo com ícone de andar e a cor configurada do andar quando existir.
- Linhas/conexões devem ser neutras, usando os tokens de borda/texto do design system. Não colorir a linha com a cor do agente.
- A cor do setor pode aparecer somente no próprio nó, em pequenos badges de escopo e no destaque de seleção.
- Nó selecionado ganha contorno/destaque; os nós diretamente relacionados permanecem fortes e o restante reduz opacidade.
- Rótulos devem aparecer sem poluir: nome curto abaixo do nó, truncado; nome completo em tooltip e no painel lateral.
- Respeitar os tokens atuais de cor, espaçamento, raio, elevação e motion. Evitar hex novo quando já houver token equivalente.

---

## Arquitetura conceitual obrigatória

Manter três conceitos separados:

- **Knowledge:** informação relativamente permanente e curada; usa documentos, chunks, embeddings e busca híbrida.
- **Memory:** fatos/contexto acumulado pelas execuções; continua no subsistema atual de memória.
- **Live Data:** estado atual vindo de APIs, apps e históricos; continua fora da base curada.

O primeiro release do mapa deve representar conhecimento curado e sua estrutura. Não transformar memórias ou dados ao vivo em documentos apenas para fazê-los aparecer no grafo. Preparar tipos extensíveis para exibi-los futuramente como camadas opcionais, mas não misturar os mecanismos de armazenamento.

Hierarquia de conhecimento desejada:

`Prédio/Global → Andar → Setor → Agente → Documento`

Um documento possui um único dono canônico (`building`, `floor`, `sector` ou `agent`). Os agentes podem ler vários escopos por meio de uma política de acesso resolvida no servidor.

---

## Fase 1 — Generalizar a base de conhecimento existente

### Backend e modelo

1. Estender `KnowledgeOwnerType` em `backend/src/knowledge.ts` de:

   `agent | sector`

   para:

   `building | floor | sector | agent`

2. Continuar usando as mesmas coleções `knowledge_documents` e `knowledge_chunks`, o mesmo índice vetorial e as mesmas funções de chunking/indexação. Não criar quatro bases ou quatro coleções separadas.

3. Preservar a compatibilidade com documentos legados que possuem apenas `agentId` e com o backfill atual.

4. Generalizar `ownerFilter`, filtros vetoriais/lexicais, contagem, exclusão, reindexação e índices para os quatro tipos.

5. Todo documento novo deve carregar, no mínimo:

   - `ownerType`
   - `ownerId`
   - `title`
   - `content`
   - `format: "markdown"`
   - `source`
   - `sourceRef`
   - `authorId`
   - `indexStatus`
   - `indexError`
   - `chunkCount`
   - `createdAt`
   - `updatedAt`
   - `links` resolvidos, quando houver
   - `lifecycleStatus: "draft" | "approved" | "archived"`
   - `authority: "official_policy" | "procedure" | "reference" | "note"`
   - `validFrom` e `validUntil`, quando aplicável
   - `verifiedAt`, `verifiedBy` e `reviewIntervalDays`, quando aplicável
   - `confidence`, somente quando vier de um processo verificável; nunca inventada pela UI

6. Criar resolvers owner-scoped para prédio, andar, setor e agente. Nunca aceitar um `ownerId` bruto do cliente sem confirmar que o recurso pertence a `res.locals.userId`.

7. Aplicar a mesma cota de armazenamento usada no conhecimento do agente a todos os escopos. Hoje o fluxo do setor não deve continuar como exceção sem verificação de cota.

8. Atualizar a integração do Arquiteto: conhecimento de `floor` e `building` deve passar a ser documento indexado na base canônica, e não memória determinística. Criar migração segura para itens `sourceType: architect` existentes nesses escopos, sem apagar a memória original antes da confirmação da cópia.

9. Não executar migração destrutiva no boot. Criar migração idempotente, testável e retomável.

### API unificada

Criar uma camada de rotas reutilizável, mantendo os endpoints antigos funcionando como adapters durante a transição.

Endpoints sugeridos:

- `GET /api/knowledge/documents?scopeType=&scopeId=&q=&status=&limit=&skip=`
- `POST /api/knowledge/documents`
- `GET /api/knowledge/documents/:documentId`
- `PATCH /api/knowledge/documents/:documentId`
- `DELETE /api/knowledge/documents/:documentId`
- `POST /api/knowledge/documents/:documentId/reindex`
- `POST /api/knowledge/documents/upload`

O servidor deve derivar e validar o dono real. Respostas de listagem não devem carregar o conteúdo integral de todos os documentos.

---

## Fase 2 — Política de acesso e Context Engine

Adicionar ao agente uma configuração explícita e versionável, por exemplo:

```ts
knowledgeAccess: {
  own: boolean
  building: boolean
  floor: boolean
  sectorMode: 'execution_context' | 'home_sector' | 'selected' | 'none'
  selectedSectorIds: ObjectId[]
}
```

Regras:

- `own` controla a base própria do agente.
- `building` permite o Brain Global do prédio real do agente.
- `floor` permite o conhecimento do andar real do agente.
- `execution_context` mantém o comportamento seguro atual: setor entra somente quando a execução foi iniciada em um setor validado.
- `home_sector` inclui o setor em que o agente é membro.
- `selected` inclui somente setores explicitamente autorizados e owner-scoped.
- Nenhuma política pode atravessar conta/prédio por ID enviado pelo cliente.
- Preservar agentes legados: ausência da configuração deve resolver para o comportamento atual (`own: true`, `building: false`, `floor: false`, `sectorMode: execution_context`) até o usuário salvar uma política. Assim a implantação não muda silenciosamente respostas existentes.
- Para agentes novos, apresentar na interface uma configuração recomendada, mas gravá-la explicitamente no momento da criação; não esconder uma mudança de comportamento em defaults apenas de frontend.

Criar uma única função no backend, algo como `resolveKnowledgeOwnersForExecution`, usada por chat, delegação, setor, rotina e playground. Nenhum fluxo deve montar sua própria lista de owners.

O resultado da busca continua respeitando:

- top-K global;
- orçamento de caracteres global;
- relevância mínima;
- deduplicação entre escopos;
- fallback lexical;
- distinção entre `empty`, `no_base` e `unavailable`;
- proveniência de cada trecho.

Atualizar os eventos de RAG/execution trace para registrar `ownerType`, `ownerId`, `documentId` e título seguro dos trechos realmente selecionados. Nunca registrar conteúdo completo, prompts ou credenciais.

Adicionar uma seção “Acesso ao conhecimento” na configuração do agente, próxima das fontes/conhecimento, mostrando em linguagem clara o que ele pode ler.

---

## Fase 3 — Inteligência operacional do Knowledge Brain

Esta fase é obrigatória. O Knowledge Brain não pode ser entregue apenas como organização visual.

### 3.1 Planner declarando requisitos de contexto

Estender o plano de execução para declarar explicitamente o que cada tarefa precisa consultar, sem colocar conteúdo integral dentro do plano.

Contrato sugerido:

```ts
type KnowledgeRequirement = {
  scope: 'building' | 'floor' | 'sector' | 'agent'
  targetId?: string
  reason: string
  required: boolean
  query?: string
  tags?: string[]
  freshness?: { maxAgeMinutes?: number; mustBeCurrentlyValid?: boolean }
}

type ContextRequirement = {
  knowledge: KnowledgeRequirement[]
  liveData: { sourceKey: string; reason: string; required: boolean }[]
  historicalData: { recorderKey: string; period?: string; reason: string; required: boolean }[]
}
```

Regras:

- O Planner escolhe necessidades sem receber ou reproduzir documentos inteiros.
- IDs e fontes propostos pelo modelo são tratados como pedidos não confiáveis e resolvidos pelo servidor contra o catálogo owner-scoped.
- O servidor pode restringir/ampliar o plano conforme permissões e políticas; o modelo nunca concede acesso.
- Tarefas simples podem usar requisitos derivados deterministicamente, evitando uma chamada extra de LLM apenas para roteamento.
- O plano final validado acompanha a execução para que chat, delegação, setor, rotina e agentes de função/código usem o mesmo contrato.
- `knowledge`, `liveData` e `historicalData` permanecem caminhos diferentes; o Planner apenas coordena os requisitos.

### 3.2 Context Manifest por execução

Cada execução deve produzir e persistir um manifesto seguro explicando o contexto realmente usado:

```ts
type ContextManifest = {
  executionId: string
  requested: ContextRequirement
  knowledge: {
    documentId: string
    ownerType: 'building' | 'floor' | 'sector' | 'agent'
    ownerId: string
    title: string
    chunkIds: string[]
    topScore: number | null
    selectedChars: number
    authority: string
    validAtExecution: boolean | null
  }[]
  liveData: { sourceKey: string; status: 'used' | 'missing' | 'failed' | 'denied'; capturedAt?: string }[]
  historicalData: { recorderKey: string; status: 'used' | 'missing' | 'failed' | 'denied'; period?: string }[]
  ignored: { kind: string; ref: string; reason: string }[]
  coverage: { required: number; satisfied: number; missing: number; score: number }
  groundingStatus: 'ok' | 'partial' | 'conflict' | 'empty' | 'no_base' | 'unavailable' | 'denied'
  createdAt: string
}
```

- Manifesto guarda IDs, títulos seguros, status, contagens, timestamps e scores; nunca o prompt completo, chunks integrais, credenciais ou payloads sensíveis.
- `coverage.score` mede cobertura dos requisitos declarados, não “confiança da IA”.
- A tela da execução mostra `Usado`, `Ignorado` e `Ausente`, com motivo real.
- No Knowledge Map, a ação “Mostrar contexto desta execução” destaca somente os nós usados.
- Se um requisito obrigatório falhar e o agente exigir grounding, a execução deve recusar/pausar de forma explícita em vez de improvisar.

### 3.3 Fontes internas e proveniência da resposta

- O resultado da execução deve carregar referências internas aos documentos/fontes selecionados.
- A UI pode mostrar uma seção `Baseado em`, com título, escopo, última verificação e momento de captura para dados ao vivo.
- Não inserir citações falsas no texto. A referência vem do `ContextManifest`, não de o modelo declarar de memória o que utilizou.
- Diferenciar `acessível por` (permissão potencial) de `usado por` (evidência em manifestos reais).
- Execuções antigas sem manifesto devem aparecer como “sem telemetria desta versão”, nunca como zero fontes usadas.

### 3.4 Detecção e gestão de lacunas

Criar eventos agregáveis de lacuna quando:

- requisito obrigatório não encontra base;
- retrieval retorna `empty`, `no_base` ou `unavailable`;
- cobertura fica parcial;
- usuário pergunta repetidamente algo sem fonte confiável;
- agente solicita esclarecimento por falta de conhecimento.

Modelo sugerido: `knowledge_gaps`, contendo escopo, fingerprint normalizado do assunto, exemplos seguros/redigidos, contagem, primeira/última ocorrência, agentes afetados, status (`open`, `dismissed`, `resolved`) e documento que resolveu.

Interface:

- seção `Lacunas` no Knowledge Brain;
- ordenar por frequência/impacto;
- ação `Adicionar conhecimento` já abre o editor no escopo sugerido;
- vincular o novo documento à lacuna e confirmar resolução apenas depois de uma busca/eval passar;
- não guardar mensagens integrais com dados pessoais apenas para formar exemplos.

### 3.5 Propostas de conhecimento feitas por agentes

Agentes podem propor conhecimento, mas não gravá-lo diretamente como aprovado.

Criar `knowledge_proposals` com:

- autor/agente e execução de origem;
- escopo sugerido;
- título e conteúdo proposto;
- evidências (`documentId`, fonte ao vivo, run ou dado histórico permitido);
- confidence derivada do processo, quando existir;
- status `pending | approved | rejected | needs_review`;
- resultados de deduplicação, conflito e validação;
- revisor e timestamps.

Fluxo obrigatório:

`Agente propõe → valida evidências → detecta duplicidade/conflito → revisão humana → documento aprovado → indexação`

- Aprovar cria/atualiza documento por uma ação explícita e auditada.
- Rejeitar não apaga a auditoria.
- Sem evidência suficiente, marcar `needs_review`; não promover automaticamente.
- Impedir loops em que texto gerado por IA vira evidência de outra proposta sem fonte independente.

### 3.6 Validade, revisão e conteúdo vencido

- Documentos podem definir validade e periodicidade de revisão.
- Um job determinístico marca itens `due_for_review` e `expired`; não usa LLM para comparar datas.
- Retrieval exclui documentos arquivados e, por padrão, documentos vencidos para perguntas sobre estado atual.
- Se um conteúdo vencido for a única evidência histórica, pode aparecer explicitamente como histórico, com data, nunca como fato atual.
- A interface mostra responsável, última verificação, próxima revisão e validade.
- Criar filtros e alertas para `vence em breve`, `revisão pendente` e `vencido`.
- Fontes web ou Live Data não ganham validade permanente por terem sido capturadas uma vez; respeitar `capturedAt`, TTL e política de atualização existentes.

### 3.7 Conflitos e regras de autoridade

Detectar conflitos entre documentos relacionados que apresentem regras/valores incompatíveis. Pode usar heurística determinística primeiro e LLM como auxiliar sinalizador, nunca como autoridade final.

Precedência padrão, sempre visível e configurável no futuro:

1. `approved` supera `draft/proposal`;
2. `official_policy` supera `procedure`, `reference` e `note`;
3. entre itens de mesma autoridade, o escopo mais específico pode complementar o geral, mas não revogar política superior silenciosamente;
4. entre itens equivalentes, ganha o mais recentemente verificado, não simplesmente o mais recentemente editado;
5. conflito ainda não resolvido gera `groundingStatus: conflict` e pode bloquear execução que exige grounding.

Criar estado/coleção de conflitos com documentos envolvidos, campo/assunto, detecção, status, decisão humana e justificativa auditável.

Nunca mandar dois trechos conflitantes para a LLM e esperar que ela escolha sem informar o conflito.

### 3.8 Retrieval com expansão controlada pelo grafo

Adicionar uma etapa opcional de expansão por conexões explícitas:

1. busca híbrida atual encontra os seeds;
2. expandir no máximo um salto por `KnowledgeDocument.links`;
3. filtrar novamente por acesso, validade e autoridade;
4. reranquear seeds + vizinhos;
5. aplicar o mesmo top-K e orçamento global de caracteres.

- Relação no grafo não é relevância suficiente por si só.
- Definir limites de vizinhos, salto, tempo e caracteres.
- Registrar no manifesto se um chunk entrou por busca direta ou expansão de grafo.
- Manter feature flag/configuração de rollback até os evals comprovarem ganho.
- Não usar expansão para atravessar escopos que o agente não pode acessar.

### 3.9 Análise de impacto

Antes de editar, arquivar ou excluir conhecimento, oferecer `Analisar impacto`:

- agentes que **podem acessar** o documento;
- agentes/execuções que **realmente o usaram** nos manifestos;
- lacunas que ele resolveu;
- propostas/documentos relacionados;
- rotinas/canais afetados somente quando houver relação verificável;
- conflitos que podem reaparecer.

Criar endpoint, por exemplo:

- `GET /api/knowledge/documents/:documentId/impact`

Rótulos precisam distinguir potencial de evidência real. Não afirmar que uma rotina “usa” o documento apenas porque seu agente tem permissão.

Para exclusão com impacto material, mostrar confirmação contendo contagens verdadeiras. Preferir arquivar quando o documento tiver histórico de uso, preservando manifestos e auditoria.

### 3.10 Evals do Context Engine

Criar um conjunto pequeno e versionado de casos de avaliação por cenário genérico, cobrindo:

- escolheu os escopos corretos;
- recuperou a política correta;
- não vazou setor não autorizado;
- preferiu conteúdo aprovado/válido;
- sinalizou conflito;
- detectou lacuna;
- expansão do grafo ajudou sem ultrapassar o orçamento;
- resposta/execução preservou proveniência.

Registrar baseline de qualidade, latência, chunks e tokens antes/depois. A expansão do grafo e qualquer chamada extra do Planner só devem ser ativadas por padrão se os evals mostrarem benefício mensurável.

---

## Fase 4 — Links Markdown e dados do grafo

### Markdown

- Conteúdo manual é salvo como Markdown.
- O usuário comum pode editar em modo visual simples; deve existir um botão/aba **Editar Markdown** com editor bruto.
- Usar o renderer seguro já adotado pelo projeto (`react-markdown` e regras existentes de `MessageContent`) para a prévia.
- Suportar links internos no formato `[[Título do documento]]` e `[[Título|Rótulo]]`.
- Ao salvar, o backend resolve os links dentro dos escopos que o autor pode administrar e persiste referências por `documentId`, para que renomear um título não quebre uma conexão já resolvida.
- Links não resolvidos permanecem visíveis no editor como pendência, mas não criam edge apontando para recurso inventado.
- Evitar uma coleção separada de edges se `KnowledgeDocument.links[]` atender às consultas. Relações hierárquicas e de acesso devem ser calculadas, não duplicadas no banco.

### Layout persistido

O usuário pode arrastar nós. Persistir somente posições manuais numa coleção separada, por exemplo `knowledge_graph_layouts`, com:

- `ownerId` da conta;
- `viewKey` (`building:<id>`, `floor:<id>`, `agent:<id>` etc.);
- `nodeId` estável;
- `x`, `y`;
- `updatedAt`.

O layout não altera a propriedade nem o conteúdo do conhecimento. Nós sem posição salva recebem layout automático determinístico.

### Endpoint de grafo

Criar:

- `GET /api/knowledge/graph?floorId=&viewAs=&include=`
- `PUT /api/knowledge/graph/layout`

DTO mínimo:

```ts
type KnowledgeGraphNode = {
  id: string
  kind: 'building' | 'floor' | 'sector' | 'agent' | 'document'
  label: string
  ownerType?: 'building' | 'floor' | 'sector' | 'agent'
  ownerId?: string
  color?: string | null
  portraitKey?: string | null
  indexStatus?: 'indexed' | 'pending' | 'error'
  source?: string | null
  counts?: { connections: number; accessibleByAgents: number }
}

type KnowledgeGraphEdge = {
  id: string
  source: string
  target: string
  kind: 'contains' | 'references' | 'can_access'
}
```

Não enviar base64 de imagem no DTO. Para agentes, o frontend resolve o retrato com o mecanismo atual a partir do ID.

No modo normal do andar, retornar apenas prédio global, andar atual, setores do andar, agentes do andar e documentos alcançáveis nessa visão. O modo “ver como agente” deve remover do resultado o que aquele agente não pode acessar, e não apenas esconder por CSS.

---

## Fase 5 — Knowledge Map no frontend

### Dependência e componentes

Pode adicionar `@xyflow/react` para pan, zoom, drag, seleção e edges, criando nós circulares customizados. Não usar o card padrão retangular da biblioteca.

Estrutura sugerida:

- `frontend/src/knowledge/KnowledgeMap.tsx`
- `frontend/src/knowledge/KnowledgeNode.tsx`
- `frontend/src/knowledge/KnowledgeFilters.tsx`
- `frontend/src/knowledge/KnowledgeInspector.tsx`
- `frontend/src/knowledge/KnowledgeEditor.tsx`
- `frontend/src/knowledge/useKnowledgeGraph.ts`
- `frontend/src/lib/knowledge.ts`

Integrar ao `FloorView`; não misturar essa lógica dentro de `OfficeFloor`.

### Layout da tela

No topo da área:

- seletor `Escritório | Conhecimento`;
- busca;
- filtro “Ver como: andar inteiro / setor / agente”;
- botão “Adicionar conhecimento”;
- botão “Expandir mapa”.

Desktop:

- painel de filtros recolhível à esquerda;
- grafo no centro;
- inspector/drawer à direita somente quando um nó estiver selecionado.

Mobile:

- manter o grafo navegável com pan e zoom;
- filtros abrem em bottom sheet/drawer;
- inspector abre em bottom sheet;
- não manter três colunas apertadas;
- controles com área de toque mínima do design system;
- evitar conflito entre pan do grafo e scroll da página.

### Filtros

- escopo: Global, Andar, Setores, Agentes;
- tipo: documentos e, futuramente, outras camadas;
- status: indexado, indexando, erro;
- origem: manual, arquivo, web, Arquiteto, execução/conversa;
- busca por título;
- “Ver como agente”.

### Interações

- Clique em setor: destaca o cluster do setor.
- Clique em agente: destaca somente o que ele pode acessar; inspector mostra seus escopos.
- Clique em documento: abre inspector com título, escopo, origem, status, atualização, conexões e agentes que podem acessá-lo.
- O inspector diferencia claramente `Pode acessar` de `Usou em execuções`.
- Ação `Mostrar contexto de uma execução` aplica destaque temporário a partir do `ContextManifest`.
- Nós com lacuna, conflito, vencimento ou revisão pendente recebem indicadores discretos e acessíveis, sem substituir a cor de identidade do setor/agente.
- Ações do documento: `Abrir`, `Editar`, `Ver conexões`, `Histórico` (Histórico pode ficar desabilitado com rótulo “em breve” se versionamento ainda não existir; não simular dados).
- Duplo clique ou ação `Abrir` leva ao editor completo.
- Arrastar atualiza posição local imediatamente e persiste com debounce.
- Botão `Organizar automaticamente` apaga apenas as posições daquele `viewKey`, mediante confirmação, e recalcula o layout.

### Editor

- título;
- seletor de escopo e destino permitido;
- abas `Escrever` e `Prévia` no mobile;
- split Markdown/Preview no desktop quando houver espaço;
- indicador de salvamento/indexação;
- links relacionados;
- aviso acionável para erro de embedding com `Tentar novamente`.
- campos de autoridade, validade, responsável e revisão;
- painéis relacionados para conflitos, lacunas resolvidas e impacto;
- propostas ficam em uma fila de revisão separada e não aparecem como conhecimento aprovado.

Reutilizar a base dos editores/listas atuais. `SectorKnowledge` e o conhecimento do agente devem continuar acessíveis, mas passar a abrir o mesmo editor e a mesma API unificada, evitando duas implementações divergentes.

---

## Fase 6 — Navegação, acessibilidade e desempenho

- O switch do `FloorView` é o acesso principal ao mapa do andar.
- Adicionar uma entrada global “Conhecimento” na área de Controle somente se existir uma visão do prédio inteiro pronta; não adicionar link que leve apenas ao mesmo mapa incompleto.
- Preservar navegação V1/V2 e redirects existentes.
- Todos os nós devem ser focáveis por teclado, com nome e tipo anunciados.
- Edges são decorativos para leitor de tela; as conexões também aparecem como lista textual no inspector.
- Respeitar `prefers-reduced-motion`; não usar simulação física contínua.
- Layout automático determinístico e estático após calcular.
- Para grafos grandes, carregar por escopo e usar clusters recolhidos. Não renderizar milhares de documentos de uma vez.
- Definir limite inicial razoável e paginação/expansão por cluster; exibir contagem real e “Carregar mais”.
- Estados de loading, vazio, erro real e erro parcial devem ser distintos.
- Não representar falha de API como grafo vazio.
- Manifestos, lacunas e impacto devem ser paginados/agregados no servidor; não baixar todo o histórico para calcular no navegador.
- Limitar telemetria segura e definir retenção para manifestos/lacunas, preservando auditoria sem acumular conteúdo sensível indefinidamente.

---

## Fase 7 — Reformular “Montar operação” como Architect Engine

### Problema a resolver

O fluxo atual já possui prompt, blueprint, validação, preview, checklist, diff, aplicação e reconferência. Preservar essas peças, mas corrigir uma lacuna: uma proposta pode ser estruturalmente válida e ainda ser uma arquitetura ruim.

O novo Arquiteto deve detectar e evitar:

- um agente responsável por atendimento, marketing, finanças, estoque e relatórios ao mesmo tempo;
- agente criado para cada microetapa que deveria ser ferramenta ou função;
- agente com nome/cargo, mas sem responsabilidade, acionamento ou entrega claros;
- gerente sem equipe ou que executa o trabalho dos especialistas;
- pesquisador sem fonte;
- analista sem dados;
- operador sem função/ferramenta;
- comunicador sem canal ou público;
- monitor sem fonte, condição e gatilho;
- pipeline usado quando a ordem não importa;
- setor orquestrado criado apenas para agrupar visualmente;
- recursos e Apps que não existem no catálogo real;
- perguntas técnicas que o usuário não tem como responder;
- blueprint gigante criado antes de o sistema entender o negócio.

O fluxo obrigatório passa a ser:

`Entender o negócio → mapear trabalhos → classificar agente/função/ferramenta → desenhar operação mínima → criticar → simular → apresentar → aprovar → aplicar`

O Blueprint deixa de ser o primeiro artefato. Primeiro vem o `OperationBrief`; o Blueprint é compilado somente depois que o entendimento e a arquitetura passam pelas regras.

### 7.1 Constituição versionada do Arquiteto

Criar uma constituição curta, versionada e testável com regras que devem entrar diretamente no system prompt do Arquiteto. Não depender de RAG para regras obrigatórias.

Regras mínimas:

- começar pela menor operação capaz de entregar o resultado principal;
- agente não é sinônimo de etapa;
- criar agente apenas para uma responsabilidade estável que exija interpretação, decisão, comunicação ou autonomia própria;
- cálculo/transformação determinística deve usar executor `function`;
- ação em sistema externo deve usar executor `tool` ou App;
- LLM interpreta, decide, sintetiza ou se comunica; não deve fingir que executou cálculo/ação determinística;
- coordenador só existe quando há trabalho real para distribuir ou consolidar;
- pipeline só existe quando dependências e ordem importam;
- setor `organization` apenas agrupa; setor executável precisa de justificativa operacional;
- não inventar ferramenta, App, trigger, capability ou integração;
- informação ausente vira pergunta, suposição visível ou pendência; nunca fato inventado;
- separar núcleo obrigatório de expansão futura;
- nenhuma proposta é aplicada automaticamente sem revisão/aprovação já prevista pelo produto.

Manter `architectConstitutionVersion` em projetos/propostas para reproduzir decisões e migrar prompts com segurança.

### 7.2 Catálogo vivo das capacidades reais

Criar um `ArchitectCapabilityManifest` montado pelo servidor a partir das fontes reais do projeto, não de uma documentação manual duplicada.

Deve incluir:

- presets/funções de agente disponíveis;
- `roleConfig` resolvido pelo backend;
- `executorKinds: llm | function | tool`;
- contratos e requisitos de cada executor;
- activation modes/triggers suportados;
- modos de setor;
- Apps instalados e Apps disponíveis;
- ações reais de cada App;
- Custom Tools/funções cadastradas;
- fontes, memória e escopos de conhecimento disponíveis;
- canais conectados;
- políticas e limites relevantes;
- feature flags que mudam o que pode ser criado.

Regras:

- o backend é a fonte de verdade;
- o frontend e o prompt consomem o mesmo manifesto;
- enviar à LLM somente o subconjunto necessário para a etapa atual;
- IDs, ações e capabilities devolvidos pela LLM são validados novamente no servidor;
- uma capability retirada do sistema não pode continuar aparecendo porque estava escrita em exemplo antigo;
- adicionar teste de drift entre manifesto, `roleConfig`, catálogos de Apps, executores e opções exibidas na UI.

### 7.3 Documentação e exemplos recuperáveis

Além da constituição e do manifesto, criar documentação de apoio recuperável por cenário:

- princípios de arquitetura do escritório;
- guia agente × função de código × ferramenta/App × rotina × setor;
- exemplos bons por cenário genérico;
- contraexemplos explicando por que uma arquitetura é ruim;
- padrões de aprovação humana e permissões sensíveis;
- glossário traduzindo conceitos técnicos para linguagem comum.

Não injetar tudo em toda conversa. Recuperar exemplos conforme o setor/objetivo do `OperationBrief`, sempre mostrando ao modelo que exemplos inspiram, mas não autorizam capacidades inexistentes.

Incluir contraexemplos obrigatórios:

- superagente com vários domínios;
- agente por microetapa;
- gerente sozinho;
- função determinística executada por LLM;
- pesquisador sem evidência;
- operador com ação sensível sem aprovação;
- pipeline sem dependência real.

### 7.4 OperationBrief persistente

Criar um artefato intermediário separado do Blueprint:

```ts
type OperationBrief = {
  version: number
  projectId: string
  businessGoal: string
  users: { kind: string; needs: string[] }[]
  channels: string[]
  jobs: {
    id: string
    name: string
    trigger: string
    input: string
    decision: string
    action: string
    output: string
    frequency?: string
    risk?: 'low' | 'medium' | 'high'
    requiresHumanApproval?: boolean
  }[]
  integrations: { key?: string; need: string; connected: boolean | null }[]
  knowledgeNeeds: { scopeHint?: string; subject: string; required: boolean }[]
  liveDataNeeds: { source: string; freshness?: string; required: boolean }[]
  humanApprovals: { action: string; rule: string }[]
  successCriteria: string[]
  constraints: string[]
  knownFacts: { key: string; value: string; source: 'user' | 'system' }[]
  assumptions: { id: string; text: string; impact: string; status: 'open' | 'accepted' | 'rejected' }[]
  openQuestions: { id: string; question: string; why: string; impact: string; priority: number }[]
}
```

- Atualizar o Brief a cada resposta com patch estruturado validado.
- Guardar histórico de versões e permitir desfazer a última alteração.
- Não misturar descrição do negócio com IDs técnicos do Blueprint antes da resolução.
- Mostrar uma visão simples “O que entendi” que o usuário pode corrigir.
- Não repetir pergunta cuja resposta já está no Brief, no sistema ou em integração conectada.
- Permitir pausar e continuar depois sem perder decisões.

### 7.5 Entrevista adaptativa e simples

Substituir a sensação de questionário técnico por uma entrevista progressiva.

Regras:

- fazer no máximo uma ou duas perguntas por turno;
- perguntar somente quando a resposta muda arquitetura, permissão, risco, canal, integração ou entrega;
- priorizar a pergunta de maior impacto entre as pendências;
- não perguntar o que pode ser inspecionado no manifesto/conta;
- escrever em linguagem do negócio, nunca exigir que o usuário escolha `input schema`, `orchestration mode` ou `executorKind` sem explicação;
- oferecer 2–4 opções úteis e permitir resposta livre;
- incluir “Você pode decidir por mim” quando houver default seguro, registrando a suposição;
- explicar brevemente por que a pergunta importa;
- confirmar blocos de entendimento, não repetir toda a conversa;
- detectar contradição e perguntar qual informação substitui a anterior;
- permitir que o usuário diga “comece simples” ou “quero a estrutura completa”.

Exemplo correto:

`Quando um cliente mandar mensagem, o que o sistema deve conseguir concluir sozinho: responder dúvidas, consultar pedidos, alterar/cancelar pedidos ou também movimentar dinheiro?`

Evitar:

`Qual será o output schema do setor orquestrado?`

Implementar uma política determinística de `nextQuestion`: a LLM pode redigir a pergunta, mas o servidor escolhe entre lacunas válidas e impede perguntas fora do Brief/capability manifest.

### 7.6 Classificação obrigatória do trabalho

Para cada `job` do Brief, o Arquiteto deve classificar o recurso adequado antes de criar agentes:

| Natureza do trabalho | Recurso preferido |
| --- | --- |
| interpretar linguagem/intenção | agente LLM |
| decidir com contexto ou sintetizar | agente LLM |
| produzir/comunicar texto contextual | agente LLM |
| cálculo e transformação determinística | executor `function` |
| chamada/ação em sistema externo | executor `tool`/App |
| observar condição ou horário | trigger/rotina + monitor quando há interpretação |
| ordenar dependências reais | pipeline |
| agrupar visualmente | setor `organization` |
| distribuir/consolidar especialistas | gerente/coordenador |

O plano deve carregar `resourceDecision` com alternativa recusada e justificativa. Exemplo: “Consultar pedido” é uma ferramenta usada pelo comunicador, não um novo agente.

### 7.7 Função do agente como contrato operacional

Usar rigorosamente as funções já existentes (`manager`, `secretary`, `researcher`, `analyst`, `operator`, `communicator`, `monitor`, `custom`) e o `roleConfig` resolvido pelo servidor.

A função não pode ser somente badge. Ela governa:

- responsabilidade esperada;
- capabilities permitidas;
- executor coerente;
- recursos mínimos;
- conhecimento/fontes necessários;
- triggers coerentes;
- permissões e ações sensíveis;
- métrica sugerida;
- critérios de readiness;
- como o Planner pode rotear trabalho para o agente.

Todo agente proposto deve ter uma ficha completa:

```ts
type AgentResponsibilitySpec = {
  name: string
  preset: 'manager' | 'secretary' | 'researcher' | 'analyst' | 'operator' | 'communicator' | 'monitor' | 'custom'
  primaryResponsibility: string
  owns: string[]
  doesNotOwn: string[]
  executorKind: 'llm' | 'function' | 'tool'
  receives: string
  decides: string
  delivers: string
  activation: string[]
  knowledgeNeeds: string[]
  toolNeeds: string[]
  canCall: string[]
  canBeCalledBy: string[]
  humanEscalation: string
  successMetric: string
  justification: string
}
```

Regras específicas:

- **Manager:** precisa de equipe/recurso delegável real; entrega coordenação, decisão ou síntese; gerente sozinho é bloqueio/aviso forte.
- **Secretary:** tria, organiza, registra e encaminha; precisa definir categorias e destinos; não recebe autoridade de domínio automaticamente.
- **Researcher:** precisa de fonte/knowledge/web, política de evidência e atualidade; deve poder declarar “não encontrei”.
- **Analyst:** precisa de dados/entrada, período, método/critérios e saída verificável; cálculo determinístico vai para função.
- **Operator:** precisa de function/tool/App, schema, política de erro/retry e aprovação para ação sensível.
- **Communicator:** precisa de público/canal ou acionamento, tom, base comunicável, limites e handoff.
- **Monitor:** precisa de fonte, condição, frequência/evento, destino do alerta e deduplicação.
- **Custom:** somente quando nenhuma função existente serve; exige justificativa, capabilities explícitas e revisão adicional.

Não duplicar localmente a matriz real: essas regras complementam, e o `roleConfig` do backend continua sendo a autoridade de capabilities.

### 7.8 Executor como decisão separada da função

Função/cargo responde **qual responsabilidade o agente possui**. `executorKind` responde **como o trabalho é realizado**.

Exemplos válidos:

- Analista LLM interpreta um relatório, mas chama `calculate_rsi` como função determinística.
- Operador `tool` executa uma ação específica em um App com contrato e permissão.
- Comunicador LLM conduz a conversa e usa ferramentas para consultar pedido/reserva.

Regras:

- `function` exige `functionName`, versão quando aplicável, config segura, `inputJsonSchema` e `outputJsonSchema`;
- `tool` exige referência real a Tool/App/action e schemas resolvidos do catálogo;
- `llm` exige responsabilidade que justifique linguagem/julgamento e output contract;
- não permitir fallback silencioso de executor determinístico para LLM;
- um agente pode orquestrar/chamar funções e tools sem transformar cada chamada em agente;
- ações financeiras, destrutivas ou externas relevantes exigem política de aprovação/guardrail explícita.

### 7.9 Regras para juntar ou separar agentes

Juntar trabalhos no mesmo agente quando compartilham:

- a mesma responsabilidade principal;
- função e executor coerentes;
- conhecimento e permissões semelhantes;
- tipo de entrada e entrega;
- risco e forma de acionamento;
- contexto natural da mesma conversa/processo.

Separar quando houver diferença material de:

- função;
- domínio de conhecimento;
- permissão/segurança;
- executor determinístico versus julgamento;
- risco ou aprovação;
- acionamento e escala;
- entrega independente;
- possibilidade de falha/execução paralela.

O compilador deve persistir `mergeSplitRationale` para cada decisão. Não usar apenas contagem de tarefas.

Criar detectores explicáveis:

- `super_agent`: múltiplos domínios/responsabilidades incompatíveis;
- `micro_agent`: agente sem decisão própria, criado apenas para uma chamada/etapa;
- `duplicate_responsibility`;
- `unclear_boundary`;
- `orphan_agent`;
- `executor_mismatch`;
- `permission_mismatch`.

### 7.10 Orçamento de complexidade e implantação progressiva

Por padrão, propor uma operação inicial pequena:

- preferir 1–4 agentes no núcleo;
- mais agentes exigem justificativa individual;
- no máximo um nível de coordenação no MVP, salvo necessidade comprovada;
- separar `core`, `recommended` e `later`, sem gerar três blueprints contraditórios;
- aplicar somente o nível selecionado pelo usuário;
- recursos futuros aparecem como expansão, não como pendências que bloqueiam o primeiro teste.

Criar score determinístico e explicável, sem chamar de “confiança da IA”:

```ts
architectureScore: {
  coverage: number
  cohesion: number
  executorFit: number
  permissionSafety: number
  setupCompleteness: number
  handoffSimplicity: number
}
```

Cada nota precisa listar fatos que a formaram. O score auxilia a revisão; não substitui validações bloqueantes.

### 7.11 Crítico arquitetural

Executar depois da decomposição e antes do preview final.

Camada determinística obrigatória:

- schemas/referências;
- funções e executores;
- recursos mínimos por função;
- limites/permissões;
- agentes órfãos;
- outputs sem consumidor;
- ciclos/handoffs inválidos;
- pipeline sem dependência;
- gerente sem equipe;
- operação sem caminho de entrada/saída;
- complexidade acima do orçamento.

Camada LLM opcional e estruturada:

- procurar sobreposição, responsabilidade vaga, perguntas não respondidas e alternativas mais simples;
- retornar findings com `code`, evidência do Brief/Blueprint, severidade e correção;
- não alterar o Blueprint diretamente;
- o servidor valida findings e aplica correções apenas via patch revisável.

O preview mostra problemas em linguagem comum, com `Corrigir`, `Aceitar exceção` quando seguro ou `Responder pergunta`.

### 7.12 Simulação/dry-run antes de aplicar

Gerar de 3 a 8 cenários representativos a partir do Brief; permitir que o usuário acrescente casos.

Para cada cenário, mostrar:

- entrada/gatilho;
- agente ou recurso inicial;
- agentes, funções e tools acionados;
- contexto/knowledge esperado;
- handoffs;
- aprovação humana;
- entrega final;
- pendências e falhas esperadas.

Executar sem side effects externos:

- usar mocks/sandbox para tools;
- nunca enviar mensagem, cobrar, reembolsar, publicar ou alterar sistema real durante simulação;
- permitir simulação apenas de roteamento quando não houver sandbox;
- comparar o caminho observado com o esperado;
- falha de simulação volta ao crítico/Brief, não é escondida.

Salvar `simulationCases` e `simulationResults` versionados no projeto.

### 7.13 Experiência da proposta

A tela deve apresentar primeiro a recomendação em linguagem de negócio:

```text
Minha recomendação

2 agentes · 1 setor · 3 ferramentas · 1 canal

Resolve agora:
• dúvidas de clientes
• consulta de pedidos
• encaminhamento para humano

Depois:
• marketing automático
• análise de reclamações
```

Depois mostrar:

- por que essa quantidade de agentes;
- por que certos trabalhos viraram funções/tools;
- por que não juntou/separou mais;
- o que está pronto;
- o que exige conexão, conteúdo ou aprovação;
- custo/complexidade estimados com rótulos honestos;
- comparação `Essencial | Recomendado | Completo`, derivada do mesmo plano em camadas.

Cada card de agente mostra:

- função;
- responsabilidade;
- recebe;
- faz;
- não faz;
- entrega;
- executor;
- recursos;
- acionamento;
- handoff humano;
- readiness.

Detalhes técnicos ficam em expansão progressiva. Não abrir a experiência com JSON, schemas ou dezenas de cards horizontais.

Manter conversa e proposta separadas visualmente: chat pode ser aberto/fechado sem aprisionar a proposta numa coluna estreita; a proposta usa a largura de trabalho e o preview do escritório continua visível e atualizado.

### 7.14 Compilador Brief → Blueprint e aplicação segura

Criar um compilador determinístico sempre que possível:

1. resolve jobs e resource decisions;
2. consolida responsabilidades conforme merge/split;
3. escolhe preset/função a partir do manifesto;
4. resolve executor e recursos reais;
5. cria contratos, triggers, setores e wiring;
6. gera knowledge/app requirements como pendências verificáveis;
7. executa validator + crítico + simulação;
8. produz Blueprint versionado para o apply atual.

Preservar:

- aprovação por mudança;
- preview/diff;
- apply retomável;
- resourceMap;
- rollback/cleanup existente;
- reconferência posterior;
- audit trail.

Uma mudança no Brief não deve editar recursos aplicados silenciosamente. Gerar novo diff e pedir aprovação.

### 7.15 Integração com Knowledge Brain

- O Arquiteto usa a constituição diretamente, o capability manifest do servidor e exemplos recuperáveis do Brain.
- Requisitos de conhecimento do Brief viram documentos/pendências no escopo correto conforme as Fases 1–3.
- O Planner criado/aplicado usa `ContextRequirement` e `ContextManifest`.
- As funções dos agentes orientam defaults de acesso, mas permissões finais continuam explícitas e owner-scoped.
- Lacunas encontradas nas simulações podem virar `knowledge_gaps` antes da ativação.
- Não guardar automaticamente toda conversa do Arquiteto como conhecimento institucional.
- Decisões aprovadas de arquitetura podem ser registradas como documentação do projeto, separadas de conhecimento operacional enviado às LLMs.

---

## Fase 8 — Testes obrigatórios

### Backend

- CRUD e reindexação para os quatro owners.
- isolamento entre contas em todos os endpoints.
- IDs de prédio/andar/setor/agente de outra conta retornam 404 sem vazamento.
- compatibilidade de documentos legados.
- busca híbrida combinando building/floor/sector/agent dentro do mesmo orçamento global.
- deduplicação entre escopos.
- política legada mantém comportamento atual.
- `viewAs=agent` não devolve nós inacessíveis.
- links Markdown resolvidos, não resolvidos, renomeados e excluídos.
- layout salvo é owner-scoped.
- exclusão de owner remove documentos, chunks e posições relacionadas sem órfãos.
- migração do Arquiteto é idempotente e não perde dados.
- Planner produz requisitos válidos e o servidor recusa IDs/fontes não autorizados.
- Context Engine resolve o mesmo conjunto de escopos em chat, playground, rotina, delegação e setor.
- Context Manifest registra somente metadados seguros e representa usado/ignorado/ausente corretamente.
- requisitos obrigatórios ausentes bloqueiam somente quando grounding é exigido.
- fontes internas vêm do manifesto, nunca de citações inventadas pelo modelo.
- lacunas iguais são agregadas sem armazenar conversas integrais.
- uma lacuna só é resolvida depois da validação/eval definido.
- proposta não entra no retrieval antes de aprovação explícita.
- proposta aprovada mantém evidência, revisor e auditoria.
- documentos vencidos não respondem como atuais.
- precedência de autoridade e conflitos não resolvidos funcionam de forma determinística.
- expansão pelo grafo respeita um salto, permissões e orçamento global.
- impacto distingue `accessibleBy` de `actuallyUsedBy`.
- arquivamento preserva manifestos históricos; exclusão limpa relações sem quebrar auditoria.
- `ArchitectCapabilityManifest` corresponde aos presets, `roleConfig`, executores, Apps, tools, triggers e flags reais.
- capability/ação inventada pela LLM é recusada no servidor.
- `OperationBrief` recebe patches válidos, preserva versão e permite desfazer.
- respostas conhecidas não geram perguntas repetidas.
- `nextQuestion` só escolhe lacunas válidas e prioriza impacto real.
- classificação agente/function/tool/rotina/setor segue as regras e mantém justificativa.
- cada `AgentResponsibilitySpec` possui responsabilidade, limites, executor, entrada, entrega, acionamento e métrica.
- manager sem equipe, researcher sem fonte, analyst sem dados, operator sem tool/function, communicator sem canal/acionamento e monitor sem fonte/gatilho são sinalizados.
- `custom` sem justificativa/capabilities explícitas é recusado.
- executor `function` sem função/schema e `tool` sem ação real são recusados.
- fallback de função/tool para LLM não acontece silenciosamente.
- detectores de superagente, microagente, duplicidade, órfão e executor/permissão incompatível.
- `mergeSplitRationale` é preservado e reproduzível.
- orçamento de complexidade e score são determinísticos e explicáveis.
- crítico LLM não altera Blueprint diretamente.
- compilação Brief → Blueprint é estável para a mesma versão de Brief, constituição e manifesto.
- mudança de Brief após apply produz diff; nunca altera recursos silenciosamente.
- simulação não produz side effects e registra rota esperada/observada.
- apply existente continua retomável, auditável e protegido por aprovação.

### Frontend unitário

- tipo de nó → visual correto.
- setor usa cor + inicial.
- agente usa retrato atual.
- edges não herdam cor de agente/setor.
- filtros e destaque de vizinhança.
- query string preserva a visualização.
- editor Markdown e preview.
- estados loading/error/empty/indexing.
- renderização de lacuna, conflito, validade e revisão.
- inspector diferencia permissão potencial de uso comprovado.
- Context Manifest destaca os nós corretos.
- fila de propostas exige decisão explícita.
- análise de impacto não mostra contagens fictícias.
- Brief mostra fatos, suposições e perguntas pendentes sem detalhes técnicos desnecessários.
- cards de agente mostram função, responsabilidade, “não faz”, executor, recursos e readiness.
- níveis Essencial/Recomendado/Completo são camadas do mesmo plano, não propostas contraditórias.
- findings do crítico possuem evidência, severidade e ação.
- preview mostra agente × função × ferramenta × fluxo com hierarquia legível.
- chat pode abrir/fechar sem prender a proposta numa coluna estreita.

### Playwright

- alternar Escritório ↔ Conhecimento no desktop e mobile.
- abrir documento pelo nó, editar Markdown, salvar e ver estado de indexação.
- filtrar por setor.
- “Ver como agente” remove conhecimento sem acesso.
- arrastar nó, recarregar e confirmar posição.
- inspector mobile não quebra navegação nem bottom nav.
- navegação por teclado e foco do drawer.
- abrir uma execução e destacar o contexto realmente usado no mapa.
- criar uma lacuna por execução sem base, adicionar documento e validar sua resolução.
- aprovar/rejeitar proposta e confirmar que somente a aprovada entra no retrieval.
- conflito entre política global e nota do setor é exibido e não escolhido silenciosamente.
- documento vencido aparece no painel, mas não é usado como fato atual.
- impacto antes de arquivar mostra agentes com acesso e execuções reais em categorias diferentes.
- iniciar Montar operação com uma descrição vaga e receber somente perguntas de alto impacto, uma ou duas por turno.
- corrigir “O que entendi” altera o Brief e atualiza a recomendação sem repetir entrevista.
- cenário de superagente é dividido ou apresentado como bloqueio explicável.
- cenário de microagentes é consolidado em agente + funções/tools.
- restaurante simples recomenda comunicador com ferramentas, sem criar agente para cada consulta.
- cálculo determinístico recomenda executor `function`, mantendo interpretação no analista quando necessária.
- ação sensível exige aprovação humana na proposta e na simulação.
- gerente só aparece quando existe equipe real para coordenar.
- alternar Essencial/Recomendado/Completo mantém a mesma base de decisões.
- dry-run exibe caminho e não dispara Apps reais.
- aplicar somente o nível aprovado cria os recursos esperados e mantém expansões futuras fora do núcleo.
- mobile permite responder, revisar Brief, abrir agente e aprovar proposta sem overflow horizontal.

Executar antes de concluir:

- build backend;
- testes backend;
- build frontend;
- testes frontend;
- E2E novos e smoke tests relevantes existentes.

---

## Critérios de aceite do release

1. O mapa atual do escritório continua funcionando sem regressão.
2. O usuário alterna para Conhecimento dentro do mesmo andar.
3. O Knowledge Map mostra global, andar, setores, agentes e documentos com hierarquia compreensível.
4. Setor aparece como bolinha com sua cor e primeira letra.
5. Agente aparece como bolinha com o mesmo retrato já usado pelo sistema.
6. Conexões permanecem neutras e legíveis.
7. O usuário consegue selecionar, arrastar, buscar, filtrar e expandir o mapa.
8. Clicar em documento permite ler e editar Markdown com preview.
9. “Ver como agente” mostra somente o que o backend confirma que ele pode acessar.
10. O runtime usa uma única resolução de escopos em chat, delegação, setor, rotina e playground.
11. Documentos dos quatro escopos usam o RAG existente, sem base paralela.
12. Memória e Live Data continuam mecanismos separados.
13. Nenhuma conta consegue inferir nomes, contagens ou IDs de outra conta.
14. O frontend funciona em 320 px sem overflow horizontal da página.
15. Nenhum dado fictício é mostrado em métricas, histórico ou “usado por”.
16. O Planner declara conhecimento, Live Data e histórico necessários em contratos separados e validados.
17. Cada execução nova produz um Context Manifest seguro, consultável e utilizável para destacar o mapa.
18. A resposta pode mostrar fontes internas comprovadas pelo manifesto.
19. O sistema agrega lacunas e oferece um fluxo verificável para resolvê-las.
20. Agentes apenas propõem conhecimento; publicação exige validação e aprovação explícita.
21. Validade, revisão e autoridade interferem no retrieval de forma determinística.
22. Conflitos não são entregues à LLM como se fossem fatos igualmente válidos e compatíveis.
23. A expansão pelas conexões do grafo respeita permissão, validade, top-K e orçamento de caracteres.
24. Análise de impacto diferencia acesso possível de uso comprovado.
25. Evals demonstram o efeito da nova resolução de contexto sobre qualidade, latência e tokens.
26. O Montar operação começa por um Brief persistente e não por um Blueprint inventado imediatamente.
27. A entrevista faz no máximo uma ou duas perguntas de alto impacto por turno em linguagem de negócio.
28. Constituição, capability manifest e exemplos têm papéis separados e versões rastreáveis.
29. O servidor impede o Arquiteto de criar capacidades, Apps, ações ou executores inexistentes.
30. Todo agente proposto possui função real, responsabilidade principal, limites, executor, entrada, entrega, acionamento e métrica.
31. As funções atuais governam readiness, capabilities, recursos mínimos, roteamento e validações; não são apenas badges.
32. Trabalho determinístico usa função de código e ação externa usa tool/App quando apropriado.
33. O sistema não cria um agente por microetapa e não concentra domínios incompatíveis num superagente.
34. Gerentes, pesquisadores, analistas, operadores, comunicadores e monitores incompletos são bloqueados ou sinalizados com correção acionável.
35. `custom` é exceção justificada, nunca o default do Arquiteto.
36. A recomendação começa pela menor operação funcional e separa núcleo de expansão futura.
37. Crítico e simulador encontram problemas antes do apply, sem executar efeitos externos.
38. A proposta explica por que juntou/separou agentes e por que um trabalho virou agente, função ou ferramenta.
39. A UI apresenta linguagem simples primeiro e detalhes técnicos por expansão progressiva.
40. Alterações posteriores no Brief geram novo diff/aprovação e preservam recursos já aplicados até confirmação.

---

## Fora do escopo deste release

- transformar APIs, banco, histórico ou memória em documento automaticamente;
- permitir escrita autônoma irrestrita de agentes no Knowledge Brain;
- versionamento completo estilo Git dos documentos;
- colaboração simultânea em tempo real;
- grafo físico animado continuamente;
- cores de conexão por agente;
- upload de foto de perfil do agente;
- múltiplos prédios por conta;
- apagar os endpoints antigos antes de migrar todos os consumidores.
- deixar a LLM conceder a si mesma capabilities ou permissões;
- aplicar proposta do Arquiteto sem aprovação;
- tratar score arquitetural como verdade ou “confiança da IA”;
- executar Apps reais durante dry-run;
- criar um modelo de agente novo quando uma função atual + executor resolve;
- usar `custom` automaticamente para evitar as regras das funções existentes.

---

## Ordem de execução esperada

1. Auditar novamente o commit atual e registrar diferenças se o repositório tiver avançado.
2. Congelar baselines dos fluxos atuais de Knowledge e Montar operação, incluindo casos problemáticos reproduzíveis.
3. Criar constituição versionada, capability manifest server-side e testes de drift.
4. Implementar `OperationBrief`, versionamento, patches e política de entrevista/`nextQuestion`.
5. Implementar classificador de recurso, contratos de função/executor, merge/split e orçamento de complexidade.
6. Implementar crítico, simulação sem side effects e experiência Essencial/Recomendado/Completo.
7. Conectar compilador Brief → Blueprint ao preview/diff/apply existente, preservando aprovações e retomada.
8. Implementar modelo, migração e autorização dos quatro escopos de Knowledge.
9. Unificar API sem remover adapters antigos.
10. Implementar política de acesso e Context Engine; cobrir com testes.
11. Integrar requisitos de contexto do Planner e Context Manifest a todos os caminhos de execução.
12. Implementar fontes internas, lacunas, validade, autoridade e conflitos.
13. Implementar propostas de conhecimento com validação e aprovação humana.
14. Implementar links, expansão controlada e endpoint do grafo.
15. Implementar análise de impacto.
16. Implementar `KnowledgeMap`, inspector e editor.
17. Integrar ao `FloorView`, execuções, Montar operação e mobile.
18. Atualizar Arquiteto, trace e telas antigas para a fonte única.
19. Rodar evals arquiteturais e de contexto, testes, corrigir regressões e produzir relatório final com arquivos alterados, migrações, variáveis novas, métricas antes/depois e evidências de QA.

Se o tamanho exigir divisão, entregar em PRs/fases funcionais, mas não pular autorização, migração, testes ou compatibilidade para mostrar apenas um protótipo visual.
