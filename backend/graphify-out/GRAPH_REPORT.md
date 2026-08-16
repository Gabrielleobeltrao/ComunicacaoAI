# Graph Report - backend  (2026-08-16)

## Corpus Check
- 187 files · ~191,831 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1866 nodes · 4159 edges · 128 communities (116 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 39 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d6546656`
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
- connections/repository.ts
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
- registry.ts
- engine.ts
- navigation.ts
- migration.ts
- validate.ts
- tools.ts
- eventTrigger.integration.test.mjs
- privateApps.ts
- floorWork.ts
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
- agentEvents.ts
- agentHistory.integration.test.mjs
- auditRouteMap.test.mjs
- routineDelivery.integration.test.mjs
- deployment.test.mjs
- toolExecution.ts
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
- appGrantRoutes.ts
- db.ts
- gateWiring.integration.test.mjs
- routine.test.mjs
- seedGuard.test.mjs
- grants.ts
- eventTrigger.ts
- appManifest.test.mjs
- channelApps.ts
- appRoutes.integration.test.mjs
- executionRoots.ts
- seedRestaurantDemo.ts
- sectorAccess.ts
- appMigration.integration.test.mjs
- hardening.integration.test.mjs
- connections/service.ts
- migrationFixture.integration.test.mjs
- agentLiveTracker.ts
- sectorMembership.ts
- delegateToAgent
- agentLiveState.integration.test.mjs
- safeError.ts
- toolsSecurity.test.mjs
- selectVisualStates
- sectorExecutions.integration.test.mjs
- AutomationDefinition
- offices.ts
- delegationWiring.ts
- collaborationGate.test.mjs
- executionRoots.integration.test.mjs
- runService.ts
- sectorAccess.integration.test.mjs
- channelApps.integration.test.mjs
- migrate.ts
- toolCallLog.ts
- safeHttp.ts
- multer
- channelOverview.integration.test.mjs

## God Nodes (most connected - your core abstractions)
1. `db` - 47 edges
2. `respondWithAgentIfLinked()` - 36 edges
3. `startMongo()` - 29 edges
4. `stopMongo()` - 29 edges
5. `buildDeps()` - 28 edges
6. `encrypt()` - 26 edges
7. `getAgentById()` - 25 edges
8. `productionDelegationDeps()` - 24 edges
9. `refreshMemoryAndIdentity()` - 23 edges
10. `runMigrations()` - 19 edges

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

## Communities (128 total, 12 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.17
Nodes (24): runEventKey(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact(), insertStepRun() (+16 more)

### Community 1 - "floors.ts"
Cohesion: 0.10
Nodes (32): liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, Building, BuildingLanguage, BuildingPatch, buildings (+24 more)

### Community 2 - "openai.ts"
Cohesion: 0.07
Nodes (70): legacyToolToExecutable(), MAX_TOOL_ITERATIONS, missingCapability(), resolveHttpTool(), runResolvedTool(), ToolCallRecord, toolInputSchema(), anthropicUsage() (+62 more)

### Community 3 - "sectorExecutions.ts"
Cohesion: 0.11
Nodes (23): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, finishSectorExecution() (+15 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.05
Nodes (57): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), ensureExecutionIndexes(), ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn() (+49 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (50): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+42 more)

### Community 6 - "index.ts"
Cohesion: 0.05
Nodes (35): stopEmbeddedEngine(), getBuiltinApp(), setActiveAgentId(), app, auxModelFor(), AVATAR_MIME_TYPES, buildStageTransitionOptions(), channelWebhookUrl() (+27 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (43): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentTool, AgentToolHeader, AgentToolParam (+35 more)

### Community 9 - "googleCalendar.ts"
Cohesion: 0.15
Nodes (19): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse (+11 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.08
Nodes (34): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+26 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.09
Nodes (35): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+27 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (27): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+19 more)

### Community 13 - "apps/types.ts"
Cohesion: 0.10
Nodes (27): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+19 more)

### Community 14 - "delegation.ts"
Cohesion: 0.11
Nodes (25): presetSpec(), suggestPresetForCapability(), asOutputFormat(), buildCapabilityMissing(), CapabilityMissing, childContext(), DEFAULT_DELEGATION_TOKEN_BUDGET, delegateToSector() (+17 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.09
Nodes (9): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), automations() (+1 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.25
Nodes (18): getAgentById(), buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError, RoutineSpec (+10 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "connections/repository.ts"
Cohesion: 0.11
Nodes (14): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), connections, deliveries, listDeliveries(), sentDeliveriesByAgent() (+6 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.14
Nodes (16): RecordAgentEventInput, instrumentTools(), AgentExecutionRequest, AgentExecutionResult, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError (+8 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.15
Nodes (9): automations, findByWebhookKey(), listAutomations(), ListAutomationsQuery, versions, signBody(), verifySignature(), webhookIdempotencyKey() (+1 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.22
Nodes (19): ensureActivationMode(), createEventTrigger(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), collectSectorRefs(), createAutomation(), defaultDefinition(), normalizeName() (+11 more)

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
Nodes (31): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 31 - "agentLiveState.ts"
Cohesion: 0.11
Nodes (22): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS, clearAgentState() (+14 more)

### Community 32 - "sectors.ts"
Cohesion: 0.17
Nodes (15): createSector(), deleteSector(), enforceSingleMembership(), normalizeMembers(), normalizeStages(), SECTOR_MODE_LABEL, SECTOR_MODES, SectorReadinessCode (+7 more)

### Community 33 - "registry.ts"
Cohesion: 0.10
Nodes (16): acceptsGenericConnect(), activationOf(), appCatalogPublic(), email, google, hubspot, LEGACY_APP_KEYS, mercadopago (+8 more)

### Community 34 - "engine.ts"
Cohesion: 0.07
Nodes (41): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+33 more)

### Community 35 - "navigation.ts"
Cohesion: 0.20
Nodes (13): buildNavigation(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus, preferences, resolveSurface(), setPinnedApps() (+5 more)

### Community 36 - "migration.ts"
Cohesion: 0.15
Nodes (22): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+14 more)

### Community 37 - "validate.ts"
Cohesion: 0.24
Nodes (11): AutomationValidationError, canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord(), validateDefinition() (+3 more)

### Community 38 - "tools.ts"
Cohesion: 0.09
Nodes (22): clamp(), createTool(), deleteTool(), getTool(), getToolsByIds(), listTools(), normalize(), TOOL_AUTH_KINDS (+14 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "privateApps.ts"
Cohesion: 0.18
Nodes (19): describeManifestIssues(), exportableManifest(), archivePrivateApp(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), isUsableManifest() (+11 more)

### Community 41 - "floorWork.ts"
Cohesion: 0.16
Nodes (17): checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows(), DELEGATION_MAX_DEPTH (+9 more)

### Community 42 - "installations.ts"
Cohesion: 0.11
Nodes (29): createInstallation(), CreateInstallationInput, decryptInstallationConfig(), deleteInstallation(), getInstallation(), installationPublic(), installations, listInstallations() (+21 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "automations/types.ts"
Cohesion: 0.14
Nodes (10): AutomationInput, AutomationLimits, AutomationVersion, DEFAULT_LIMITS, DeliveryTarget, ManualTrigger, RetryPolicy, ScheduleTrigger (+2 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "floorCommunication.ts"
Cohesion: 0.21
Nodes (12): buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode, FloorLink (+4 more)

### Community 47 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 48 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

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

### Community 53 - "agentEvents.ts"
Cohesion: 0.20
Nodes (11): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, events, finalizeAgentEvent(), finalizeAgentEventSafe() (+3 more)

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

### Community 58 - "toolExecution.ts"
Cohesion: 0.21
Nodes (11): ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets(), ToolExecutionResult (+3 more)

### Community 59 - "runRepository.ts"
Cohesion: 0.14
Nodes (19): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+11 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "jsonSchema.ts"
Cohesion: 0.31
Nodes (10): checkStageOutput(), describeErrors(), join(), matchesType(), Schema, SchemaError, typeOf(), validateAgainstSchema() (+2 more)

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 76 - "appGrantRoutes.ts"
Cohesion: 0.18
Nodes (12): ValidationError, CONNECTION_CATALOG, resolveOwnedSectorId(), appGrantRouter, auditEntity(), connectionRouter, fail(), notFound() (+4 more)

### Community 77 - "db.ts"
Cohesion: 0.15
Nodes (13): auth, db, mongoClient, AgentDoc, arg(), main(), SHOWCASE, aggregateSectorDecisions() (+5 more)

### Community 78 - "gateWiring.integration.test.mjs"
Cohesion: 0.53
Nodes (5): agents(), insertAgent(), insertSector(), sectors(), threeAnswers()

### Community 84 - "grants.ts"
Cohesion: 0.12
Nodes (30): Agent, ResolvedTool, AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate() (+22 more)

### Community 85 - "eventTrigger.ts"
Cohesion: 0.36
Nodes (9): buildEventTriggerDefinition(), EventTriggerError, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), getAutomation() (+1 more)

### Community 97 - "channelApps.ts"
Cohesion: 0.20
Nodes (14): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+6 more)

### Community 99 - "executionRoots.ts"
Cohesion: 0.12
Nodes (20): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+12 more)

### Community 100 - "seedRestaurantDemo.ts"
Cohesion: 0.23
Nodes (13): createAgent(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member() (+5 more)

### Community 101 - "sectorAccess.ts"
Cohesion: 0.21
Nodes (14): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+6 more)

### Community 102 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 105 - "connections/service.ts"
Cohesion: 0.29
Nodes (8): createConnection(), CreateConnectionInput, isNonEmpty(), normalizeName(), patchConnection(), PROVIDERS, validateConfig(), ConnectionProvider

### Community 106 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 107 - "agentLiveTracker.ts"
Cohesion: 0.24
Nodes (7): AgentBubbleState, catalogIndex(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail(), SYSTEM_APPS

### Community 108 - "sectorMembership.ts"
Cohesion: 0.24
Nodes (9): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, MAX_SECTOR_MEMBERS, SectorMember (+1 more)

### Community 109 - "delegateToAgent"
Cohesion: 0.44
Nodes (9): agentCard(), buildDelegationTools(), checkDelegation(), delegateToAgent(), gateContext(), gateTargetForAgent(), getCapabilities(), j() (+1 more)

### Community 110 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 111 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 113 - "selectVisualStates"
Cohesion: 0.33
Nodes (5): agentLiveStatesForFloor(), rank(), selectVisualStates(), NOW, row()

### Community 114 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 115 - "AutomationDefinition"
Cohesion: 0.31
Nodes (10): CreateAutomationInput, UpdateDraftPatch, Automation, AutomationDefinition, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent() (+2 more)

### Community 116 - "offices.ts"
Cohesion: 0.33
Nodes (4): createOffice(), ensureDefaultOffice(), Office, offices

### Community 117 - "delegationWiring.ts"
Cohesion: 0.14
Nodes (16): resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), DelegationContext, DelegationDeps, col, DelegationFinish, DelegationRecord (+8 more)

### Community 119 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 120 - "runService.ts"
Cohesion: 0.48
Nodes (6): createLiveTracker(), insertRunIdempotent(), createRun(), CreateRunInput, runExecutionKey(), startExecutionRoot()

### Community 121 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 122 - "channelApps.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addChannel(), addEmptyInstallation(), connections(), widgets()

### Community 123 - "migrate.ts"
Cohesion: 0.22
Nodes (17): ensureAgentLiveStateIndexes(), backfillManagedChannelInstallations(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes() (+9 more)

### Community 124 - "toolCallLog.ts"
Cohesion: 0.40
Nodes (4): listToolCalls(), logToolCalls(), ToolCallLog, toolCallLogs

### Community 125 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 131 - "channelOverview.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addWidget(), messages(), say(), widgets()

## Knowledge Gaps
- **483 isolated node(s):** `FloorCommunicationMode`, `FLOOR_COMMUNICATION_MODES`, `FloorLinkDirection`, `FloorLink`, `COMMUNICATION_LABEL` (+478 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.221) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `runProcessor.ts`?**
  _High betweenness centrality (0.220) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `channelOverview.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `floorWork.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `gateWiring.integration.test.mjs`, `appRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `hardening.integration.test.mjs`, `migrationFixture.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `toolsSecurity.test.mjs`, `sectorExecutions.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `channelApps.integration.test.mjs`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `FloorCommunicationMode`, `FLOOR_COMMUNICATION_MODES`, `FloorLinkDirection` to the rest of the system?**
  _483 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10128205128205128 - nodes in this community are weakly interconnected._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07063063063063063 - nodes in this community are weakly interconnected._