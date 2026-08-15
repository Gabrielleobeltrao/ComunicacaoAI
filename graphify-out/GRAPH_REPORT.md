# Graph Report - backend/src  (2026-08-15)

## Corpus Check
- 94 files · ~97,382 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1130 nodes · 2842 edges · 49 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Prédio, andares e métricas
- Sessão, banco e delegações
- Central de execuções
- Auditoria append-only
- Modelo do agente
- API HTTP (rotas)
- Apps embutidos e Google
- Presets e prontidão
- Configuração e ferramentas
- Memória de conversa
- Delegação entre agentes
- Canais e widgets
- Ferramentas e validação
- Runner de automação
- Fila de runs (MongoDB)
- Rotinas do agente
- Provedor Claude e prompt
- WhatsApp e mídia
- Base de conhecimento (RAG)
- Execução de passo de rotina
- Publicação de automações
- Motor de automações
- Processamento e entregas
- Repositório de automações
- Métricas do agente
- Extração estruturada (LLM)
- Dispatch de provedor
- Contabilização de tokens
- Catálogo de modelos
- Ligação da delegação
- Runtime de execução
- Decisões de setor
- Conhecimento do setor
- Scheduler e relógio cron
- Validação de definição
- Conexões de entrega
- Telemetria de execução
- Repositório de conexões
- Gatilhos por webhook
- Embeddings e turnos
- Índices e bootstrap
- Tipos de automação
- HTTP seguro (SSRF)
- Configurações do usuário
- Gatilhos de evento
- Erros públicos seguros
- Indexação de documentos
- Guardrail de escopo
- Transição de etapa

## God Nodes (most connected - your core abstractions)
1. `respondWithAgentIfLinked()` - 33 edges
2. `db` - 32 edges
3. `getAgentById()` - 24 edges
4. `buildDeps()` - 24 edges
5. `refreshMemoryAndIdentity()` - 23 edges
6. `encrypt()` - 18 edges
7. `productionDelegationDeps()` - 18 edges
8. `resolveSectorTurn()` - 17 edges
9. `getFloor()` - 16 edges
10. `ResolvedTool` - 15 edges

## Surprising Connections (you probably didn't know these)
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  automations/runProcessor.ts → agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  automations/runProcessor.ts → agentRuntime.ts
- `resolveAgentTools()` --indirect_call--> `resolveHttpTool()`  [INFERRED]
  builtinTools.ts → agentTools.ts
- `buildDeps()` --indirect_call--> `getAgentById()`  [INFERRED]
  automations/runProcessor.ts → agents.ts
- `buildDeps()` --indirect_call--> `resolveOwnedSectorId()`  [INFERRED]
  automations/runProcessor.ts → sectors.ts

## Import Cycles
- 3-file cycle: `agentTools.ts -> agents.ts -> llm.ts -> agentTools.ts`
- 4-file cycle: `agentTools.ts -> agents.ts -> llm.ts -> openai.ts -> agentTools.ts`

## Communities (49 total, 0 thin omitted)

### Community 0 - "Prédio, andares e métricas"
Cohesion: 0.06
Nodes (47): agentStatesForFloor(), buildingOverview(), floorMetrics, ensureAutomationIndexes(), ensureRunIndexes(), Building, BuildingLanguage, BuildingPatch (+39 more)

### Community 1 - "Sessão, banco e delegações"
Cohesion: 0.06
Nodes (50): createAgent(), auth, db, mongoClient, col, DelegationFinish, DelegationRecord, DelegationStart (+42 more)

### Community 2 - "Central de execuções"
Cohesion: 0.08
Nodes (48): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+40 more)

### Community 3 - "Auditoria append-only"
Cohesion: 0.08
Nodes (36): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+28 more)

### Community 4 - "Modelo do agente"
Cohesion: 0.05
Nodes (43): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentBuiltinTool, AgentModelFields, agents, AgentTool, AgentToolHeader (+35 more)

### Community 5 - "API HTTP (rotas)"
Cohesion: 0.05
Nodes (25): stopEmbeddedEngine(), getBuiltinApp(), app, AVATAR_MIME_TYPES, channelWebhookUrl(), httpServer, io, isValidWebhookUrl() (+17 more)

### Community 6 - "Apps embutidos e Google"
Cohesion: 0.09
Nodes (35): APP_GUIDES, BUILTIN_APPS, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, decryptConfig(), decrypt(), getKey() (+27 more)

### Community 7 - "Presets e prontidão"
Cohesion: 0.08
Nodes (35): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+27 more)

### Community 8 - "Configuração e ferramentas"
Cohesion: 0.07
Nodes (31): clientUrl, FeatureFlags, flags, isProduction, originList(), port, stripTrailingSlash(), urlVar() (+23 more)

### Community 9 - "Memória de conversa"
Cohesion: 0.10
Nodes (33): conversationMemories, ConversationMemory, getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory(), getStructuredOutputData() (+25 more)

### Community 10 - "Delegação entre agentes"
Cohesion: 0.11
Nodes (30): presetSpec(), suggestPresetForCapability(), agentCard(), asOutputFormat(), buildCapabilityMissing(), CapabilityMissing, checkDelegation(), childContext() (+22 more)

### Community 11 - "Canais e widgets"
Cohesion: 0.08
Nodes (31): ensureActivationMode(), addMessage(), addOwnerReply(), AgentCardStats, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 12 - "Ferramentas e validação"
Cohesion: 0.12
Nodes (27): legacyToolToExecutable(), MAX_TOOL_ITERATIONS, missingCapability(), resolveHttpTool(), runResolvedTool(), toolInputSchema(), checkStageOutput(), describeErrors() (+19 more)

### Community 13 - "Runner de automação"
Cohesion: 0.11
Nodes (27): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+19 more)

### Community 14 - "Fila de runs (MongoDB)"
Cohesion: 0.12
Nodes (23): findVersion(), artifacts, findRun(), insertRunIdempotent(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS (+15 more)

### Community 15 - "Rotinas do agente"
Cohesion: 0.17
Nodes (24): getAgentById(), EventTriggerSpec, buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError (+16 more)

### Community 16 - "Provedor Claude e prompt"
Cohesion: 0.14
Nodes (24): anthropicUsage(), AUXILIARY_MODEL, FALLBACK_MODELS, generateAgentReply(), planSectorResponse(), planSectorResponse(), buildSectorPlannerPrompt(), buildSystemPrompt() (+16 more)

### Community 17 - "WhatsApp e mídia"
Cohesion: 0.12
Nodes (21): extractTextFromFile(), getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia() (+13 more)

### Community 18 - "Base de conhecimento (RAG)"
Cohesion: 0.10
Nodes (23): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), documents, EMBEDDING_DIMENSIONS (+15 more)

### Community 19 - "Execução de passo de rotina"
Cohesion: 0.15
Nodes (19): AgentExecutionRequest, AgentExecutionResult, Agent, ResolvedTool, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError (+11 more)

### Community 20 - "Publicação de automações"
Cohesion: 0.21
Nodes (20): createEventTrigger(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), collectSectorRefs(), createAutomation(), defaultDefinition(), normalizeName(), publishAutomation() (+12 more)

### Community 21 - "Motor de automações"
Cohesion: 0.14
Nodes (19): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+11 more)

### Community 22 - "Processamento e entregas"
Cohesion: 0.17
Nodes (18): processRun(), findRunUnscoped(), insertArtifact(), insertStepRun(), updateRun(), preview(), chunkTelegram(), FetchImpl (+10 more)

### Community 23 - "Repositório de automações"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+4 more)

### Community 24 - "Métricas do agente"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 25 - "Extração estruturada (LLM)"
Cohesion: 0.16
Nodes (18): buildClient(), extractIdentity(), extractStructuredOutput(), transcribeImage(), updateMemory(), updateStructuredMemory(), buildClient(), extractIdentity() (+10 more)

### Community 26 - "Dispatch de provedor"
Cohesion: 0.20
Nodes (16): SUPPORTED_IMAGE_TYPES, auxiliaryModel(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), generateAgentReply(), listModelsForProvider(), planSectorResponse() (+8 more)

### Community 27 - "Contabilização de tokens"
Cohesion: 0.18
Nodes (17): attemptChargeKey(), dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

### Community 28 - "Catálogo de modelos"
Cohesion: 0.21
Nodes (14): ToolCallRecord, listAvailableModels(), AgentReplyResult, TokenUsage, cache, cacheKey(), getCachedModels(), ModelOption (+6 more)

### Community 29 - "Ligação da delegação"
Cohesion: 0.25
Nodes (14): runEventKey(), buildDeps(), resolveAgentTools(), agentCanDelegate(), buildDelegationTools(), capabilityMissingTool(), DelegationContext, rootContext() (+6 more)

### Community 30 - "Runtime de execução"
Cohesion: 0.21
Nodes (13): AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+5 more)

### Community 31 - "Decisões de setor"
Cohesion: 0.13
Nodes (14): getActiveAgentId(), setActiveAgentId(), auxModelFor(), buildStageTransitionOptions(), memberRoutingLine(), resolveSectorTurn(), aggregateSectorDecisions(), listSectorDecisionsForConversation() (+6 more)

### Community 32 - "Conhecimento do setor"
Cohesion: 0.16
Nodes (12): resolveOwnedSectorId(), deleteDocument(), deleteDocumentFor(), getDocument(), getDocumentFor(), KnowledgeDocument, listDocuments(), listDocumentsFor() (+4 more)

### Community 33 - "Scheduler e relógio cron"
Cohesion: 0.24
Nodes (12): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes(), planSchedules() (+4 more)

### Community 34 - "Validação de definição"
Cohesion: 0.24
Nodes (11): AutomationValidationError, canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord(), validateDefinition() (+3 more)

### Community 35 - "Conexões de entrega"
Cohesion: 0.23
Nodes (10): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, getConnection(), isNonEmpty(), normalizeName(), patchConnection(), PROVIDERS (+2 more)

### Community 36 - "Telemetria de execução"
Cohesion: 0.20
Nodes (11): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), recordAgentEvent() (+3 more)

### Community 37 - "Repositório de conexões"
Cohesion: 0.17
Nodes (6): connections, deliveries, insertDeliveryIdempotent(), listDeliveries(), sentDeliveriesByAgent(), updateDelivery()

### Community 38 - "Gatilhos por webhook"
Cohesion: 0.31
Nodes (10): CreateAutomationInput, UpdateDraftPatch, Automation, AutomationDefinition, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent() (+2 more)

### Community 39 - "Embeddings e turnos"
Cohesion: 0.25
Nodes (9): ConversationTurn, EMBEDDING_DIMENSIONS, recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText(), embedTexts() (+1 more)

### Community 40 - "Índices e bootstrap"
Cohesion: 0.20
Nodes (10): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), ensureExecutionIndexes(), ensureConversationTurnsVectorIndex(), start(), backfillKnowledgeOwners(), ensureKnowledgeIndexes() (+2 more)

### Community 41 - "Tipos de automação"
Cohesion: 0.20
Nodes (9): AutomationInput, AutomationLimits, DEFAULT_LIMITS, DeliveryTarget, ManualTrigger, RetryPolicy, ScheduleTrigger, STEP_TYPES (+1 more)

### Community 42 - "HTTP seguro (SSRF)"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 43 - "Configurações do usuário"
Cohesion: 0.22
Nodes (8): clearProviderApiKey(), FIELD_BY_PROVIDER, getMonthlyTokenCap(), getProviderKeyStatus(), setMonthlyTokenCap(), setProviderApiKey(), settings, UserSettings

### Community 44 - "Gatilhos de evento"
Cohesion: 0.46
Nodes (7): buildEventTriggerDefinition(), EventTriggerError, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), getAutomation()

### Community 45 - "Erros públicos seguros"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 46 - "Indexação de documentos"
Cohesion: 0.29
Nodes (7): chunkText(), createDocument(), createDocumentFor(), indexDocumentChunks(), reindexDocumentFor(), updateDocument(), updateDocumentFor()

### Community 47 - "Guardrail de escopo"
Cohesion: 0.67
Nodes (4): checkGuardrail(), checkGuardrail(), buildGuardrailCheckPrompt(), parseInScopeResult()

### Community 48 - "Transição de etapa"
Cohesion: 0.67
Nodes (4): planStageTransition(), planStageTransition(), buildStageTransitionPrompt(), parseStageTransition()

## Knowledge Gaps
- **238 isolated node(s):** `AgentEventSource`, `AGENT_EVENT_SOURCES`, `AGENT_EVENT_STATUSES`, `AgentExecutionEvent`, `PRESET_KPI` (+233 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `db` connect `Sessão, banco e delegações` to `Prédio, andares e métricas`, `Central de execuções`, `Auditoria append-only`, `Modelo do agente`, `API HTTP (rotas)`, `Apps embutidos e Google`, `Configuração e ferramentas`, `Memória de conversa`, `Canais e widgets`, `Fila de runs (MongoDB)`, `Base de conhecimento (RAG)`, `Repositório de automações`, `Contabilização de tokens`, `Decisões de setor`, `Scheduler e relógio cron`, `Telemetria de execução`, `Repositório de conexões`, `Embeddings e turnos`, `Configurações do usuário`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `encrypt()` connect `Publicação de automações` to `Conexões de entrega`, `API HTTP (rotas)`, `Apps embutidos e Google`, `Configuração e ferramentas`, `Configurações do usuário`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `getAgentById()` connect `Rotinas do agente` to `Sessão, banco e delegações`, `Modelo do agente`, `API HTTP (rotas)`, `Memória de conversa`, `Gatilhos de evento`, `WhatsApp e mídia`, `Publicação de automações`, `Processamento e entregas`, `Ligação da delegação`, `Decisões de setor`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AgentEventSource`, `AGENT_EVENT_SOURCES`, `AGENT_EVENT_STATUSES` to the rest of the system?**
  _238 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Prédio, andares e métricas` be split into smaller, more focused modules?**
  _Cohesion score 0.0648018648018648 - nodes in this community are weakly interconnected._
- **Should `Sessão, banco e delegações` be split into smaller, more focused modules?**
  _Cohesion score 0.05536723163841808 - nodes in this community are weakly interconnected._