# Graph Report - backend  (2026-08-15)

## Corpus Check
- 148 files · ~144,772 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1474 nodes · 3217 edges · 100 communities (89 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 26 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `547e7f03`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runProcessor.ts
- db.ts
- openai.ts
- runRepository.ts
- knowledge.ts
- executionCenter.ts
- index.ts
- audit.ts
- agents.ts
- builtinTools.ts
- agentReadiness.ts
- respondWithAgentIfLinked
- runner.ts
- apps/types.ts
- delegation.ts
- mongoServer.mjs
- agentRoutineRoutes.ts
- whatsapp.ts
- tools.ts
- routineExecution.ts
- automations/repository.ts
- automations/service.ts
- dependencies
- agentMetrics.ts
- delegationWiring.ts
- llm.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- agentRuntime.ts
- resolveSectorTurn
- sectors.ts
- tokenUsage.ts
- engine.ts
- agentEvents.ts
- jsonSchema.ts
- validate.ts
- toolExecution.ts
- eventTrigger.integration.test.mjs
- eventTrigger.ts
- connections/service.ts
- sectorKnowledgeRoutes.ts
- scripts
- automations/types.ts
- package.json
- webhookTriggers.ts
- scheduler.ts
- userSettings.ts
- delegation.test.mjs
- runnerTimeout.test.mjs
- runtimeHardening.test.mjs
- schedulerPublish.integration.test.mjs
- connections/repository.ts
- agentHistory.integration.test.mjs
- auditRouteMap.test.mjs
- routineDelivery.integration.test.mjs
- deployment.test.mjs
- hardening.integration.test.mjs
- toolsSecurity.test.mjs
- collaboration.test.mjs
- toolCallLog.ts
- config.test.mjs
- groundingContract.test.mjs
- jsonSchema.test.mjs
- outputContract.test.mjs
- readiness.test.mjs
- automations.test.mjs
- dotenv
- express
- socket.io
- conversationTurns.ts
- routine.test.mjs
- seedGuard.test.mjs
- start
- safeError.ts
- appManifest.test.mjs
- runService.ts
- createDocumentFor
- decrypt

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
- `resolveAgentTools()` --indirect_call--> `resolveHttpTool()`  [INFERRED]
  src/builtinTools.ts → src/agentTools.ts
- `buildDeps()` --indirect_call--> `runEventKey()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (100 total, 11 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.21
Nodes (17): buildDeps(), processRun(), findRunUnscoped(), insertArtifact(), insertStepRun(), updateRun(), preview(), chunkTelegram() (+9 more)

### Community 1 - "db.ts"
Cohesion: 0.06
Nodes (51): agentStatesForFloor(), buildingOverview(), floorMetrics, ensureAutomationIndexes(), Building, BuildingLanguage, BuildingPatch, buildings (+43 more)

### Community 2 - "openai.ts"
Cohesion: 0.07
Nodes (70): legacyToolToExecutable(), MAX_TOOL_ITERATIONS, missingCapability(), resolveHttpTool(), runResolvedTool(), ToolCallRecord, toolInputSchema(), anthropicUsage() (+62 more)

### Community 3 - "runRepository.ts"
Cohesion: 0.14
Nodes (17): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+9 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.10
Nodes (23): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), documents, EMBEDDING_DIMENSIONS (+15 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.08
Nodes (48): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+40 more)

### Community 6 - "index.ts"
Cohesion: 0.04
Nodes (54): stopEmbeddedEngine(), getBuiltinApp(), app, AVATAR_MIME_TYPES, channelWebhookUrl(), httpServer, io, isValidWebhookUrl() (+46 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (44): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentBuiltinTool, AgentModelFields, agents, AgentTool, AgentToolHeader (+36 more)

### Community 9 - "builtinTools.ts"
Cohesion: 0.09
Nodes (34): ResolvedTool, APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, buildGoogleAuthUrl() (+26 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.08
Nodes (34): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+26 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.10
Nodes (34): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+26 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (27): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+19 more)

### Community 13 - "apps/types.ts"
Cohesion: 0.08
Nodes (30): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+22 more)

### Community 14 - "delegation.ts"
Cohesion: 0.12
Nodes (31): presetSpec(), suggestPresetForCapability(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing, checkDelegation() (+23 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.13
Nodes (9): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), automations() (+1 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.22
Nodes (21): ensureActivationMode(), getAgentById(), createEventTrigger(), buildRoutineDefinition(), createRoutine(), listAgentAutomations(), listRoutines(), RoutineError (+13 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "tools.ts"
Cohesion: 0.06
Nodes (33): auth, clientUrl, config, FeatureFlags, flags, isProduction, originList(), port (+25 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.16
Nodes (16): RecordAgentEventInput, AgentExecutionRequest, AgentExecutionResult, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineExecutionDeps (+8 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.12
Nodes (13): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+5 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.19
Nodes (17): assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName(), requireFloor() (+9 more)

### Community 22 - "dependencies"
Cohesion: 0.11
Nodes (19): @anthropic-ai/sdk, better-auth, cors, cron-parser, multer, nodemailer, openai, dependencies (+11 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "delegationWiring.ts"
Cohesion: 0.16
Nodes (17): resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), DelegationContext, col, DelegationFinish, DelegationRecord, DelegationStart (+9 more)

### Community 25 - "llm.ts"
Cohesion: 0.16
Nodes (19): Agent, extractTextFromFile(), SUPPORTED_IMAGE_TYPES, SectorTurn, auxiliaryModel(), checkGuardrail(), extractIdentity(), extractStructuredOutput() (+11 more)

### Community 26 - "devDependencies"
Cohesion: 0.12
Nodes (17): mongodb-memory-server, devDependencies, mongodb-memory-server, tsx, @types/cors, @types/express, @types/multer, @types/node (+9 more)

### Community 27 - "compilerOptions"
Cohesion: 0.12
Nodes (15): ES2022, src, compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+7 more)

### Community 28 - "executionCenter.integration.test.mjs"
Cohesion: 0.17
Nodes (15): AGENT_A, AGENT_B, agents(), automations(), FLOOR_A, FLOOR_B, floors(), NOW (+7 more)

### Community 29 - "logRoutes.integration.test.mjs"
Cohesion: 0.14
Nodes (7): AGENT, AUTOMATION, call(), FLOOR, json(), runs(), seedRun()

### Community 30 - "agentRuntime.ts"
Cohesion: 0.21
Nodes (13): AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+5 more)

### Community 31 - "resolveSectorTurn"
Cohesion: 0.14
Nodes (13): setActiveAgentId(), auxModelFor(), buildStageTransitionOptions(), memberRoutingLine(), resolveSectorTurn(), aggregateSectorDecisions(), listSectorDecisionsForConversation(), logSectorDecision() (+5 more)

### Community 32 - "sectors.ts"
Cohesion: 0.07
Nodes (39): mongoClient, AgentDoc, SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main() (+31 more)

### Community 33 - "tokenUsage.ts"
Cohesion: 0.17
Nodes (18): attemptChargeKey(), dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage() (+10 more)

### Community 34 - "engine.ts"
Cohesion: 0.14
Nodes (20): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+12 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.20
Nodes (11): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), recordAgentEvent() (+3 more)

### Community 36 - "jsonSchema.ts"
Cohesion: 0.31
Nodes (10): checkStageOutput(), describeErrors(), join(), matchesType(), Schema, SchemaError, typeOf(), validateAgainstSchema() (+2 more)

### Community 37 - "validate.ts"
Cohesion: 0.29
Nodes (11): publishAutomation(), sameTrigger(), canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord() (+3 more)

### Community 38 - "toolExecution.ts"
Cohesion: 0.13
Nodes (19): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult (+11 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "eventTrigger.ts"
Cohesion: 0.31
Nodes (10): buildEventTriggerDefinition(), EventTriggerError, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), getRoutineForAgent() (+2 more)

### Community 41 - "connections/service.ts"
Cohesion: 0.18
Nodes (14): createConnection(), CreateConnectionInput, isNonEmpty(), normalizeName(), patchConnection(), PROVIDERS, validateConfig(), Connection (+6 more)

### Community 42 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.16
Nodes (12): resolveOwnedSectorId(), deleteDocument(), deleteDocumentFor(), getDocument(), getDocumentFor(), KnowledgeDocument, listDocuments(), listDocumentsFor() (+4 more)

### Community 43 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, dev:api, dev:worker, seed:demo, start, start:api (+2 more)

### Community 44 - "automations/types.ts"
Cohesion: 0.20
Nodes (9): AutomationInput, AutomationLimits, DEFAULT_LIMITS, DeliveryTarget, ManualTrigger, RetryPolicy, ScheduleTrigger, STEP_TYPES (+1 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "webhookTriggers.ts"
Cohesion: 0.42
Nodes (8): syncEventTriggerFor(), Automation, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent(), liveWebhookCountFor(), PublishedAutomation

### Community 47 - "scheduler.ts"
Cohesion: 0.27
Nodes (11): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, planSchedules(), runDueSchedules() (+3 more)

### Community 48 - "userSettings.ts"
Cohesion: 0.22
Nodes (8): clearProviderApiKey(), FIELD_BY_PROVIDER, getMonthlyTokenCap(), getProviderKeyStatus(), setMonthlyTokenCap(), setProviderApiKey(), settings, UserSettings

### Community 49 - "delegation.test.mjs"
Cohesion: 0.22
Nodes (4): B, BUILDING, FLOOR_A, FLOOR_B

### Community 50 - "runnerTimeout.test.mjs"
Cohesion: 0.25
Nodes (3): AGENT_ID, baseDeps(), runnerFor()

### Community 51 - "runtimeHardening.test.mjs"
Cohesion: 0.28
Nodes (6): AGENT_ID, delegateTo(), dispatch(), FLOOR, SECTOR_ID, targetAgent()

### Community 52 - "schedulerPublish.integration.test.mjs"
Cohesion: 0.39
Nodes (6): automations(), definition(), editDraft(), seedPublished(), step(), versions()

### Community 53 - "connections/repository.ts"
Cohesion: 0.18
Nodes (5): connections, deliveries, listDeliveries(), sentDeliveriesByAgent(), updateDelivery()

### Community 54 - "agentHistory.integration.test.mjs"
Cohesion: 0.25
Nodes (4): AGENT, FLOOR, OTHER_AGENT, ROUTINE

### Community 55 - "auditRouteMap.test.mjs"
Cohesion: 0.29
Nodes (5): ACTIONS, declaredRoutes(), readSource(), ROUTER_PREFIX, SOURCE_DIR

### Community 56 - "routineDelivery.integration.test.mjs"
Cohesion: 0.25
Nodes (4): AGENT, BUILDING, CONNECTION, FLOOR

### Community 57 - "deployment.test.mjs"
Cohesion: 0.29
Nodes (4): compose, coolify, envExample, pkg

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "toolCallLog.ts"
Cohesion: 0.40
Nodes (4): listToolCalls(), logToolCalls(), ToolCallLog, toolCallLogs

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 78 - "conversationTurns.ts"
Cohesion: 0.25
Nodes (9): ConversationTurn, EMBEDDING_DIMENSIONS, recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText(), embedTexts() (+1 more)

### Community 84 - "start"
Cohesion: 0.22
Nodes (9): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), ensureExecutionIndexes(), ensureConversationTurnsVectorIndex(), start(), backfillKnowledgeOwners(), ensureKnowledgeIndexes() (+1 more)

### Community 85 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 97 - "runService.ts"
Cohesion: 0.48
Nodes (6): findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, AutomationRun, TriggerType

### Community 98 - "createDocumentFor"
Cohesion: 0.29
Nodes (7): chunkText(), createDocument(), createDocumentFor(), indexDocumentChunks(), reindexDocumentFor(), updateDocument(), updateDocumentFor()

### Community 99 - "decrypt"
Cohesion: 0.50
Nodes (4): decryptConfig(), decrypt(), getKey(), getProviderApiKey()

## Knowledge Gaps
- **360 isolated node(s):** `ManifestIssue`, `ManifestValidation`, `FORBIDDEN_IN_TEMPLATE`, `AppAuthKind`, `AppStatus` (+355 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `tokenUsage.ts` to `runProcessor.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `tokenUsage.ts`?**
  _High betweenness centrality (0.147) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `eventTrigger.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `hardening.integration.test.mjs`, `toolsSecurity.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ManifestIssue`, `ManifestValidation`, `FORBIDDEN_IN_TEMPLATE` to the rest of the system?**
  _360 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `db.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06438631790744467 - nodes in this community are weakly interconnected._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07063063063063063 - nodes in this community are weakly interconnected._