# Graph Report - backend  (2026-08-15)

## Corpus Check
- 183 files · ~185,958 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1837 nodes · 4063 edges · 129 communities (116 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `39c4eb5d`
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
- sectorKnowledgeRoutes.ts
- engine.ts
- agentEvents.ts
- migration.ts
- runService.ts
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
- agentTools.ts
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
- hardening.integration.test.mjs
- migrate.ts
- migrationFixture.integration.test.mjs
- safeError.ts
- delegationLog.ts
- conversationTurns.ts
- agentLiveState.integration.test.mjs
- eventTrigger.ts
- db.ts
- privateApps.ts
- sectorExecutions.integration.test.mjs
- sectorMembership.ts
- config.ts
- delegationWiring.ts
- collaborationGate.test.mjs
- executionRoots.integration.test.mjs
- scheduler.ts
- sectorAccess.integration.test.mjs
- channelApps.integration.test.mjs
- webhookTriggers.ts
- GroundingRequiredError
- connections/types.ts
- safeHttp.ts
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
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `resolveOwnedAgentId()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts
- `resolveSectorMembers()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts
- `resolveSectorTeamFields()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (129 total, 13 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.22
Nodes (19): runEventKey(), createLiveTracker(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact() (+11 more)

### Community 1 - "floors.ts"
Cohesion: 0.12
Nodes (30): agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE, ensureDefaultBuilding() (+22 more)

### Community 2 - "openai.ts"
Cohesion: 0.07
Nodes (67): ToolCallRecord, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), FALLBACK_MODELS (+59 more)

### Community 3 - "sectorExecutions.ts"
Cohesion: 0.12
Nodes (20): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+12 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.10
Nodes (23): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), documents, EMBEDDING_DIMENSIONS (+15 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (50): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+42 more)

### Community 6 - "index.ts"
Cohesion: 0.05
Nodes (36): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), ensureDelegationIndexes(), app (+28 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (40): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentToolHeader, AgentToolParam, CONVERSATION_PERSISTENCE_TYPES (+32 more)

### Community 9 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (15): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse (+7 more)

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
Cohesion: 0.12
Nodes (33): presetSpec(), suggestPresetForCapability(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing, capabilityMissingTool() (+25 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.10
Nodes (9): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), automations() (+1 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.27
Nodes (16): buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError, RoutineSpec, updateRoutine() (+8 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.13
Nodes (19): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+11 more)

### Community 18 - "appGrantRoutes.ts"
Cohesion: 0.15
Nodes (13): ValidationError, CONNECTION_CATALOG, resolveOwnedSectorId(), appGrantRouter, auditEntity(), automationRouter, connectionRouter, fail() (+5 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.11
Nodes (21): RecordAgentEventInput, AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail() (+13 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.12
Nodes (13): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+5 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.15
Nodes (25): ensureActivationMode(), getAgentById(), createEventTrigger(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation() (+17 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, cron-parser, express, mongodb, nodemailer, openai (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "agentRuntime.ts"
Cohesion: 0.19
Nodes (13): AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), executeAgentTask(), inputToText() (+5 more)

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
Nodes (32): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+24 more)

### Community 31 - "agentLiveState.ts"
Cohesion: 0.08
Nodes (32): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+24 more)

### Community 32 - "sectors.ts"
Cohesion: 0.17
Nodes (15): createSector(), deleteSector(), enforceSingleMembership(), normalizeMembers(), normalizeStages(), SECTOR_MODE_LABEL, SECTOR_MODES, SectorReadinessCode (+7 more)

### Community 33 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.15
Nodes (14): chunkText(), deleteDocument(), deleteDocumentFor(), getDocument(), getDocumentFor(), indexDocumentChunks(), KnowledgeDocument, listDocuments() (+6 more)

### Community 34 - "engine.ts"
Cohesion: 0.16
Nodes (17): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+9 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.22
Nodes (10): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), recordAgentEvent() (+2 more)

### Community 36 - "migration.ts"
Cohesion: 0.15
Nodes (22): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+14 more)

### Community 37 - "runService.ts"
Cohesion: 0.21
Nodes (15): insertRunIdempotent(), createRun(), CreateRunInput, AutomationRun, TriggerType, canonical(), computeDefinitionHash(), hasCycle() (+7 more)

### Community 38 - "tools.ts"
Cohesion: 0.09
Nodes (22): parseAgentModelFields(), isValidToolSchema(), clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize() (+14 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 41 - "connections/service.ts"
Cohesion: 0.29
Nodes (8): createConnection(), CreateConnectionInput, isNonEmpty(), normalizeName(), patchConnection(), PROVIDERS, validateConfig(), ConnectionProvider

### Community 42 - "installations.ts"
Cohesion: 0.14
Nodes (21): createInstallation(), CreateInstallationInput, decryptInstallationConfig(), deleteInstallation(), getInstallation(), installations, markInstallationTested(), normalizeConfig() (+13 more)

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
Cohesion: 0.12
Nodes (21): Building, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows() (+13 more)

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

### Community 58 - "builtinTools.ts"
Cohesion: 0.20
Nodes (15): APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, hubspotTools(), mercadoPagoTools() (+7 more)

### Community 59 - "runRepository.ts"
Cohesion: 0.14
Nodes (17): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+9 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "jsonSchema.ts"
Cohesion: 0.27
Nodes (12): checkJson(), runResolvedTool(), checkStageOutput(), describeErrors(), join(), matchesType(), Schema, SchemaError (+4 more)

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

### Community 77 - "agentTools.ts"
Cohesion: 0.15
Nodes (17): AgentTool, legacyToolToExecutable(), MAX_TOOL_ITERATIONS, resolveHttpTool(), toolInputSchema(), ExecutableTool, executeToolCall(), ExecuteToolOptions (+9 more)

### Community 78 - "registry.ts"
Cohesion: 0.11
Nodes (15): acceptsGenericConnect(), activationOf(), appCatalogPublic(), email, google, hubspot, LEGACY_APP_KEYS, mercadopago (+7 more)

### Community 84 - "grants.ts"
Cohesion: 0.16
Nodes (20): missingCapability(), AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate(), isVersionCompatible() (+12 more)

### Community 85 - "navigation.ts"
Cohesion: 0.18
Nodes (17): installationPublic(), listInstallations(), buildNavigation(), dropPinsForApp(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus (+9 more)

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
Cohesion: 0.24
Nodes (15): backfillManagedChannelInstallations(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureBuildingIndexes(), ensureConnectionIndexes() (+7 more)

### Community 106 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 107 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 108 - "delegationLog.ts"
Cohesion: 0.25
Nodes (7): col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus, listDelegationsForAgent(), succeededDelegationsByCaller()

### Community 109 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 110 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 111 - "eventTrigger.ts"
Cohesion: 0.36
Nodes (9): buildEventTriggerDefinition(), EventTriggerError, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), getAutomation() (+1 more)

### Community 112 - "db.ts"
Cohesion: 0.17
Nodes (9): auth, db, mongoClient, createOffice(), ensureDefaultOffice(), Office, offices, AgentDoc (+1 more)

### Community 113 - "privateApps.ts"
Cohesion: 0.23
Nodes (14): describeManifestIssues(), exportableManifest(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listPrivateApps(), normalize() (+6 more)

### Community 114 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 115 - "sectorMembership.ts"
Cohesion: 0.24
Nodes (9): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, MAX_SECTOR_MEMBERS, SectorMember (+1 more)

### Community 116 - "config.ts"
Cohesion: 0.16
Nodes (13): clientUrl, config, FeatureFlags, flags, isProduction, originList(), port, stripTrailingSlash() (+5 more)

### Community 117 - "delegationWiring.ts"
Cohesion: 0.24
Nodes (14): resolveAgentTools(), agentCanDelegate(), DelegationContext, DelegationDeps, finishDelegation(), startDelegation(), productionDelegationDeps(), resolveToolsWithDelegation() (+6 more)

### Community 119 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 120 - "scheduler.ts"
Cohesion: 0.25
Nodes (12): findVersion(), advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, planSchedules() (+4 more)

### Community 121 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 122 - "channelApps.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addChannel(), addEmptyInstallation(), connections(), widgets()

### Community 123 - "webhookTriggers.ts"
Cohesion: 0.46
Nodes (7): Automation, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent(), liveWebhookCountFor(), PublishedAutomation

### Community 126 - "connections/types.ts"
Cohesion: 0.18
Nodes (12): chunkTelegram(), FetchImpl, MailTransport, maskDestination(), sendEmail(), sendTelegram(), Connection, ConnectionStatus (+4 more)

### Community 127 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 128 - "floorWork.ts"
Cohesion: 0.31
Nodes (8): Agent, Floor, agents, competencyOf(), effectiveTargets(), FloorTarget, floorWorkOverview, sectors

## Knowledge Gaps
- **481 isolated node(s):** `installations`, `channels`, `ChannelSyncReport`, `UserNavigationPreferences`, `preferences` (+476 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `tokenUsage.ts` to `runProcessor.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.185) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `tokenUsage.ts`?**
  _High betweenness centrality (0.185) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `appRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `hardening.integration.test.mjs`, `toolsSecurity.test.mjs`, `migrationFixture.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `floorWork.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `executionRoots.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `channelApps.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `installations`, `channels`, `ChannelSyncReport` to the rest of the system?**
  _481 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12063492063492064 - nodes in this community are weakly interconnected._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07243460764587525 - nodes in this community are weakly interconnected._