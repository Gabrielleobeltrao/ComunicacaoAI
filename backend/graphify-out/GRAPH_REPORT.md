# Graph Report - backend  (2026-08-15)

## Corpus Check
- 174 files · ~176,785 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1751 nodes · 3860 edges · 120 communities (106 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e1e33051`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runProcessor.ts
- floors.ts
- openai.ts
- sectorExecutions.ts
- knowledge.ts
- executionCenter.ts
- index.ts
- audit.ts
- agents.ts
- encrypt
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
- agentRuntime.ts
- llm.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- agentLiveState.ts
- sectors.ts
- floorCommunication.ts
- engine.ts
- agentEvents.ts
- migration.ts
- validate.ts
- toolExecution.ts
- eventTrigger.integration.test.mjs
- toolsSecurity.test.mjs
- connections/service.ts
- installations.ts
- scripts
- automations/types.ts
- package.json
- webhookTriggers.ts
- floorWork.integration.test.mjs
- tokenUsage.ts
- delegation.test.mjs
- runnerTimeout.test.mjs
- runtimeHardening.test.mjs
- schedulerPublish.integration.test.mjs
- connections/repository.ts
- agentHistory.integration.test.mjs
- auditRouteMap.test.mjs
- routineDelivery.integration.test.mjs
- deployment.test.mjs
- builtinTools.ts
- runRepository.ts
- collaboration.test.mjs
- agentTools.ts
- config.test.mjs
- groundingContract.test.mjs
- jsonSchema.test.mjs
- outputContract.test.mjs
- readiness.test.mjs
- automations.test.mjs
- dotenv
- express
- socket.io
- appInstallationRoutes.ts
- routine.test.mjs
- seedGuard.test.mjs
- grants.ts
- navigation.ts
- appManifest.test.mjs
- registry.ts
- appRoutes.integration.test.mjs
- agentLiveTracker.ts
- seedRestaurantDemo.ts
- sectorAccess.ts
- appMigration.integration.test.mjs
- hardening.integration.test.mjs
- migrate.ts
- eventTrigger.ts
- safeError.ts
- delegationWiring.ts
- runService.ts
- agentLiveState.integration.test.mjs
- floorWork.ts
- db.ts
- building.ts
- sectorExecutions.integration.test.mjs
- ResolvedTool
- offices.ts
- sectorAccess.integration.test.mjs
- collaborationGate.test.mjs
- GroundingRequiredError

## God Nodes (most connected - your core abstractions)
1. `db` - 42 edges
2. `respondWithAgentIfLinked()` - 33 edges
3. `buildDeps()` - 26 edges
4. `encrypt()` - 26 edges
5. `productionDelegationDeps()` - 25 edges
6. `getAgentById()` - 25 edges
7. `refreshMemoryAndIdentity()` - 23 edges
8. `startMongo()` - 22 edges
9. `stopMongo()` - 22 edges
10. `getApp()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `productionDelegationDeps()` --indirect_call--> `finishDelegation()`  [INFERRED]
  src/delegationWiring.ts → src/delegationLog.ts
- `productionDelegationDeps()` --indirect_call--> `startDelegation()`  [INFERRED]
  src/delegationWiring.ts → src/delegationLog.ts
- `buildDeps()` --indirect_call--> `resolveOwnedSectorId()`  [INFERRED]
  src/automations/runProcessor.ts → src/sectors.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (120 total, 14 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.17
Nodes (23): runEventKey(), createLiveTracker(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact() (+15 more)

### Community 1 - "floors.ts"
Cohesion: 0.16
Nodes (23): agentStatesForFloor(), buildingOverview(), floorMetrics, ensureDefaultBuilding(), collection, createFloor(), deleteFloor(), DeleteFloorResult (+15 more)

### Community 2 - "openai.ts"
Cohesion: 0.07
Nodes (68): MAX_TOOL_ITERATIONS, ToolCallRecord, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractIdentity(), extractStructuredOutput() (+60 more)

### Community 3 - "sectorExecutions.ts"
Cohesion: 0.11
Nodes (23): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, finishSectorExecution() (+15 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.05
Nodes (54): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, resolveOwnedSectorId() (+46 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.08
Nodes (48): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+40 more)

### Community 6 - "index.ts"
Cohesion: 0.05
Nodes (35): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), app, AVATAR_MIME_TYPES, channelWebhookUrl() (+27 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (42): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentToolHeader, AgentToolParam, CONVERSATION_PERSISTENCE_TYPES (+34 more)

### Community 9 - "encrypt"
Cohesion: 0.12
Nodes (25): revokeInstallation(), decrypt(), encrypt(), getKey(), buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken() (+17 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (31): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+23 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.09
Nodes (35): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+27 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (27): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+19 more)

### Community 13 - "apps/types.ts"
Cohesion: 0.10
Nodes (24): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+16 more)

### Community 14 - "delegation.ts"
Cohesion: 0.12
Nodes (32): presetSpec(), suggestPresetForCapability(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing, checkDelegation() (+24 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.11
Nodes (9): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), automations() (+1 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.23
Nodes (19): buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError, RoutineSpec, updateRoutine() (+11 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (21): extractTextFromFile(), getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia() (+13 more)

### Community 18 - "tools.ts"
Cohesion: 0.10
Nodes (20): clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS, TOOL_LIMITS (+12 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.17
Nodes (13): AgentExecutionRequest, AgentExecutionResult, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineExecutionDeps, RoutineRunContext (+5 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, signBody() (+4 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.19
Nodes (19): getAgentById(), createEventTrigger(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), collectSectorRefs(), createAutomation(), defaultDefinition(), normalizeName() (+11 more)

### Community 22 - "dependencies"
Cohesion: 0.11
Nodes (19): @anthropic-ai/sdk, better-auth, cors, cron-parser, multer, nodemailer, openai, dependencies (+11 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "agentRuntime.ts"
Cohesion: 0.21
Nodes (13): AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+5 more)

### Community 25 - "llm.ts"
Cohesion: 0.13
Nodes (23): setActiveAgentId(), SUPPORTED_IMAGE_TYPES, auxModelFor(), buildStageTransitionOptions(), memberRoutingLine(), resolveSectorTurn(), auxiliaryModel(), checkGuardrail() (+15 more)

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

### Community 30 - "widgets.ts"
Cohesion: 0.08
Nodes (32): ensureActivationMode(), addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel() (+24 more)

### Community 31 - "agentLiveState.ts"
Cohesion: 0.09
Nodes (27): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+19 more)

### Community 32 - "sectors.ts"
Cohesion: 0.11
Nodes (24): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+16 more)

### Community 33 - "floorCommunication.ts"
Cohesion: 0.12
Nodes (21): Building, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows() (+13 more)

### Community 34 - "engine.ts"
Cohesion: 0.07
Nodes (40): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+32 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.20
Nodes (11): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), recordAgentEvent() (+3 more)

### Community 36 - "migration.ts"
Cohesion: 0.16
Nodes (21): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+13 more)

### Community 37 - "validate.ts"
Cohesion: 0.26
Nodes (10): AutomationValidationError, STEP_TYPES, hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord(), validateDefinition(), validateStepConfig() (+2 more)

### Community 38 - "toolExecution.ts"
Cohesion: 0.14
Nodes (18): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult (+10 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 41 - "connections/service.ts"
Cohesion: 0.16
Nodes (15): createConnection(), CreateConnectionInput, decryptConfig(), isNonEmpty(), normalizeName(), patchConnection(), PROVIDERS, validateConfig() (+7 more)

### Community 42 - "installations.ts"
Cohesion: 0.16
Nodes (15): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installations, markInstallationTested(), normalizeConfig(), normalizeName() (+7 more)

### Community 43 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, dev:api, dev:worker, seed:demo, start, start:api (+2 more)

### Community 44 - "automations/types.ts"
Cohesion: 0.15
Nodes (15): AutomationRun, SafeRunError, CreateAutomationInput, UpdateDraftPatch, AutomationDefinition, AutomationInput, AutomationLimits, DEFAULT_LIMITS (+7 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "webhookTriggers.ts"
Cohesion: 0.42
Nodes (8): syncEventTriggerFor(), Automation, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent(), liveWebhookCountFor(), PublishedAutomation

### Community 47 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 48 - "tokenUsage.ts"
Cohesion: 0.17
Nodes (18): TokenUsage, attemptChargeKey(), dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage() (+10 more)

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
Cohesion: 0.20
Nodes (4): connections, deliveries, sentDeliveriesByAgent(), updateDelivery()

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

### Community 58 - "builtinTools.ts"
Cohesion: 0.15
Nodes (21): resolveHttpTool(), resolveAppGrantTools(), APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField (+13 more)

### Community 59 - "runRepository.ts"
Cohesion: 0.14
Nodes (17): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+9 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "agentTools.ts"
Cohesion: 0.19
Nodes (16): AgentTool, legacyToolToExecutable(), runResolvedTool(), toolInputSchema(), checkStageOutput(), describeErrors(), join(), matchesType() (+8 more)

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 78 - "appInstallationRoutes.ts"
Cohesion: 0.18
Nodes (10): dropPinsForApp(), AgentAppGrant, CONNECTION_CATALOG, appGrantRouter, appInstallationRouter, cleanUpPins(), auditEntity(), connectionRouter (+2 more)

### Community 84 - "grants.ts"
Cohesion: 0.22
Nodes (15): missingCapability(), AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate(), isVersionCompatible() (+7 more)

### Community 85 - "navigation.ts"
Cohesion: 0.16
Nodes (18): installationPublic(), listInstallations(), buildNavigation(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus, preferences (+10 more)

### Community 97 - "registry.ts"
Cohesion: 0.12
Nodes (12): email, google, hubspot, LEGACY_APP_KEYS, mercadopago, nuvemshop, rdstation, slack (+4 more)

### Community 99 - "agentLiveTracker.ts"
Cohesion: 0.24
Nodes (8): AgentBubbleState, finishAgentState(), catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail()

### Community 100 - "seedRestaurantDemo.ts"
Cohesion: 0.22
Nodes (14): createAgent(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main() (+6 more)

### Community 101 - "sectorAccess.ts"
Cohesion: 0.20
Nodes (15): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+7 more)

### Community 102 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 105 - "migrate.ts"
Cohesion: 0.26
Nodes (14): ensureAgentLiveStateIndexes(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), ensureBuildingIndexes(), ensureConnectionIndexes() (+6 more)

### Community 106 - "eventTrigger.ts"
Cohesion: 0.36
Nodes (9): buildEventTriggerDefinition(), EventTriggerError, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), getAutomation() (+1 more)

### Community 107 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 108 - "delegationWiring.ts"
Cohesion: 0.15
Nodes (15): agentCanDelegate(), capabilityMissingTool(), DelegationContext, DelegationDeps, col, DelegationFinish, DelegationRecord, DelegationStart (+7 more)

### Community 109 - "runService.ts"
Cohesion: 0.20
Nodes (9): findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, AutomationVersion, canonical(), computeDefinitionHash(), ValidationError (+1 more)

### Community 110 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 111 - "floorWork.ts"
Cohesion: 0.31
Nodes (8): Agent, Floor, agents, competencyOf(), effectiveTargets(), FloorTarget, floorWorkOverview, sectors

### Community 112 - "db.ts"
Cohesion: 0.33
Nodes (5): auth, db, mongoClient, AgentDoc, Sector

### Community 113 - "building.ts"
Cohesion: 0.25
Nodes (7): BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE, isValidTimezone(), LANGUAGES, updateBuilding()

### Community 114 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 115 - "ResolvedTool"
Cohesion: 0.48
Nodes (5): ResolvedTool, googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 116 - "offices.ts"
Cohesion: 0.33
Nodes (4): createOffice(), ensureDefaultOffice(), Office, offices

### Community 117 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

## Knowledge Gaps
- **449 isolated node(s):** `CollaborationDenyCode`, `CollaborationDecision`, `GateContext`, `GateTarget`, `DELEGATION_MAX_DEPTH` (+444 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `tokenUsage.ts` to `runProcessor.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.136) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `tokenUsage.ts`?**
  _High betweenness centrality (0.136) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `appRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `hardening.integration.test.mjs`, `toolsSecurity.test.mjs`, `agentLiveState.integration.test.mjs`, `floorWork.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `productionDelegationDeps()` (e.g. with `finishDelegation()` and `startDelegation()`) actually correct?**
  _`productionDelegationDeps()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `CollaborationDenyCode`, `CollaborationDecision`, `GateContext` to the rest of the system?**
  _449 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07120500782472614 - nodes in this community are weakly interconnected._