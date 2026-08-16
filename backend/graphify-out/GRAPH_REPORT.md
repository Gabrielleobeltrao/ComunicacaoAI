# Graph Report - backend  (2026-08-15)

## Corpus Check
- 167 files · ~168,381 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1687 nodes · 3727 edges · 116 communities (104 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a611f7eb`
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
- delegationLog.ts
- listRunTimeline
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- agentLiveState.ts
- db.ts
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
- webhookTriggers.ts
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
- http.ts
- config.test.mjs
- groundingContract.test.mjs
- jsonSchema.test.mjs
- outputContract.test.mjs
- readiness.test.mjs
- automations.test.mjs
- dotenv
- express
- socket.io
- toolCallLog.ts
- routine.test.mjs
- seedGuard.test.mjs
- grants.ts
- navigation.ts
- appManifest.test.mjs
- registry.ts
- appRoutes.integration.test.mjs
- agentLiveTracker.ts
- delegateToSector
- safeHttp.ts
- appMigration.integration.test.mjs
- hardening.integration.test.mjs
- config.ts
- eventTrigger.ts
- safeError.ts
- delegationWiring.ts
- connections/types.ts
- agentLiveState.integration.test.mjs
- auditMiddleware.ts
- logRoutes.ts
- offices.ts
- sectorExecutions.integration.test.mjs
- agentLiveState.test.mjs

## God Nodes (most connected - your core abstractions)
1. `db` - 39 edges
2. `respondWithAgentIfLinked()` - 33 edges
3. `buildDeps()` - 26 edges
4. `encrypt()` - 26 edges
5. `getAgentById()` - 25 edges
6. `refreshMemoryAndIdentity()` - 23 edges
7. `productionDelegationDeps()` - 21 edges
8. `startMongo()` - 20 edges
9. `stopMongo()` - 20 edges
10. `getApp()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts
- `buildDeps()` --indirect_call--> `getAgentById()`  [INFERRED]
  src/automations/runProcessor.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (116 total, 12 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.27
Nodes (15): runEventKey(), createLiveTracker(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact() (+7 more)

### Community 1 - "floors.ts"
Cohesion: 0.16
Nodes (21): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), floorMetrics, BuildingLanguage, collection, createFloor(), deleteFloor() (+13 more)

### Community 2 - "openai.ts"
Cohesion: 0.05
Nodes (90): AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), inputToText(), parseJsonOutput() (+82 more)

### Community 3 - "sectorExecutions.ts"
Cohesion: 0.12
Nodes (20): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+12 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (48): ConversationTurn, EMBEDDING_DIMENSIONS, recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, chunks, chunkText() (+40 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.12
Nodes (24): ACTIVE_RUN_STATUSES, AgentRef, agents, AutomationDoc, automations, ExecutionFilters, ExecutionPage, floors (+16 more)

### Community 6 - "index.ts"
Cohesion: 0.04
Nodes (44): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), setActiveAgentId(), ensureConversationTurnsVectorIndex(), app (+36 more)

### Community 7 - "audit.ts"
Cohesion: 0.16
Nodes (20): AuditActorType, AuditEvent, AuditEventPublic, AuditResult, decodeAuditCursor(), encodeAuditCursor(), events, listAuditEvents() (+12 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (44): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentTool, AgentToolHeader, AgentToolParam (+36 more)

### Community 9 - "googleCalendar.ts"
Cohesion: 0.15
Nodes (19): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse (+11 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.08
Nodes (34): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+26 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.07
Nodes (45): recordAgentEventSafe(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId() (+37 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (27): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+19 more)

### Community 13 - "apps/types.ts"
Cohesion: 0.10
Nodes (25): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+17 more)

### Community 14 - "delegation.ts"
Cohesion: 0.11
Nodes (20): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, buildCapabilityMissing(), CapabilityMissing, DEFAULT_DELEGATION_TOKEN_BUDGET, DELEGATION_MAX_DEPTH, DelegationBudget (+12 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.08
Nodes (10): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), automations() (+2 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.18
Nodes (23): getAgentById(), buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError, RoutineSpec (+15 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.10
Nodes (23): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, getWidgetConfigAgent(), inboundMediaToText(), transcribeImage(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig() (+15 more)

### Community 18 - "tools.ts"
Cohesion: 0.09
Nodes (21): clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS, TOOL_DEFAULTS (+13 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.15
Nodes (14): LiveTracker, AgentExecutionRequest, AgentExecutionResult, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineExecutionDeps (+6 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, signBody() (+4 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.18
Nodes (19): assertOwnedAgentRefs(), assertOwnedSectorRefs(), collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName(), requireFloor() (+11 more)

### Community 22 - "dependencies"
Cohesion: 0.11
Nodes (19): @anthropic-ai/sdk, better-auth, cors, cron-parser, multer, nodemailer, openai, dependencies (+11 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "delegationLog.ts"
Cohesion: 0.22
Nodes (8): col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus, ensureDelegationIndexes(), listDelegationsForAgent(), succeededDelegationsByCaller()

### Community 25 - "listRunTimeline"
Cohesion: 0.16
Nodes (20): agentConstraint(), agentIdsInSector(), automationFilter(), averageTokens(), decodeRunCursor(), encodeRunCursor(), executionSummary, listRunsForCenter() (+12 more)

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
Cohesion: 0.11
Nodes (24): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+16 more)

### Community 32 - "db.ts"
Cohesion: 0.07
Nodes (41): auth, db, mongoClient, AgentDoc, SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite() (+33 more)

### Community 33 - "tokenUsage.ts"
Cohesion: 0.20
Nodes (16): dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce(), settlePendingCharges() (+8 more)

### Community 34 - "engine.ts"
Cohesion: 0.09
Nodes (31): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+23 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.22
Nodes (9): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), RecordAgentEventInput (+1 more)

### Community 36 - "migration.ts"
Cohesion: 0.19
Nodes (18): AgentBuiltinTool, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation(), ensureGoogleInstallations() (+10 more)

### Community 37 - "runService.ts"
Cohesion: 0.13
Nodes (18): findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, AutomationValidationError, AutomationVersion, canonical(), computeDefinitionHash() (+10 more)

### Community 38 - "toolExecution.ts"
Cohesion: 0.21
Nodes (11): ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets(), ToolExecutionResult (+3 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "migrate.ts"
Cohesion: 0.27
Nodes (13): ensureAgentLiveStateIndexes(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), ensureBuildingIndexes(), ensureConnectionIndexes() (+5 more)

### Community 41 - "connections/service.ts"
Cohesion: 0.24
Nodes (10): createConnection(), CreateConnectionInput, decryptConfig(), isNonEmpty(), normalizeName(), patchConnection(), PROVIDERS, validateConfig() (+2 more)

### Community 42 - "installations.ts"
Cohesion: 0.12
Nodes (21): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installations, LEGACY_APP_VERSION, markInstallationTested(), normalizeConfig() (+13 more)

### Community 43 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, dev:api, dev:worker, seed:demo, start, start:api (+2 more)

### Community 44 - "automations/types.ts"
Cohesion: 0.18
Nodes (10): AutomationInput, AutomationLimits, DEFAULT_LIMITS, DeliveryTarget, ManualTrigger, RetryPolicy, ScheduleTrigger, STEP_TYPES (+2 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "webhookTriggers.ts"
Cohesion: 0.42
Nodes (8): syncEventTriggerFor(), Automation, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent(), liveWebhookCountFor(), PublishedAutomation

### Community 47 - "building.ts"
Cohesion: 0.22
Nodes (11): buildingOverview(), Building, BuildingPatch, buildings, DEFAULT_TIMEZONE, ensureDefaultBuilding(), isValidTimezone(), LANGUAGES (+3 more)

### Community 48 - "userSettings.ts"
Cohesion: 0.20
Nodes (9): Provider, clearProviderApiKey(), FIELD_BY_PROVIDER, getMonthlyTokenCap(), getProviderKeyStatus(), setMonthlyTokenCap(), setProviderApiKey(), settings (+1 more)

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
Cohesion: 0.15
Nodes (7): connections, deliveries, insertDeliveryIdempotent(), sentDeliveriesByAgent(), updateDelivery(), Connection, Delivery

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
Cohesion: 0.16
Nodes (19): resolveHttpTool(), APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, getBuiltinApp() (+11 more)

### Community 59 - "runRepository.ts"
Cohesion: 0.14
Nodes (18): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+10 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "http.ts"
Cohesion: 0.15
Nodes (12): EXECUTION_TABS, ExecutionTab, CONNECTION_CATALOG, resolveOwnedSectorId(), connectionRouter, executionRouter, parseFilters(), fail() (+4 more)

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 78 - "toolCallLog.ts"
Cohesion: 0.40
Nodes (4): listToolCalls(), logToolCalls(), ToolCallLog, toolCallLogs

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
Cohesion: 0.31
Nodes (6): AgentBubbleState, catalogIndex(), instrumentTools(), LiveTrackerContext, NOOP_TRACKER, toolDetail()

### Community 100 - "delegateToSector"
Cohesion: 0.22
Nodes (16): agentCard(), asOutputFormat(), buildDelegationTools(), checkDelegation(), childContext(), delegateToAgent(), delegateToSector(), getCapabilities() (+8 more)

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
Cohesion: 0.29
Nodes (12): ensureActivationMode(), buildEventTriggerDefinition(), createEventTrigger(), EventTriggerError, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers() (+4 more)

### Community 107 - "safeError.ts"
Cohesion: 0.18
Nodes (10): runSummary(), stepPublic(), ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError() (+2 more)

### Community 108 - "delegationWiring.ts"
Cohesion: 0.25
Nodes (14): recordAgentEvent(), executeAgentTask(), withTimeout(), agentCanDelegate(), capabilityMissingTool(), finishDelegation(), startDelegation(), productionDelegationDeps() (+6 more)

### Community 109 - "connections/types.ts"
Cohesion: 0.24
Nodes (9): chunkTelegram(), FetchImpl, MailTransport, maskDestination(), sendTelegram(), ConnectionStatus, DeliveryStatus, EmailConfig (+1 more)

### Community 110 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 111 - "auditMiddleware.ts"
Cohesion: 0.24
Nodes (10): AuditAction, AuditEntityType, entityLabelWithOwner(), auditRequests(), AuditTarget, auditTargetFor(), matches(), Rule (+2 more)

### Community 112 - "logRoutes.ts"
Cohesion: 0.20
Nodes (5): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditFilters, logRouter

### Community 113 - "offices.ts"
Cohesion: 0.25
Nodes (6): resolveFloorOffice(), scopedFloorId(), createOffice(), ensureDefaultOffice(), Office, offices

### Community 114 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

## Knowledge Gaps
- **420 isolated node(s):** `AgentEventSource`, `AGENT_EVENT_SOURCES`, `AGENT_EVENT_STATUSES`, `AgentExecutionEvent`, `DELEGATION_MAX_DEPTH` (+415 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `hardening.integration.test.mjs`, `tokenUsage.ts`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `runProcessor.ts`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `appRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `hardening.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AgentEventSource`, `AGENT_EVENT_SOURCES`, `AGENT_EVENT_STATUSES` to the rest of the system?**
  _420 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05277262420119563 - nodes in this community are weakly interconnected._
- **Should `sectorExecutions.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12318840579710146 - nodes in this community are weakly interconnected._