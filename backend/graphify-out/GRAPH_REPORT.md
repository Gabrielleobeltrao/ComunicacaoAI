# Graph Report - backend  (2026-08-15)

## Corpus Check
- 186 files · ~188,903 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1856 nodes · 4126 edges · 127 communities (115 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b0e18155`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runProcessor.ts
- db.ts
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
- connections/service.ts
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
- listRunTimeline
- engine.ts
- agentEvents.ts
- registry.ts
- runService.ts
- tools.ts
- eventTrigger.integration.test.mjs
- appGrantRoutes.ts
- connections/types.ts
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
- executionRoutes.ts
- sectorMembership.ts
- gateWiring.integration.test.mjs
- routine.test.mjs
- seedGuard.test.mjs
- grants.ts
- mongoClient
- appManifest.test.mjs
- channelApps.ts
- appRoutes.integration.test.mjs
- executionRoots.ts
- seedRestaurantDemo.ts
- sectorAccess.ts
- appMigration.integration.test.mjs
- hardening.integration.test.mjs
- migrate.ts
- migrationFixture.integration.test.mjs
- safeError.ts
- userSettings.ts
- getSectorById
- agentLiveState.integration.test.mjs
- eventTrigger.ts
- scheduler.integration.test.mjs
- sectorExecutions.integration.test.mjs
- ResolvedTool
- config.ts
- delegationWiring.ts
- collaborationGate.test.mjs
- executionRoots.integration.test.mjs
- scheduler.ts
- sectorAccess.integration.test.mjs
- channelApps.integration.test.mjs
- AutomationDefinition
- safeHttp.ts
- toolCallLog.ts
- multer
- channelOverview.integration.test.mjs

## God Nodes (most connected - your core abstractions)
1. `db` - 47 edges
2. `respondWithAgentIfLinked()` - 33 edges
3. `buildDeps()` - 28 edges
4. `startMongo()` - 28 edges
5. `stopMongo()` - 28 edges
6. `encrypt()` - 26 edges
7. `getAgentById()` - 25 edges
8. `productionDelegationDeps()` - 24 edges
9. `refreshMemoryAndIdentity()` - 23 edges
10. `getApp()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `floorWorkOverview` --indirect_call--> `withAgentDefaults()`  [INFERRED]
  src/floorWork.ts → src/agents.ts
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (127 total, 12 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.22
Nodes (19): runEventKey(), createLiveTracker(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact() (+11 more)

### Community 1 - "db.ts"
Cohesion: 0.10
Nodes (38): agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE, ensureDefaultBuilding() (+30 more)

### Community 2 - "openai.ts"
Cohesion: 0.07
Nodes (67): ToolCallRecord, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), FALLBACK_MODELS (+59 more)

### Community 3 - "sectorExecutions.ts"
Cohesion: 0.12
Nodes (20): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+12 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (49): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, chunks (+41 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.13
Nodes (22): ACTIVE_RUN_STATUSES, AgentRef, agents, AutomationDoc, automations, ExecutionPage, floors, HISTORY_RUN_STATUSES (+14 more)

### Community 6 - "index.ts"
Cohesion: 0.05
Nodes (40): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), validateConfig(), setActiveAgentId() (+32 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (42): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentToolHeader, AgentToolParam, CONVERSATION_PERSISTENCE_TYPES (+34 more)

### Community 9 - "encrypt"
Cohesion: 0.16
Nodes (19): revokeInstallation(), decrypt(), encrypt(), getKey(), buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken() (+11 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (31): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+23 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.10
Nodes (34): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+26 more)

### Community 12 - "runner.ts"
Cohesion: 0.12
Nodes (26): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+18 more)

### Community 13 - "apps/types.ts"
Cohesion: 0.07
Nodes (46): describeManifestIssues(), exportableManifest(), FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest() (+38 more)

### Community 14 - "delegation.ts"
Cohesion: 0.09
Nodes (44): presetSpec(), suggestPresetForCapability(), checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget (+36 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.09
Nodes (8): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), here

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.17
Nodes (24): getAgentById(), EventTriggerError, buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError (+16 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "connections/service.ts"
Cohesion: 0.21
Nodes (11): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, decryptConfig(), getConnection(), isNonEmpty(), normalizeName(), patchConnection() (+3 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.10
Nodes (22): RecordAgentEventInput, AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail() (+14 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.12
Nodes (13): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+5 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.21
Nodes (15): assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), defaultDefinition(), normalizeName(), requireFloor() (+7 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, cron-parser, express, mongodb, nodemailer, openai (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "agentRuntime.ts"
Cohesion: 0.21
Nodes (13): AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+5 more)

### Community 25 - "llm.ts"
Cohesion: 0.19
Nodes (17): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, auxiliaryModel(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), generateAgentReply(), listModelsForProvider() (+9 more)

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
Nodes (33): ensureActivationMode(), addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel() (+25 more)

### Community 31 - "agentLiveState.ts"
Cohesion: 0.08
Nodes (32): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+24 more)

### Community 32 - "sectors.ts"
Cohesion: 0.17
Nodes (15): createSector(), deleteSector(), enforceSingleMembership(), normalizeMembers(), normalizeStages(), SECTOR_MODE_LABEL, SECTOR_MODES, SectorReadinessCode (+7 more)

### Community 33 - "listRunTimeline"
Cohesion: 0.16
Nodes (20): agentConstraint(), agentIdsInSector(), automationFilter(), averageTokens(), decodeRunCursor(), encodeRunCursor(), executionSummary, listRunsForCenter() (+12 more)

### Community 34 - "engine.ts"
Cohesion: 0.13
Nodes (21): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+13 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.22
Nodes (10): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), recordAgentEvent() (+2 more)

### Community 36 - "registry.ts"
Cohesion: 0.07
Nodes (36): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+28 more)

### Community 37 - "runService.ts"
Cohesion: 0.23
Nodes (14): findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl() (+6 more)

### Community 38 - "tools.ts"
Cohesion: 0.08
Nodes (24): clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), SENSITIVE_HEADER, Tool (+16 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "appGrantRoutes.ts"
Cohesion: 0.18
Nodes (8): AgentAppGrant, appGrantRouter, validateGrant(), automationRouter, connectionRouter, fail(), notFound(), oid()

### Community 41 - "connections/types.ts"
Cohesion: 0.18
Nodes (12): chunkTelegram(), FetchImpl, MailTransport, maskDestination(), sendEmail(), sendTelegram(), Connection, ConnectionStatus (+4 more)

### Community 42 - "installations.ts"
Cohesion: 0.10
Nodes (32): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installationPublic(), installations, listInstallations(), markInstallationTested() (+24 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "automations/types.ts"
Cohesion: 0.18
Nodes (10): AutomationInput, AutomationLimits, DEFAULT_LIMITS, DeliveryTarget, ManualTrigger, RetryPolicy, ScheduleTrigger, STEP_TYPES (+2 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "floorCommunication.ts"
Cohesion: 0.18
Nodes (13): Building, buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode (+5 more)

### Community 47 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 48 - "tokenUsage.ts"
Cohesion: 0.17
Nodes (18): TokenUsage, dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage() (+10 more)

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
Nodes (5): connections, deliveries, insertDeliveryIdempotent(), listDeliveries(), sentDeliveriesByAgent()

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
Cohesion: 0.14
Nodes (19): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+11 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "agentTools.ts"
Cohesion: 0.13
Nodes (25): AgentTool, legacyToolToExecutable(), MAX_TOOL_ITERATIONS, missingCapability(), resolveHttpTool(), runResolvedTool(), toolInputSchema(), checkStageOutput() (+17 more)

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 76 - "executionRoutes.ts"
Cohesion: 0.18
Nodes (8): EXECUTION_TABS, ExecutionFilters, ExecutionTab, RunTimelineFilters, AnalyticsPeriod, ANALYTICS_PERIODS, executionRouter, parseFilters()

### Community 77 - "sectorMembership.ts"
Cohesion: 0.24
Nodes (9): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, MAX_SECTOR_MEMBERS, SectorMember (+1 more)

### Community 78 - "gateWiring.integration.test.mjs"
Cohesion: 0.53
Nodes (5): agents(), insertAgent(), insertSector(), sectors(), threeAnswers()

### Community 84 - "grants.ts"
Cohesion: 0.22
Nodes (15): AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate(), isVersionCompatible(), NATIVE_FACTORIES (+7 more)

### Community 85 - "mongoClient"
Cohesion: 0.40
Nodes (3): mongoClient, AgentDoc, Sector

### Community 97 - "channelApps.ts"
Cohesion: 0.21
Nodes (14): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+6 more)

### Community 99 - "executionRoots.ts"
Cohesion: 0.15
Nodes (16): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, executionAnalytics(), executionBreakdown(), ExecutionEnvironment (+8 more)

### Community 100 - "seedRestaurantDemo.ts"
Cohesion: 0.26
Nodes (11): SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member(), OWNED_COLLECTIONS (+3 more)

### Community 101 - "sectorAccess.ts"
Cohesion: 0.21
Nodes (14): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+6 more)

### Community 102 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 105 - "migrate.ts"
Cohesion: 0.16
Nodes (18): ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureBuildingIndexes(), ensureConnectionIndexes(), ensureExecutionRootIndexes() (+10 more)

### Community 106 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 107 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 108 - "userSettings.ts"
Cohesion: 0.22
Nodes (8): clearProviderApiKey(), FIELD_BY_PROVIDER, getMonthlyTokenCap(), getProviderKeyStatus(), setMonthlyTokenCap(), setProviderApiKey(), settings, UserSettings

### Community 109 - "getSectorById"
Cohesion: 0.50
Nodes (4): resolveOwnedSectorId(), requireSector(), requireSector(), getSectorById()

### Community 110 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 111 - "eventTrigger.ts"
Cohesion: 0.33
Nodes (10): buildEventTriggerDefinition(), createEventTrigger(), EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), publishAutomation() (+2 more)

### Community 114 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 115 - "ResolvedTool"
Cohesion: 0.48
Nodes (5): ResolvedTool, googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 116 - "config.ts"
Cohesion: 0.19
Nodes (10): auth, clientUrl, config, FeatureFlags, flags, isProduction, originList(), port (+2 more)

### Community 117 - "delegationWiring.ts"
Cohesion: 0.13
Nodes (22): resolveAgentTools(), agentCanDelegate(), DelegationContext, DelegationDeps, col, DelegationFinish, DelegationRecord, DelegationStart (+14 more)

### Community 119 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 120 - "scheduler.ts"
Cohesion: 0.27
Nodes (10): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, planSchedules(), runDueSchedules() (+2 more)

### Community 121 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 122 - "channelApps.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addChannel(), addEmptyInstallation(), connections(), widgets()

### Community 123 - "AutomationDefinition"
Cohesion: 0.29
Nodes (11): CreateAutomationInput, syncEventTriggerFor(), UpdateDraftPatch, Automation, AutomationDefinition, agentsReferencedBy(), isLiveWebhook(), liveDefinition() (+3 more)

### Community 125 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 129 - "toolCallLog.ts"
Cohesion: 0.40
Nodes (4): listToolCalls(), logToolCalls(), ToolCallLog, toolCallLogs

### Community 131 - "channelOverview.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addWidget(), messages(), say(), widgets()

## Knowledge Gaps
- **482 isolated node(s):** `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget`, `DelegationDenyCode`, `DelegationCheck`, `OPEN_COMMUNICATION` (+477 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.184) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `runProcessor.ts`?**
  _High betweenness centrality (0.184) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `channelOverview.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `floorWork.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `gateWiring.integration.test.mjs`, `appRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `hardening.integration.test.mjs`, `migrationFixture.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `scheduler.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `channelApps.integration.test.mjs`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget`, `DelegationDenyCode` to the rest of the system?**
  _482 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `db.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09855072463768116 - nodes in this community are weakly interconnected._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07243460764587525 - nodes in this community are weakly interconnected._