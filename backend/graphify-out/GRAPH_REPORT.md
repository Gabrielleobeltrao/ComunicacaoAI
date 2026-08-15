# Graph Report - backend  (2026-08-15)

## Corpus Check
- 145 files · ~140,181 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1434 nodes · 3158 edges · 96 communities (85 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 26 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Contabilização de tokens
- floors
- systemPrompt
- runRepository
- Conhecimento (RAG)
- Central de execuções
- API HTTP (rotas)
- Auditoria append-only
- Modelo do agente
- providerApps
- agentReadiness
- Memória de conversa
- Runner de automação
- Canais e widgets
- Delegação entre agentes
- Testes: audit
- Rotinas do agente
- WhatsApp e mídia
- Custom Tools
- Execução de passo
- Repositório de automações
- Publicação de automações
- Dependências
- Métricas do agente
- Histórico de delegação
- Dispatch de provedor
- Dependências
- Configuração TS
- Testes: executionCenter
- Testes: logRoutes
- Runtime de execução
- sectorDecisions
- seedRestaurantDemo
- Setores
- worker
- Telemetria de execução
- jsonSchema
- validate
- Executor de ferramenta
- Testes: eventTrigger
- eventTrigger
- config
- sectorMembership
- Dependências
- types
- Dependências
- webhookTriggers
- HTTP seguro (SSRF)
- userSettings
- Testes: delegation
- Testes: runnerTimeout
- Testes: runtimeHardening
- Testes: schedulerPublish
- Ferramentas (despachante)
- Testes: agentHistory
- Testes: auditRouteMap
- Testes: routineDelivery
- Testes: deployment
- Testes: hardening
- Testes: toolsSecurity
- Testes: collaboration
- toolCallLog
- Testes: config
- Testes: groundingContract
- Testes: jsonSchema
- Testes: outputContract
- Testes: readiness
- Testes: automations
- Dependências
- Dependências
- Dependências
- Delegação entre agentes
- Testes: routine
- Testes: seedGuard

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
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts
- `resolveAgentTools()` --indirect_call--> `resolveHttpTool()`  [INFERRED]
  src/builtinTools.ts → src/agentTools.ts
- `buildDeps()` --indirect_call--> `getAgentById()`  [INFERRED]
  src/automations/runProcessor.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (96 total, 11 thin omitted)

### Community 0 - "Contabilização de tokens"
Cohesion: 0.05
Nodes (60): runEventKey(), buildDeps(), processRun(), findRunUnscoped(), insertArtifact(), insertStepRun(), updateRun(), preview() (+52 more)

### Community 1 - "floors"
Cohesion: 0.06
Nodes (51): agentStatesForFloor(), buildingOverview(), floorMetrics, ensureAutomationIndexes(), ensureRunIndexes(), Building, BuildingLanguage, BuildingPatch (+43 more)

### Community 2 - "systemPrompt"
Cohesion: 0.08
Nodes (65): MAX_TOOL_ITERATIONS, ToolCallRecord, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractIdentity(), extractStructuredOutput() (+57 more)

### Community 3 - "runRepository"
Cohesion: 0.05
Nodes (57): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+49 more)

### Community 4 - "Conhecimento (RAG)"
Cohesion: 0.06
Nodes (52): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, resolveOwnedSectorId() (+44 more)

### Community 5 - "Central de execuções"
Cohesion: 0.07
Nodes (49): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+41 more)

### Community 6 - "API HTTP (rotas)"
Cohesion: 0.05
Nodes (31): backfillAgentEventAttempts(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), app, AVATAR_MIME_TYPES, channelWebhookUrl() (+23 more)

### Community 7 - "Auditoria append-only"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "Modelo do agente"
Cohesion: 0.05
Nodes (43): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentBuiltinTool, AgentModelFields, agents, AgentToolHeader, AgentToolParam (+35 more)

### Community 9 - "providerApps"
Cohesion: 0.09
Nodes (34): ResolvedTool, APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, buildGoogleAuthUrl() (+26 more)

### Community 10 - "agentReadiness"
Cohesion: 0.08
Nodes (34): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+26 more)

### Community 11 - "Memória de conversa"
Cohesion: 0.10
Nodes (33): conversationMemories, ConversationMemory, getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory(), getStructuredOutputData() (+25 more)

### Community 12 - "Runner de automação"
Cohesion: 0.11
Nodes (27): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+19 more)

### Community 13 - "Canais e widgets"
Cohesion: 0.08
Nodes (30): addMessage(), addOwnerReply(), AgentCardStats, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel(), deleteWidget() (+22 more)

### Community 14 - "Delegação entre agentes"
Cohesion: 0.13
Nodes (29): presetSpec(), suggestPresetForCapability(), agentCard(), asOutputFormat(), buildCapabilityMissing(), CapabilityMissing, checkDelegation(), childContext() (+21 more)

### Community 15 - "Testes: audit"
Cohesion: 0.13
Nodes (9): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), automations() (+1 more)

### Community 16 - "Rotinas do agente"
Cohesion: 0.22
Nodes (21): ensureActivationMode(), getAgentById(), createEventTrigger(), buildRoutineDefinition(), createRoutine(), listAgentAutomations(), listRoutines(), RoutineError (+13 more)

### Community 17 - "WhatsApp e mídia"
Cohesion: 0.12
Nodes (21): extractTextFromFile(), getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia() (+13 more)

### Community 18 - "Custom Tools"
Cohesion: 0.09
Nodes (21): clamp(), createTool(), deleteTool(), getTool(), getToolsByIds(), listTools(), normalize(), TOOL_AUTH_KINDS (+13 more)

### Community 19 - "Execução de passo"
Cohesion: 0.15
Nodes (18): RecordAgentEventInput, AgentExecutionRequest, AgentExecutionResult, Agent, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError (+10 more)

### Community 20 - "Repositório de automações"
Cohesion: 0.12
Nodes (13): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+5 more)

### Community 21 - "Publicação de automações"
Cohesion: 0.19
Nodes (17): assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName(), requireFloor() (+9 more)

### Community 22 - "Dependências"
Cohesion: 0.11
Nodes (19): @anthropic-ai/sdk, better-auth, cors, cron-parser, multer, nodemailer, openai, dependencies (+11 more)

### Community 23 - "Métricas do agente"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "Histórico de delegação"
Cohesion: 0.15
Nodes (16): resolveAgentTools(), agentCanDelegate(), buildDelegationTools(), capabilityMissingTool(), DelegationContext, col, DelegationFinish, DelegationRecord (+8 more)

### Community 25 - "Dispatch de provedor"
Cohesion: 0.20
Nodes (16): SUPPORTED_IMAGE_TYPES, auxiliaryModel(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), generateAgentReply(), listModelsForProvider(), planSectorResponse() (+8 more)

### Community 26 - "Dependências"
Cohesion: 0.12
Nodes (17): mongodb-memory-server, devDependencies, mongodb-memory-server, tsx, @types/cors, @types/express, @types/multer, @types/node (+9 more)

### Community 27 - "Configuração TS"
Cohesion: 0.12
Nodes (15): ES2022, src, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+7 more)

### Community 28 - "Testes: executionCenter"
Cohesion: 0.17
Nodes (15): AGENT_A, AGENT_B, agents(), automations(), FLOOR_A, FLOOR_B, floors(), NOW (+7 more)

### Community 29 - "Testes: logRoutes"
Cohesion: 0.14
Nodes (7): AGENT, AUTOMATION, call(), FLOOR, json(), runs(), seedRun()

### Community 30 - "Runtime de execução"
Cohesion: 0.21
Nodes (13): AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+5 more)

### Community 31 - "sectorDecisions"
Cohesion: 0.13
Nodes (14): getActiveAgentId(), setActiveAgentId(), auxModelFor(), buildStageTransitionOptions(), memberRoutingLine(), resolveSectorTurn(), aggregateSectorDecisions(), listSectorDecisionsForConversation() (+6 more)

### Community 32 - "seedRestaurantDemo"
Cohesion: 0.23
Nodes (13): SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member(), OWNED_COLLECTIONS (+5 more)

### Community 33 - "Setores"
Cohesion: 0.16
Nodes (14): deleteSector(), enforceSingleMembership(), normalizeMembers(), normalizeStages(), SECTOR_MODE_LABEL, SECTOR_MODES, SectorReadinessCode, SectorReadinessInput (+6 more)

### Community 34 - "worker"
Cohesion: 0.24
Nodes (8): auth, config, db, mongoClient, AgentDoc, main(), STARTUP_PROBE_MS, withinTimeout()

### Community 35 - "Telemetria de execução"
Cohesion: 0.20
Nodes (11): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, ensureAgentEventIndexes(), finalizeAgentEvent(), finalizeAgentEventSafe() (+3 more)

### Community 36 - "jsonSchema"
Cohesion: 0.29
Nodes (11): runResolvedTool(), checkStageOutput(), describeErrors(), join(), matchesType(), Schema, SchemaError, typeOf() (+3 more)

### Community 37 - "validate"
Cohesion: 0.29
Nodes (11): publishAutomation(), sameTrigger(), canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord() (+3 more)

### Community 38 - "Executor de ferramenta"
Cohesion: 0.23
Nodes (10): executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets(), ToolExecutionResult, SENSITIVE_HEADER (+2 more)

### Community 39 - "Testes: eventTrigger"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "eventTrigger"
Cohesion: 0.31
Nodes (10): buildEventTriggerDefinition(), EventTriggerError, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), getRoutineForAgent() (+2 more)

### Community 41 - "config"
Cohesion: 0.22
Nodes (9): clientUrl, FeatureFlags, flags, isProduction, originList(), port, stripTrailingSlash(), urlVar() (+1 more)

### Community 42 - "sectorMembership"
Cohesion: 0.22
Nodes (10): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, MAX_SECTOR_MEMBERS, Sector (+2 more)

### Community 43 - "Dependências"
Cohesion: 0.20
Nodes (10): scripts, build, dev, dev:api, dev:worker, seed:demo, start, start:api (+2 more)

### Community 44 - "types"
Cohesion: 0.20
Nodes (9): AutomationInput, AutomationLimits, DEFAULT_LIMITS, DeliveryTarget, ManualTrigger, RetryPolicy, ScheduleTrigger, STEP_TYPES (+1 more)

### Community 45 - "Dependências"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "webhookTriggers"
Cohesion: 0.42
Nodes (8): syncEventTriggerFor(), Automation, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent(), liveWebhookCountFor(), PublishedAutomation

### Community 47 - "HTTP seguro (SSRF)"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 48 - "userSettings"
Cohesion: 0.22
Nodes (8): clearProviderApiKey(), FIELD_BY_PROVIDER, getMonthlyTokenCap(), getProviderKeyStatus(), setMonthlyTokenCap(), setProviderApiKey(), settings, UserSettings

### Community 49 - "Testes: delegation"
Cohesion: 0.22
Nodes (4): B, BUILDING, FLOOR_A, FLOOR_B

### Community 50 - "Testes: runnerTimeout"
Cohesion: 0.25
Nodes (3): AGENT_ID, baseDeps(), runnerFor()

### Community 51 - "Testes: runtimeHardening"
Cohesion: 0.28
Nodes (6): AGENT_ID, delegateTo(), dispatch(), FLOOR, SECTOR_ID, targetAgent()

### Community 52 - "Testes: schedulerPublish"
Cohesion: 0.39
Nodes (6): automations(), definition(), editDraft(), seedPublished(), step(), versions()

### Community 53 - "Ferramentas (despachante)"
Cohesion: 0.32
Nodes (7): AgentTool, legacyToolToExecutable(), missingCapability(), resolveHttpTool(), toolInputSchema(), ExecutableTool, TOOL_DEFAULTS

### Community 54 - "Testes: agentHistory"
Cohesion: 0.25
Nodes (4): AGENT, FLOOR, OTHER_AGENT, ROUTINE

### Community 55 - "Testes: auditRouteMap"
Cohesion: 0.29
Nodes (5): ACTIONS, declaredRoutes(), readSource(), ROUTER_PREFIX, SOURCE_DIR

### Community 56 - "Testes: routineDelivery"
Cohesion: 0.25
Nodes (4): AGENT, BUILDING, CONNECTION, FLOOR

### Community 57 - "Testes: deployment"
Cohesion: 0.29
Nodes (4): compose, coolify, envExample, pkg

### Community 60 - "Testes: collaboration"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "toolCallLog"
Cohesion: 0.40
Nodes (4): listToolCalls(), logToolCalls(), ToolCallLog, toolCallLogs

### Community 62 - "Testes: config"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "Testes: groundingContract"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "Testes: jsonSchema"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

## Knowledge Gaps
- **342 isolated node(s):** `name`, `version`, `type`, `main`, `dev` (+337 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `Contabilização de tokens` to `Testes: hardening`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `Testes: hardening` to `Contabilização de tokens`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `Testes: audit` to `Testes: eventTrigger`, `Testes: schedulerPublish`, `Testes: agentHistory`, `Testes: routineDelivery`, `Testes: hardening`, `Testes: toolsSecurity`, `Testes: executionCenter`, `Testes: logRoutes`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `type` to the rest of the system?**
  _342 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Contabilização de tokens` be split into smaller, more focused modules?**
  _Cohesion score 0.053313587560162905 - nodes in this community are weakly interconnected._
- **Should `floors` be split into smaller, more focused modules?**
  _Cohesion score 0.06128364389233954 - nodes in this community are weakly interconnected._