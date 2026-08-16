# Graph Report - backend  (2026-08-15)

## Corpus Check
- 183 files · ~186,069 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1837 nodes · 4064 edges · 126 communities (115 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `274d8533`
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
- connections/service.ts
- agentReadiness.ts
- respondWithAgentIfLinked
- runner.ts
- apps/types.ts
- delegation.ts
- mongoServer.mjs
- agentRoutineRoutes.ts
- whatsapp.ts
- appGrantRoutes.ts
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
- floorRoutes.ts
- engine.ts
- agentEvents.ts
- migration.ts
- validate.ts
- tools.ts
- eventTrigger.integration.test.mjs
- toolsSecurity.test.mjs
- collaborationGate.ts
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
- jsonSchema.ts
- config.test.mjs
- groundingContract.test.mjs
- jsonSchema.test.mjs
- outputContract.test.mjs
- readiness.test.mjs
- automations.test.mjs
- dotenv
- resolveSectorTurn
- toolExecution.ts
- registry.ts
- routine.test.mjs
- seedGuard.test.mjs
- grants.ts
- navigation.ts
- appManifest.test.mjs
- channelApps.ts
- appRoutes.integration.test.mjs
- executionRoots.ts
- seedRestaurantDemo.ts
- sectorAccess.ts
- appMigration.integration.test.mjs
- migrate.ts
- migrationFixture.integration.test.mjs
- safeError.ts
- userSettings.ts
- agentTools.ts
- agentLiveState.integration.test.mjs
- eventTrigger.ts
- db.ts
- privateApps.ts
- sectorExecutions.integration.test.mjs
- ResolvedTool
- config.ts
- delegationWiring.ts
- collaborationGate.test.mjs
- executionRoots.integration.test.mjs
- runService.ts
- sectorAccess.integration.test.mjs
- channelApps.integration.test.mjs
- webhookTriggers.ts
- floorWork.ts
- multer

## God Nodes (most connected - your core abstractions)
1. `db` - 46 edges
2. `respondWithAgentIfLinked()` - 33 edges
3. `buildDeps()` - 28 edges
4. `encrypt()` - 26 edges
5. `startMongo()` - 26 edges
6. `stopMongo()` - 26 edges
7. `productionDelegationDeps()` - 25 edges
8. `getAgentById()` - 25 edges
9. `refreshMemoryAndIdentity()` - 23 edges
10. `getApp()` - 20 edges

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

## Communities (126 total, 11 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.15
Nodes (24): runEventKey(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact(), insertStepRun() (+16 more)

### Community 1 - "floors.ts"
Cohesion: 0.13
Nodes (20): BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE, isValidTimezone(), LANGUAGES, updateBuilding(), collection (+12 more)

### Community 2 - "openai.ts"
Cohesion: 0.07
Nodes (67): ToolCallRecord, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), FALLBACK_MODELS (+59 more)

### Community 3 - "sectorExecutions.ts"
Cohesion: 0.12
Nodes (20): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+12 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (47): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, chunks (+39 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (50): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+42 more)

### Community 6 - "index.ts"
Cohesion: 0.05
Nodes (35): ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), ensureDelegationIndexes(), app, AVATAR_MIME_TYPES (+27 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (40): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentToolHeader, AgentToolParam, CONVERSATION_PERSISTENCE_TYPES (+32 more)

### Community 9 - "connections/service.ts"
Cohesion: 0.11
Nodes (28): createConnection(), CreateConnectionInput, decryptConfig(), getConnection(), isNonEmpty(), normalizeName(), patchConnection(), PROVIDERS (+20 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (31): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+23 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.10
Nodes (34): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+26 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (28): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+20 more)

### Community 13 - "apps/types.ts"
Cohesion: 0.10
Nodes (26): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+18 more)

### Community 14 - "delegation.ts"
Cohesion: 0.10
Nodes (35): presetSpec(), suggestPresetForCapability(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing, checkDelegation() (+27 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.10
Nodes (9): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), automations() (+1 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.23
Nodes (19): getAgentById(), EventTriggerError, buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError (+11 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.13
Nodes (19): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+11 more)

### Community 18 - "appGrantRoutes.ts"
Cohesion: 0.13
Nodes (15): AgentAppGrant, ValidationError, CONNECTION_CATALOG, resolveOwnedSectorId(), appGrantRouter, validateGrant(), auditEntity(), automationRouter (+7 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.10
Nodes (22): RecordAgentEventInput, AgentBubbleState, finishAgentState(), catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER (+14 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.12
Nodes (13): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+5 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.19
Nodes (18): assertOwnedAgentRefs(), assertOwnedSectorRefs(), collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName(), requireFloor() (+10 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, cron-parser, express, mongodb, nodemailer, openai (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.16
Nodes (16): AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel(), kpiShortLabel() (+8 more)

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
Nodes (32): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+24 more)

### Community 31 - "agentLiveState.ts"
Cohesion: 0.09
Nodes (27): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+19 more)

### Community 32 - "sectors.ts"
Cohesion: 0.11
Nodes (24): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+16 more)

### Community 33 - "floorRoutes.ts"
Cohesion: 0.31
Nodes (10): agentStatesForFloor(), buildingOverview(), floorMetrics, ensureDefaultBuilding(), deleteFloor(), getFloor(), getFloorActivity(), listFloors() (+2 more)

### Community 34 - "engine.ts"
Cohesion: 0.17
Nodes (16): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+8 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.18
Nodes (12): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, backfillAgentEventAttempts(), events, finalizeAgentEvent() (+4 more)

### Community 36 - "migration.ts"
Cohesion: 0.16
Nodes (21): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+13 more)

### Community 37 - "validate.ts"
Cohesion: 0.24
Nodes (11): AutomationValidationError, canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord(), validateDefinition() (+3 more)

### Community 38 - "tools.ts"
Cohesion: 0.09
Nodes (22): parseAgentModelFields(), isValidToolSchema(), clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize() (+14 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 41 - "collaborationGate.ts"
Cohesion: 0.31
Nodes (8): checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows(), canCommunicate()

### Community 42 - "installations.ts"
Cohesion: 0.16
Nodes (17): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installationPublic(), installations, markInstallationTested(), normalizeConfig() (+9 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "automations/types.ts"
Cohesion: 0.20
Nodes (9): AutomationInput, AutomationLimits, DEFAULT_LIMITS, DeliveryTarget, ManualTrigger, RetryPolicy, ScheduleTrigger, STEP_TYPES (+1 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "floorCommunication.ts"
Cohesion: 0.17
Nodes (13): Building, buildings, COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationConfig, FloorCommunicationMode (+5 more)

### Community 47 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 48 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): TokenUsage, dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

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
Cohesion: 0.13
Nodes (10): connections, deliveries, listDeliveries(), sentDeliveriesByAgent(), Connection, ConnectionStatus, Delivery, DeliveryStatus (+2 more)

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
Cohesion: 0.20
Nodes (15): APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, hubspotTools(), mercadoPagoTools() (+7 more)

### Community 59 - "runRepository.ts"
Cohesion: 0.14
Nodes (19): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+11 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "jsonSchema.ts"
Cohesion: 0.29
Nodes (11): runResolvedTool(), checkStageOutput(), describeErrors(), join(), matchesType(), Schema, SchemaError, typeOf() (+3 more)

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 76 - "resolveSectorTurn"
Cohesion: 0.14
Nodes (13): setActiveAgentId(), auxModelFor(), buildStageTransitionOptions(), memberRoutingLine(), resolveSectorTurn(), aggregateSectorDecisions(), listSectorDecisionsForConversation(), logSectorDecision() (+5 more)

### Community 77 - "toolExecution.ts"
Cohesion: 0.14
Nodes (18): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult (+10 more)

### Community 78 - "registry.ts"
Cohesion: 0.11
Nodes (15): acceptsGenericConnect(), activationOf(), appCatalogPublic(), email, google, hubspot, LEGACY_APP_KEYS, mercadopago (+7 more)

### Community 84 - "grants.ts"
Cohesion: 0.20
Nodes (17): missingCapability(), AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate(), isVersionCompatible() (+9 more)

### Community 85 - "navigation.ts"
Cohesion: 0.21
Nodes (15): listInstallations(), buildNavigation(), dropPinsForApp(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus, preferences (+7 more)

### Community 97 - "channelApps.ts"
Cohesion: 0.27
Nodes (11): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+3 more)

### Community 99 - "executionRoots.ts"
Cohesion: 0.15
Nodes (16): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, executionAnalytics(), executionBreakdown(), ExecutionEnvironment (+8 more)

### Community 100 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 101 - "sectorAccess.ts"
Cohesion: 0.21
Nodes (14): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+6 more)

### Community 102 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 105 - "migrate.ts"
Cohesion: 0.15
Nodes (20): ensureAgentLiveStateIndexes(), backfillManagedChannelInstallations(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureBuildingIndexes() (+12 more)

### Community 106 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 107 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 108 - "userSettings.ts"
Cohesion: 0.22
Nodes (8): clearProviderApiKey(), FIELD_BY_PROVIDER, getMonthlyTokenCap(), getProviderKeyStatus(), setMonthlyTokenCap(), setProviderApiKey(), settings, UserSettings

### Community 109 - "agentTools.ts"
Cohesion: 0.32
Nodes (7): AgentTool, legacyToolToExecutable(), MAX_TOOL_ITERATIONS, resolveHttpTool(), toolInputSchema(), ExecutableTool, TOOL_DEFAULTS

### Community 110 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 111 - "eventTrigger.ts"
Cohesion: 0.33
Nodes (11): ensureActivationMode(), buildEventTriggerDefinition(), createEventTrigger(), EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger() (+3 more)

### Community 112 - "db.ts"
Cohesion: 0.24
Nodes (8): auth, db, mongoClient, AgentDoc, arg(), main(), SHOWCASE, Sector

### Community 113 - "privateApps.ts"
Cohesion: 0.21
Nodes (15): describeManifestIssues(), exportableManifest(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listPrivateApps(), normalize() (+7 more)

### Community 114 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 115 - "ResolvedTool"
Cohesion: 0.48
Nodes (5): ResolvedTool, googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 116 - "config.ts"
Cohesion: 0.16
Nodes (13): clientUrl, config, FeatureFlags, flags, isProduction, originList(), port, stripTrailingSlash() (+5 more)

### Community 117 - "delegationWiring.ts"
Cohesion: 0.15
Nodes (20): resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus (+12 more)

### Community 119 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 120 - "runService.ts"
Cohesion: 0.16
Nodes (19): createLiveTracker(), findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, advanceFrom(), catchUp(), nextFireAt() (+11 more)

### Community 121 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 122 - "channelApps.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addChannel(), addEmptyInstallation(), connections(), widgets()

### Community 123 - "webhookTriggers.ts"
Cohesion: 0.42
Nodes (8): syncEventTriggerFor(), Automation, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent(), liveWebhookCountFor(), PublishedAutomation

### Community 128 - "floorWork.ts"
Cohesion: 0.31
Nodes (8): Agent, Floor, agents, competencyOf(), effectiveTargets(), FloorTarget, floorWorkOverview, sectors

## Knowledge Gaps
- **481 isolated node(s):** `installations`, `channels`, `ChannelSyncReport`, `UserNavigationPreferences`, `preferences` (+476 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`?**
  _High betweenness centrality (0.164) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `runProcessor.ts` to `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.163) - this node is a cross-community bridge._
- **Why does `db` connect `db.ts` to `floorWork.ts`, `floors.ts`, `sectorExecutions.ts`, `knowledge.ts`, `executionCenter.ts`, `index.ts`, `audit.ts`, `agents.ts`, `connections/service.ts`, `respondWithAgentIfLinked`, `automations/repository.ts`, `widgets.ts`, `agentLiveState.ts`, `sectors.ts`, `floorRoutes.ts`, `agentEvents.ts`, `migration.ts`, `tools.ts`, `installations.ts`, `floorCommunication.ts`, `tokenUsage.ts`, `connections/repository.ts`, `runRepository.ts`, `resolveSectorTurn`, `grants.ts`, `navigation.ts`, `channelApps.ts`, `executionRoots.ts`, `seedRestaurantDemo.ts`, `sectorAccess.ts`, `migrate.ts`, `userSettings.ts`, `privateApps.ts`, `delegationWiring.ts`, `runService.ts`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `installations`, `channels`, `ChannelSyncReport` to the rest of the system?**
  _481 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13438735177865613 - nodes in this community are weakly interconnected._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07243460764587525 - nodes in this community are weakly interconnected._