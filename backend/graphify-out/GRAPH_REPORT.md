# Graph Report - backend  (2026-08-15)

## Corpus Check
- 180 files · ~182,894 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1812 nodes · 3997 edges · 121 communities (106 shown, 15 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6bc7d61b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runProcessor.ts
- db
- openai.ts
- sectorExecutions.ts
- knowledge.ts
- executionCenter.ts
- index.ts
- audit.ts
- agents.ts
- googleCalendar.ts
- agentReadiness.ts
- respondWithAgentIfLinked
- runner.ts
- apps/types.ts
- delegation.ts
- mongoServer.mjs
- agentRoutineRoutes.ts
- whatsapp.ts
- automationRoutes.ts
- routineExecution.ts
- automations/repository.ts
- automations/service.ts
- dependencies
- agentMetrics.ts
- agentTools.ts
- llm.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- agentLiveState.ts
- sectors.ts
- Agent
- engine.ts
- agentEvents.ts
- registry.ts
- validate.ts
- tools.ts
- eventTrigger.integration.test.mjs
- toolsSecurity.test.mjs
- connections/service.ts
- installations.ts
- scripts
- automations/types.ts
- package.json
- floorCommunication.ts
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
- grants.ts
- runRepository.ts
- collaboration.test.mjs
- jsonSchema.ts
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
- webhookRoutes.ts
- navigation.ts
- appManifest.test.mjs
- offices.ts
- appRoutes.integration.test.mjs
- executionRoots.ts
- seedRestaurantDemo.ts
- sectorAccess.ts
- appMigration.integration.test.mjs
- hardening.integration.test.mjs
- migrate.ts
- migrationFixture.integration.test.mjs
- safeError.ts
- delegationWiring.ts
- toolCallLog.ts
- agentLiveState.integration.test.mjs
- scheduler.integration.test.mjs
- db.ts
- sectorExecutions.integration.test.mjs
- config.ts
- collaborationGate.test.mjs
- executionRoots.integration.test.mjs
- runService.ts
- agentLiveTracker.ts
- runQueue.integration.test.mjs
- selectVisualStates

## God Nodes (most connected - your core abstractions)
1. `db` - 44 edges
2. `respondWithAgentIfLinked()` - 33 edges
3. `buildDeps()` - 28 edges
4. `encrypt()` - 26 edges
5. `productionDelegationDeps()` - 25 edges
6. `getAgentById()` - 25 edges
7. `startMongo()` - 25 edges
8. `stopMongo()` - 25 edges
9. `refreshMemoryAndIdentity()` - 23 edges
10. `runMigrations()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts
- `buildDeps()` --indirect_call--> `getAgentById()`  [INFERRED]
  src/automations/runProcessor.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (121 total, 15 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.16
Nodes (25): runEventKey(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact(), insertStepRun() (+17 more)

### Community 1 - "db"
Cohesion: 0.09
Nodes (38): agentStatesForFloor(), buildingOverview(), floorMetrics, Building, BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE (+30 more)

### Community 2 - "openai.ts"
Cohesion: 0.08
Nodes (65): MAX_TOOL_ITERATIONS, ToolCallRecord, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractIdentity(), extractStructuredOutput() (+57 more)

### Community 3 - "sectorExecutions.ts"
Cohesion: 0.09
Nodes (27): resolveOwnedSectorId(), PERIODS, requireSector(), sectorExecutionRouter, requireSector(), agentEvents, durationOf(), ExecutionEnvironment (+19 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (48): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, chunks (+40 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (50): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+42 more)

### Community 6 - "index.ts"
Cohesion: 0.05
Nodes (37): ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), validateConfig(), app, AVATAR_MIME_TYPES, channelWebhookUrl() (+29 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (43): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentTool, AgentToolHeader, AgentToolParam (+35 more)

### Community 9 - "googleCalendar.ts"
Cohesion: 0.16
Nodes (18): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), SCOPES, TokenResponse, googleCalendarTools() (+10 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (31): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+23 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.08
Nodes (41): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+33 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (28): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+20 more)

### Community 13 - "apps/types.ts"
Cohesion: 0.08
Nodes (39): describeManifestIssues(), exportableManifest(), FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest() (+31 more)

### Community 14 - "delegation.ts"
Cohesion: 0.11
Nodes (33): presetSpec(), suggestPresetForCapability(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing, checkDelegation() (+25 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.10
Nodes (8): PAGE, startMongo(), stopMongo(), A, B, COORD, OUTSIDER, STAGE_AGENT

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.17
Nodes (25): getAgentById(), getEventTriggerForAgent(), updateEventTrigger(), buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines() (+17 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (21): extractTextFromFile(), getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia() (+13 more)

### Community 18 - "automationRoutes.ts"
Cohesion: 0.20
Nodes (5): AutomationValidationError, AutomationVersion, ValidationIssue, ValidationError, automationRouter

### Community 19 - "routineExecution.ts"
Cohesion: 0.15
Nodes (14): RecordAgentEventInput, AgentExecutionRequest, AgentExecutionResult, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineExecutionDeps (+6 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.17
Nodes (7): automations, listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, wiringForAgent()

### Community 21 - "automations/service.ts"
Cohesion: 0.15
Nodes (27): createEventTrigger(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName() (+19 more)

### Community 22 - "dependencies"
Cohesion: 0.11
Nodes (19): @anthropic-ai/sdk, better-auth, cors, cron-parser, multer, nodemailer, openai, dependencies (+11 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "agentTools.ts"
Cohesion: 0.15
Nodes (21): AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+13 more)

### Community 25 - "llm.ts"
Cohesion: 0.11
Nodes (24): SUPPORTED_IMAGE_TYPES, auxiliaryModel(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), generateAgentReply(), listModelsForProvider(), planSectorResponse() (+16 more)

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
Cohesion: 0.11
Nodes (23): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS, clearAgentState() (+15 more)

### Community 32 - "sectors.ts"
Cohesion: 0.11
Nodes (24): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+16 more)

### Community 33 - "Agent"
Cohesion: 0.21
Nodes (11): Agent, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows() (+3 more)

### Community 34 - "engine.ts"
Cohesion: 0.16
Nodes (17): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+9 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.20
Nodes (11): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, backfillAgentEventAttempts(), finalizeAgentEvent(), finalizeAgentEventSafe() (+3 more)

### Community 36 - "registry.ts"
Cohesion: 0.08
Nodes (32): AgentBuiltinTool, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation(), ensureGoogleInstallations() (+24 more)

### Community 37 - "validate.ts"
Cohesion: 0.36
Nodes (9): canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord(), validateDefinition(), validateStepConfig() (+1 more)

### Community 38 - "tools.ts"
Cohesion: 0.06
Nodes (40): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult (+32 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 41 - "connections/service.ts"
Cohesion: 0.14
Nodes (17): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, decryptConfig(), getConnection(), isNonEmpty(), normalizeName(), patchConnection() (+9 more)

### Community 42 - "installations.ts"
Cohesion: 0.16
Nodes (18): createInstallation(), CreateInstallationInput, getInstallation(), installations, LEGACY_APP_VERSION, normalizeConfig(), normalizeName(), patchInstallation() (+10 more)

### Community 43 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, dev:api, dev:worker, seed:demo, start, start:api (+2 more)

### Community 44 - "automations/types.ts"
Cohesion: 0.15
Nodes (15): buildEventTriggerDefinition(), EventTriggerError, EventTriggerSpec, isEventTrigger(), listEventTriggers(), AutomationInput, AutomationLimits, DEFAULT_LIMITS (+7 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "floorCommunication.ts"
Cohesion: 0.24
Nodes (9): buildings, COMMUNICATION_LABEL, communicationConfigOf(), FLOOR_COMMUNICATION_MODES, FloorCommunicationMode, FloorLink, FloorLinkDirection, getFloorCommunication() (+1 more)

### Community 47 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 48 - "tokenUsage.ts"
Cohesion: 0.20
Nodes (16): dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce(), settlePendingCharges() (+8 more)

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
Cohesion: 0.17
Nodes (6): connections, deliveries, insertDeliveryIdempotent(), listDeliveries(), sentDeliveriesByAgent(), updateDelivery()

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

### Community 58 - "grants.ts"
Cohesion: 0.10
Nodes (36): ResolvedTool, AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate(), isVersionCompatible() (+28 more)

### Community 59 - "runRepository.ts"
Cohesion: 0.14
Nodes (19): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+11 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "jsonSchema.ts"
Cohesion: 0.39
Nodes (7): join(), matchesType(), Schema, SchemaError, typeOf(), validateNode(), ValidationResult

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
Nodes (11): deleteInstallation(), markInstallationTested(), AgentAppGrant, googleConfigured(), appGrantRouter, appInstallationRouter, auditEntity(), connectionRouter (+3 more)

### Community 84 - "webhookRoutes.ts"
Cohesion: 0.43
Nodes (5): findByWebhookKey(), signBody(), verifySignature(), webhookIdempotencyKey(), webhookRouter

### Community 85 - "navigation.ts"
Cohesion: 0.16
Nodes (18): installationPublic(), listInstallations(), buildNavigation(), dropPinsForApp(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus (+10 more)

### Community 97 - "offices.ts"
Cohesion: 0.33
Nodes (4): createOffice(), ensureDefaultOffice(), Office, offices

### Community 99 - "executionRoots.ts"
Cohesion: 0.15
Nodes (16): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, executionAnalytics(), executionBreakdown(), ExecutionEnvironment (+8 more)

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
Cohesion: 0.24
Nodes (15): ensureAgentLiveStateIndexes(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureBuildingIndexes(), ensureConnectionIndexes() (+7 more)

### Community 106 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 107 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 108 - "delegationWiring.ts"
Cohesion: 0.15
Nodes (15): agentCanDelegate(), capabilityMissingTool(), DelegationContext, DelegationDeps, col, DelegationFinish, DelegationRecord, DelegationStart (+7 more)

### Community 109 - "toolCallLog.ts"
Cohesion: 0.40
Nodes (4): listToolCalls(), logToolCalls(), ToolCallLog, toolCallLogs

### Community 110 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 112 - "db.ts"
Cohesion: 0.22
Nodes (8): auth, config, mongoClient, AgentDoc, Sector, main(), STARTUP_PROBE_MS, withinTimeout()

### Community 114 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 116 - "config.ts"
Cohesion: 0.24
Nodes (8): clientUrl, FeatureFlags, flags, isProduction, originList(), port, stripTrailingSlash(), urlVar()

### Community 119 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 120 - "runService.ts"
Cohesion: 0.18
Nodes (18): createLiveTracker(), findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, advanceFrom(), catchUp(), nextFireAt() (+10 more)

### Community 121 - "agentLiveTracker.ts"
Cohesion: 0.27
Nodes (7): AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail()

### Community 126 - "selectVisualStates"
Cohesion: 0.33
Nodes (5): agentLiveStatesForFloor(), rank(), selectVisualStates(), NOW, row()

## Knowledge Gaps
- **475 isolated node(s):** `AGENT`, `WIDGET`, `WA_CHANNEL`, `SECTOR`, `FLOOR` (+470 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.162) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `runProcessor.ts`?**
  _High betweenness centrality (0.161) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `appRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `hardening.integration.test.mjs`, `toolsSecurity.test.mjs`, `migrationFixture.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `floorWork.integration.test.mjs`, `scheduler.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `runQueue.integration.test.mjs`, `agentHistory.integration.test.mjs`, `executionRoots.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `productionDelegationDeps()` (e.g. with `finishDelegation()` and `startDelegation()`) actually correct?**
  _`productionDelegationDeps()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AGENT`, `WIDGET`, `WA_CHANNEL` to the rest of the system?**
  _475 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `db` be split into smaller, more focused modules?**
  _Cohesion score 0.09435707678075855 - nodes in this community are weakly interconnected._