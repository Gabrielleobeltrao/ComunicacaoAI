# Graph Report - backend  (2026-08-15)

## Corpus Check
- 179 files · ~181,979 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1805 nodes · 3988 edges · 128 communities (112 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `14332893`
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
- appInstallationRoutes.ts
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
- runService.ts
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
- listRunTimeline
- config.test.mjs
- groundingContract.test.mjs
- jsonSchema.test.mjs
- outputContract.test.mjs
- readiness.test.mjs
- automations.test.mjs
- dotenv
- express
- socket.io
- appGrantRoutes.ts
- routine.test.mjs
- seedGuard.test.mjs
- grants.ts
- navigation.ts
- appManifest.test.mjs
- registry.ts
- appRoutes.integration.test.mjs
- executionRoots.ts
- seedRestaurantDemo.ts
- sectorAccess.ts
- appMigration.integration.test.mjs
- hardening.integration.test.mjs
- migrate.ts
- eventTrigger.ts
- safeError.ts
- delegationWiring.ts
- privateApps.ts
- agentLiveState.integration.test.mjs
- floorWork.ts
- db.ts
- floorRoutes.ts
- sectorExecutions.integration.test.mjs
- ResolvedTool
- config.ts
- sectorAccess.integration.test.mjs
- collaborationGate.test.mjs
- executionRoots.integration.test.mjs
- scheduler.ts
- agentLiveTracker.ts
- executionRoutes.ts
- sectorDecisions.ts
- agentTools.ts
- runQueue.integration.test.mjs
- agentLiveState.test.mjs
- GroundingRequiredError

## God Nodes (most connected - your core abstractions)
1. `db` - 44 edges
2. `respondWithAgentIfLinked()` - 33 edges
3. `buildDeps()` - 28 edges
4. `encrypt()` - 26 edges
5. `productionDelegationDeps()` - 25 edges
6. `getAgentById()` - 25 edges
7. `startMongo()` - 24 edges
8. `stopMongo()` - 24 edges
9. `refreshMemoryAndIdentity()` - 23 edges
10. `runMigrations()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `resolveOwnedAgentId()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts
- `resolveSectorMembers()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts
- `resolveSectorTeamFields()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (128 total, 16 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.25
Nodes (16): createLiveTracker(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact(), insertStepRun() (+8 more)

### Community 1 - "floors.ts"
Cohesion: 0.13
Nodes (20): Building, BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE, isValidTimezone(), LANGUAGES, collection (+12 more)

### Community 2 - "openai.ts"
Cohesion: 0.07
Nodes (68): MAX_TOOL_ITERATIONS, ToolCallRecord, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractIdentity(), extractStructuredOutput() (+60 more)

### Community 3 - "sectorExecutions.ts"
Cohesion: 0.12
Nodes (20): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+12 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (49): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, chunks (+41 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.12
Nodes (24): ACTIVE_RUN_STATUSES, AgentRef, agents, AutomationDoc, automations, ExecutionFilters, ExecutionPage, floors (+16 more)

### Community 6 - "index.ts"
Cohesion: 0.05
Nodes (35): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), ensureDelegationIndexes(), app (+27 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (44): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentTool, AgentToolHeader, AgentToolParam (+36 more)

### Community 9 - "appInstallationRoutes.ts"
Cohesion: 0.13
Nodes (19): deleteInstallation(), markInstallationTested(), dropPinsForApp(), buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), googleConfigured() (+11 more)

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
Cohesion: 0.10
Nodes (26): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+18 more)

### Community 14 - "delegation.ts"
Cohesion: 0.12
Nodes (32): presetSpec(), suggestPresetForCapability(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing, checkDelegation() (+24 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.12
Nodes (7): PAGE, startMongo(), stopMongo(), A, B, automations(), seedSchedule()

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.27
Nodes (16): buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError, RoutineSpec, updateRoutine() (+8 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "tools.ts"
Cohesion: 0.11
Nodes (16): deleteTool(), getTool(), listTools(), TOOL_AUTH_KINDS, TOOL_LIMITS, TOOL_METHODS, TOOL_NAME_PATTERN, ToolAuth (+8 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.15
Nodes (14): RecordAgentEventInput, AgentExecutionRequest, AgentExecutionResult, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineExecutionDeps (+6 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.12
Nodes (13): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+5 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.15
Nodes (25): ensureActivationMode(), getAgentById(), createEventTrigger(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation() (+17 more)

### Community 22 - "dependencies"
Cohesion: 0.11
Nodes (19): @anthropic-ai/sdk, better-auth, cors, cron-parser, multer, nodemailer, openai, dependencies (+11 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.16
Nodes (16): AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel(), kpiShortLabel() (+8 more)

### Community 24 - "agentRuntime.ts"
Cohesion: 0.13
Nodes (24): AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+16 more)

### Community 25 - "llm.ts"
Cohesion: 0.11
Nodes (25): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, auxiliaryModel(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), generateAgentReply(), listModelsForProvider() (+17 more)

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
Cohesion: 0.10
Nodes (26): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+18 more)

### Community 32 - "sectors.ts"
Cohesion: 0.11
Nodes (23): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, deleteSector(), enforceSingleMembership() (+15 more)

### Community 33 - "floorCommunication.ts"
Cohesion: 0.13
Nodes (19): checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows(), buildings (+11 more)

### Community 34 - "engine.ts"
Cohesion: 0.17
Nodes (16): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+8 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.18
Nodes (12): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, events, finalizeAgentEvent(), finalizeAgentEventSafe() (+4 more)

### Community 36 - "migration.ts"
Cohesion: 0.14
Nodes (23): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+15 more)

### Community 37 - "runService.ts"
Cohesion: 0.21
Nodes (15): findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl() (+7 more)

### Community 38 - "toolExecution.ts"
Cohesion: 0.14
Nodes (18): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult (+10 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 41 - "connections/service.ts"
Cohesion: 0.13
Nodes (19): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), createConnection(), CreateConnectionInput, decryptConfig(), getConnection() (+11 more)

### Community 42 - "installations.ts"
Cohesion: 0.16
Nodes (19): createInstallation(), CreateInstallationInput, getInstallation(), installations, listInstallations(), normalizeConfig(), normalizeName(), patchInstallation() (+11 more)

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
Cohesion: 0.46
Nodes (7): Automation, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent(), liveWebhookCountFor(), PublishedAutomation

### Community 47 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 48 - "tokenUsage.ts"
Cohesion: 0.16
Nodes (19): TokenUsage, attemptChargeKey(), dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey() (+11 more)

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
Nodes (7): connections, deliveries, insertDeliveryIdempotent(), listDeliveries(), sentDeliveriesByAgent(), updateDelivery(), Delivery

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
Cohesion: 0.19
Nodes (16): Agent, APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, hubspotTools() (+8 more)

### Community 59 - "runRepository.ts"
Cohesion: 0.13
Nodes (20): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+12 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "listRunTimeline"
Cohesion: 0.16
Nodes (20): agentConstraint(), agentIdsInSector(), automationFilter(), averageTokens(), decodeRunCursor(), encodeRunCursor(), executionSummary, listRunsForCenter() (+12 more)

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 78 - "appGrantRoutes.ts"
Cohesion: 0.14
Nodes (14): AgentAppGrant, ValidationError, CONNECTION_CATALOG, resolveOwnedSectorId(), appGrantRouter, auditEntity(), automationRouter, connectionRouter (+6 more)

### Community 84 - "grants.ts"
Cohesion: 0.20
Nodes (17): missingCapability(), AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate(), isVersionCompatible() (+9 more)

### Community 85 - "navigation.ts"
Cohesion: 0.16
Nodes (15): installationPublic(), buildNavigation(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus, preferences, setPinnedApps() (+7 more)

### Community 97 - "registry.ts"
Cohesion: 0.12
Nodes (12): email, google, hubspot, LEGACY_APP_KEYS, mercadopago, nuvemshop, rdstation, slack (+4 more)

### Community 99 - "executionRoots.ts"
Cohesion: 0.15
Nodes (16): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, executionAnalytics(), executionBreakdown(), ExecutionEnvironment (+8 more)

### Community 100 - "seedRestaurantDemo.ts"
Cohesion: 0.23
Nodes (13): SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member(), OWNED_COLLECTIONS (+5 more)

### Community 101 - "sectorAccess.ts"
Cohesion: 0.20
Nodes (15): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+7 more)

### Community 102 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 105 - "migrate.ts"
Cohesion: 0.15
Nodes (19): ensureAgentLiveStateIndexes(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureBuildingIndexes(), ensureConnectionIndexes() (+11 more)

### Community 106 - "eventTrigger.ts"
Cohesion: 0.36
Nodes (9): buildEventTriggerDefinition(), EventTriggerError, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), getAutomation() (+1 more)

### Community 107 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 108 - "delegationWiring.ts"
Cohesion: 0.14
Nodes (21): resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), DelegationContext, DelegationDeps, col, DelegationFinish, DelegationRecord (+13 more)

### Community 109 - "privateApps.ts"
Cohesion: 0.23
Nodes (14): describeManifestIssues(), exportableManifest(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listPrivateApps(), normalize() (+6 more)

### Community 110 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 111 - "floorWork.ts"
Cohesion: 0.36
Nodes (7): Floor, agents, competencyOf(), effectiveTargets(), FloorTarget, floorWorkOverview, sectors

### Community 112 - "db.ts"
Cohesion: 0.33
Nodes (5): auth, db, mongoClient, AgentDoc, Sector

### Community 113 - "floorRoutes.ts"
Cohesion: 0.23
Nodes (12): agentStatesForFloor(), buildingOverview(), floorMetrics, ensureDefaultBuilding(), updateBuilding(), deleteFloor(), getFloor(), getFloorActivity() (+4 more)

### Community 114 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 115 - "ResolvedTool"
Cohesion: 0.43
Nodes (6): ResolvedTool, getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 116 - "config.ts"
Cohesion: 0.16
Nodes (13): clientUrl, config, FeatureFlags, flags, isProduction, originList(), port, stripTrailingSlash() (+5 more)

### Community 117 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 119 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 120 - "scheduler.ts"
Cohesion: 0.24
Nodes (12): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes(), planSchedules() (+4 more)

### Community 121 - "agentLiveTracker.ts"
Cohesion: 0.24
Nodes (8): AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail(), SYSTEM_APPS

### Community 122 - "executionRoutes.ts"
Cohesion: 0.22
Nodes (6): EXECUTION_TABS, ExecutionTab, AnalyticsPeriod, ANALYTICS_PERIODS, executionRouter, parseFilters()

### Community 123 - "sectorDecisions.ts"
Cohesion: 0.29
Nodes (6): aggregateSectorDecisions(), listSectorDecisionsForConversation(), logSectorDecision(), SectorDecision, SectorDecisionAggregate, sectorDecisions

### Community 124 - "agentTools.ts"
Cohesion: 0.47
Nodes (5): legacyToolToExecutable(), resolveHttpTool(), toolInputSchema(), ExecutableTool, TOOL_DEFAULTS

## Knowledge Gaps
- **469 isolated node(s):** `NativeFactory`, `NATIVE_FACTORIES`, `AppActionEvent`, `appActionEvents`, `ManifestIssue` (+464 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `tokenUsage.ts` to `runProcessor.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.144) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `tokenUsage.ts`?**
  _High betweenness centrality (0.144) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `appRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `hardening.integration.test.mjs`, `toolsSecurity.test.mjs`, `agentLiveState.integration.test.mjs`, `floorWork.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `runQueue.integration.test.mjs`, `agentHistory.integration.test.mjs`, `executionRoots.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `productionDelegationDeps()` (e.g. with `finishDelegation()` and `startDelegation()`) actually correct?**
  _`productionDelegationDeps()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `NativeFactory`, `NATIVE_FACTORIES`, `AppActionEvent` to the rest of the system?**
  _469 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13043478260869565 - nodes in this community are weakly interconnected._