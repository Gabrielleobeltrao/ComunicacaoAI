# Graph Report - backend  (2026-08-15)

## Corpus Check
- 164 files · ~164,177 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1647 nodes · 3654 edges · 114 communities (102 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0d30a878`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runProcessor.ts
- floors.ts
- openai.ts
- seedRestaurantDemo.ts
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
- tools.ts
- routineExecution.ts
- automations/repository.ts
- automations/service.ts
- dependencies
- agentMetrics.ts
- delegationWiring.ts
- resolveSectorTurn
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- agentLiveState.ts
- sectors.ts
- tokenUsage.ts
- engine.ts
- agentEvents.ts
- migration.ts
- runService.ts
- toolExecution.ts
- eventTrigger.integration.test.mjs
- migrate.ts
- connections/service.ts
- installations.ts
- scripts
- automations/types.ts
- package.json
- AutomationDefinition
- building.ts
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
- builtinTools.ts
- runRepository.ts
- collaboration.test.mjs
- collaboration.ts
- config.test.mjs
- groundingContract.test.mjs
- jsonSchema.test.mjs
- outputContract.test.mjs
- readiness.test.mjs
- automations.test.mjs
- dotenv
- express
- socket.io
- db.ts
- routine.test.mjs
- seedGuard.test.mjs
- grants.ts
- navigation.ts
- appManifest.test.mjs
- registry.ts
- appRoutes.integration.test.mjs
- agentLiveTracker.ts
- googleTools.ts
- safeHttp.ts
- appMigration.integration.test.mjs
- config.ts
- eventTrigger.ts
- safeError.ts
- toolsSecurity.test.mjs
- connections/types.ts
- agentLiveState.integration.test.mjs
- runQueue.integration.test.mjs
- agentPresets.ts
- sectorDecisions.ts

## God Nodes (most connected - your core abstractions)
1. `db` - 38 edges
2. `respondWithAgentIfLinked()` - 33 edges
3. `buildDeps()` - 26 edges
4. `encrypt()` - 26 edges
5. `getAgentById()` - 25 edges
6. `refreshMemoryAndIdentity()` - 23 edges
7. `productionDelegationDeps()` - 19 edges
8. `startMongo()` - 19 edges
9. `stopMongo()` - 19 edges
10. `getApp()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `getAgentById()`  [INFERRED]
  src/automations/runProcessor.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (114 total, 12 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.21
Nodes (18): runEventKey(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact(), insertStepRun() (+10 more)

### Community 1 - "floors.ts"
Cohesion: 0.14
Nodes (21): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), floorMetrics, BuildingLanguage, isValidTimezone(), collection, createFloor() (+13 more)

### Community 2 - "openai.ts"
Cohesion: 0.05
Nodes (93): AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask(), inputToText() (+85 more)

### Community 3 - "seedRestaurantDemo.ts"
Cohesion: 0.24
Nodes (12): SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member(), OWNED_COLLECTIONS (+4 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (50): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, chunks (+42 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (49): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+41 more)

### Community 6 - "index.ts"
Cohesion: 0.05
Nodes (33): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), app, AVATAR_MIME_TYPES (+25 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (36): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+28 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (43): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentTool, AgentToolHeader, AgentToolParam (+35 more)

### Community 9 - "googleCalendar.ts"
Cohesion: 0.20
Nodes (13): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), SCOPES, TokenResponse, deleteIntegration(), getIntegration() (+5 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.13
Nodes (15): agentReadiness(), AgentWiring, EMPTY_WIRING, ISSUE, normalizeActivation(), NormalizedActivation, Readiness, ReadinessCode (+7 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.10
Nodes (34): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+26 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (27): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+19 more)

### Community 13 - "apps/types.ts"
Cohesion: 0.10
Nodes (25): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+17 more)

### Community 14 - "delegation.ts"
Cohesion: 0.11
Nodes (32): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing (+24 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.12
Nodes (7): PAGE, startMongo(), stopMongo(), A, B, automations(), seedSchedule()

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.19
Nodes (22): getAgentById(), buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError, RoutineSpec (+14 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.14
Nodes (18): ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter(), InboundMediaRef, InboundMessage (+10 more)

### Community 18 - "tools.ts"
Cohesion: 0.09
Nodes (22): isValidToolSchema(), clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS (+14 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.15
Nodes (15): RecordAgentEventInput, AgentExecutionRequest, AgentExecutionResult, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineExecutionDeps (+7 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, signBody() (+4 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.21
Nodes (21): ensureActivationMode(), createEventTrigger(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), collectSectorRefs(), createAutomation(), defaultDefinition(), normalizeName() (+13 more)

### Community 22 - "dependencies"
Cohesion: 0.11
Nodes (19): @anthropic-ai/sdk, better-auth, cors, cron-parser, multer, nodemailer, openai, dependencies (+11 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "delegationWiring.ts"
Cohesion: 0.15
Nodes (17): resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), DelegationContext, col, DelegationFinish, DelegationRecord, DelegationStart (+9 more)

### Community 25 - "resolveSectorTurn"
Cohesion: 0.12
Nodes (18): setActiveAgentId(), auxModelFor(), buildStageTransitionOptions(), memberRoutingLine(), resolveSectorTurn(), auxiliaryModel(), checkGuardrail(), extractIdentity() (+10 more)

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
Cohesion: 0.07
Nodes (31): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 31 - "agentLiveState.ts"
Cohesion: 0.09
Nodes (26): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+18 more)

### Community 32 - "sectors.ts"
Cohesion: 0.11
Nodes (25): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+17 more)

### Community 33 - "tokenUsage.ts"
Cohesion: 0.20
Nodes (16): dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce(), settlePendingCharges() (+8 more)

### Community 34 - "engine.ts"
Cohesion: 0.10
Nodes (31): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+23 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.22
Nodes (10): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), recordAgentEvent() (+2 more)

### Community 36 - "migration.ts"
Cohesion: 0.19
Nodes (18): AgentBuiltinTool, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation(), ensureGoogleInstallations() (+10 more)

### Community 37 - "runService.ts"
Cohesion: 0.13
Nodes (18): createLiveTracker(), insertRunIdempotent(), createRun(), CreateRunInput, AutomationValidationError, AutomationVersion, canonical(), computeDefinitionHash() (+10 more)

### Community 38 - "toolExecution.ts"
Cohesion: 0.18
Nodes (13): decrypt(), getKey(), ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl() (+5 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "migrate.ts"
Cohesion: 0.17
Nodes (16): ensureAgentLiveStateIndexes(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), ensureBuildingIndexes(), ensureConnectionIndexes() (+8 more)

### Community 41 - "connections/service.ts"
Cohesion: 0.18
Nodes (12): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, isNonEmpty(), normalizeName(), patchConnection(), PROVIDERS, validateConfig() (+4 more)

### Community 42 - "installations.ts"
Cohesion: 0.11
Nodes (22): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installations, LEGACY_APP_VERSION, markInstallationTested(), normalizeConfig() (+14 more)

### Community 43 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, dev:api, dev:worker, seed:demo, start, start:api (+2 more)

### Community 44 - "automations/types.ts"
Cohesion: 0.18
Nodes (10): AutomationInput, AutomationLimits, DEFAULT_LIMITS, DeliveryTarget, ManualTrigger, RetryPolicy, ScheduleTrigger, STEP_TYPES (+2 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "AutomationDefinition"
Cohesion: 0.31
Nodes (10): CreateAutomationInput, UpdateDraftPatch, Automation, AutomationDefinition, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent() (+2 more)

### Community 47 - "building.ts"
Cohesion: 0.21
Nodes (11): buildingOverview(), Building, BuildingPatch, buildings, DEFAULT_TIMEZONE, ensureDefaultBuilding(), LANGUAGES, updateBuilding() (+3 more)

### Community 48 - "userSettings.ts"
Cohesion: 0.11
Nodes (18): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, getWidgetConfigAgent(), inboundMediaToText(), resolveOwnedSectorId(), Provider, transcribeImage(), requireSector() (+10 more)

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
Cohesion: 0.22
Nodes (3): connections, deliveries, sentDeliveriesByAgent()

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
Cohesion: 0.22
Nodes (14): APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, hubspotTools(), mercadoPagoTools() (+6 more)

### Community 59 - "runRepository.ts"
Cohesion: 0.13
Nodes (20): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+12 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "collaboration.ts"
Cohesion: 0.29
Nodes (11): callerPolicyFromLegacy(), CollaboratorCandidate, reachableCollaborators(), SectorCandidate, listAgents(), collaboratorContext, collaboratorCountFor(), serializeSector() (+3 more)

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 78 - "db.ts"
Cohesion: 0.18
Nodes (10): auth, config, db, mongoClient, AgentDoc, Sector, listToolCalls(), logToolCalls() (+2 more)

### Community 84 - "grants.ts"
Cohesion: 0.19
Nodes (17): Agent, AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate(), isVersionCompatible() (+9 more)

### Community 85 - "navigation.ts"
Cohesion: 0.16
Nodes (18): installationPublic(), listInstallations(), buildNavigation(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus, preferences (+10 more)

### Community 97 - "registry.ts"
Cohesion: 0.11
Nodes (14): email, getAppAction(), google, hubspot, LEGACY_ACTION_KEYS, LEGACY_APP_KEYS, mercadopago, nuvemshop (+6 more)

### Community 99 - "agentLiveTracker.ts"
Cohesion: 0.27
Nodes (7): AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail()

### Community 100 - "googleTools.ts"
Cohesion: 0.52
Nodes (5): getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 101 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 102 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 105 - "config.ts"
Cohesion: 0.22
Nodes (9): clientUrl, FeatureFlags, flags, isProduction, originList(), port, stripTrailingSlash(), urlVar() (+1 more)

### Community 106 - "eventTrigger.ts"
Cohesion: 0.36
Nodes (9): buildEventTriggerDefinition(), EventTriggerError, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), getAutomation() (+1 more)

### Community 107 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 109 - "connections/types.ts"
Cohesion: 0.24
Nodes (9): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), ConnectionStatus, Delivery, DeliveryStatus, EmailConfig (+1 more)

### Community 110 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 112 - "agentPresets.ts"
Cohesion: 0.36
Nodes (7): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, ActivationMode, AgentPreset, DelegationPolicy

### Community 113 - "sectorDecisions.ts"
Cohesion: 0.29
Nodes (6): aggregateSectorDecisions(), listSectorDecisionsForConversation(), logSectorDecision(), SectorDecision, SectorDecisionAggregate, sectorDecisions

## Knowledge Gaps
- **406 isolated node(s):** `AGENT_BUBBLE_STATES`, `TERMINAL_STATES`, `ACTIVE_TTL_MS`, `TERMINAL_TTL_MS`, `BLOCKED_TTL_MS` (+401 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`?**
  _High betweenness centrality (0.129) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `runProcessor.ts` to `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.129) - this node is a cross-community bridge._
- **Why does `db` connect `db.ts` to `floors.ts`, `seedRestaurantDemo.ts`, `knowledge.ts`, `executionCenter.ts`, `audit.ts`, `agents.ts`, `googleCalendar.ts`, `respondWithAgentIfLinked`, `tools.ts`, `automations/repository.ts`, `delegationWiring.ts`, `widgets.ts`, `agentLiveState.ts`, `sectors.ts`, `tokenUsage.ts`, `engine.ts`, `agentEvents.ts`, `migration.ts`, `migrate.ts`, `installations.ts`, `building.ts`, `userSettings.ts`, `connections/repository.ts`, `runRepository.ts`, `grants.ts`, `navigation.ts`, `sectorDecisions.ts`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AGENT_BUBBLE_STATES`, `TERMINAL_STATES`, `ACTIVE_TTL_MS` to the rest of the system?**
  _406 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14492753623188406 - nodes in this community are weakly interconnected._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.051446321102698506 - nodes in this community are weakly interconnected._