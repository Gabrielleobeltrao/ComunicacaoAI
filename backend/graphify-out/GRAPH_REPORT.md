# Graph Report - backend  (2026-08-15)

## Corpus Check
- 185 files · ~187,334 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1847 nodes · 4084 edges · 132 communities (121 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `18a501f7`
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
- db.ts
- delegateToSector
- engine.ts
- agentEvents.ts
- migration.ts
- validate.ts
- tools.ts
- eventTrigger.integration.test.mjs
- toolsSecurity.test.mjs
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
- providerApps.ts
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
- agentLiveTracker.ts
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
- seedAgentBubbles.ts
- privateApps.ts
- sectorExecutions.integration.test.mjs
- ResolvedTool
- config.ts
- delegationWiring.ts
- collaborationGate.test.mjs
- executionRoots.integration.test.mjs
- scheduler.ts
- sectorAccess.integration.test.mjs
- channelApps.integration.test.mjs
- webhookTriggers.ts
- builtinTools.ts
- safeHttp.ts
- offices.ts
- selectVisualStates
- floorWork.ts
- toolCallLog.ts
- multer
- channelOverview.integration.test.mjs

## God Nodes (most connected - your core abstractions)
1. `db` - 47 edges
2. `respondWithAgentIfLinked()` - 33 edges
3. `buildDeps()` - 28 edges
4. `startMongo()` - 27 edges
5. `stopMongo()` - 27 edges
6. `encrypt()` - 26 edges
7. `productionDelegationDeps()` - 25 edges
8. `getAgentById()` - 25 edges
9. `refreshMemoryAndIdentity()` - 23 edges
10. `getApp()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `buildDeps()` --indirect_call--> `runEventKey()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (132 total, 11 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.22
Nodes (17): agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact(), insertStepRun(), updateRun() (+9 more)

### Community 1 - "floors.ts"
Cohesion: 0.11
Nodes (31): liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, Building, BuildingLanguage, BuildingPatch, buildings (+23 more)

### Community 2 - "openai.ts"
Cohesion: 0.06
Nodes (73): ToolCallRecord, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), FALLBACK_MODELS (+65 more)

### Community 3 - "sectorExecutions.ts"
Cohesion: 0.10
Nodes (24): requireAgent(), parseFilters(), oid(), PERIODS, requireSector(), sectorExecutionRouter, agentEvents, durationOf() (+16 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (49): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, chunks (+41 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (49): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+41 more)

### Community 6 - "index.ts"
Cohesion: 0.05
Nodes (41): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), setActiveAgentId(), app, auxModelFor() (+33 more)

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
Cohesion: 0.12
Nodes (28): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+20 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (27): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+19 more)

### Community 13 - "apps/types.ts"
Cohesion: 0.10
Nodes (26): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+18 more)

### Community 14 - "delegation.ts"
Cohesion: 0.12
Nodes (20): presetSpec(), suggestPresetForCapability(), agentCanDelegate(), buildCapabilityMissing(), CapabilityMissing, capabilityMissingTool(), DEFAULT_DELEGATION_TOKEN_BUDGET, DELEGATION_MAX_DEPTH (+12 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.10
Nodes (9): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), automations() (+1 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.21
Nodes (20): EventTriggerError, EventTriggerSpec, buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError (+12 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): inboundMediaToText(), getProviderApiKey(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "connections/service.ts"
Cohesion: 0.23
Nodes (10): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, getConnection(), isNonEmpty(), normalizeName(), patchConnection(), PROVIDERS (+2 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.15
Nodes (14): RecordAgentEventInput, AgentExecutionRequest, AgentExecutionResult, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineExecutionDeps (+6 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, signBody() (+4 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.19
Nodes (17): assertOwnedSectorRefs(), collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName(), requireFloor(), rotateWebhookSecret() (+9 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, cron-parser, express, mongodb, nodemailer, openai (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "agentRuntime.ts"
Cohesion: 0.21
Nodes (12): AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), executeAgentTask(), inputToText() (+4 more)

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
Cohesion: 0.08
Nodes (32): ensureActivationMode(), addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel() (+24 more)

### Community 31 - "agentLiveState.ts"
Cohesion: 0.11
Nodes (21): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS, clearAgentState() (+13 more)

### Community 32 - "db.ts"
Cohesion: 0.09
Nodes (28): auth, db, mongoClient, AgentDoc, assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail (+20 more)

### Community 33 - "delegateToSector"
Cohesion: 0.22
Nodes (16): agentCard(), asOutputFormat(), buildDelegationTools(), checkDelegation(), childContext(), delegateToAgent(), delegateToSector(), getCapabilities() (+8 more)

### Community 34 - "engine.ts"
Cohesion: 0.17
Nodes (16): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+8 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.20
Nodes (11): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), recordAgentEvent() (+3 more)

### Community 36 - "migration.ts"
Cohesion: 0.15
Nodes (22): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+14 more)

### Community 37 - "validate.ts"
Cohesion: 0.24
Nodes (11): AutomationValidationError, canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord(), validateDefinition() (+3 more)

### Community 38 - "tools.ts"
Cohesion: 0.10
Nodes (20): clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS, TOOL_LIMITS (+12 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 41 - "connections/types.ts"
Cohesion: 0.18
Nodes (12): chunkTelegram(), FetchImpl, MailTransport, maskDestination(), sendEmail(), sendTelegram(), Connection, ConnectionStatus (+4 more)

### Community 42 - "installations.ts"
Cohesion: 0.11
Nodes (23): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installations, markInstallationTested(), normalizeConfig(), normalizeName() (+15 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "automations/types.ts"
Cohesion: 0.10
Nodes (23): createLiveTracker(), findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, AutomationRun, SafeRunError, AutomationInput (+15 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "floorCommunication.ts"
Cohesion: 0.13
Nodes (20): checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows(), buildings (+12 more)

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

### Community 58 - "providerApps.ts"
Cohesion: 0.38
Nodes (8): hubspotTools(), mercadoPagoTools(), num(), nuvemshopTools(), objectSchema(), rdStationTools(), slackTools(), stripeTools()

### Community 59 - "runRepository.ts"
Cohesion: 0.15
Nodes (16): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+8 more)

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

### Community 76 - "agentLiveTracker.ts"
Cohesion: 0.22
Nodes (9): AgentBubbleState, finishAgentState(), catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail() (+1 more)

### Community 77 - "toolExecution.ts"
Cohesion: 0.23
Nodes (10): executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets(), ToolExecutionResult, SENSITIVE_HEADER (+2 more)

### Community 78 - "registry.ts"
Cohesion: 0.11
Nodes (15): acceptsGenericConnect(), activationOf(), appCatalogPublic(), email, google, hubspot, LEGACY_APP_KEYS, mercadopago (+7 more)

### Community 84 - "grants.ts"
Cohesion: 0.21
Nodes (16): missingCapability(), AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate(), isVersionCompatible() (+8 more)

### Community 85 - "navigation.ts"
Cohesion: 0.20
Nodes (15): installationPublic(), listInstallations(), buildNavigation(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus, preferences (+7 more)

### Community 97 - "channelApps.ts"
Cohesion: 0.20
Nodes (14): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+6 more)

### Community 99 - "executionRoots.ts"
Cohesion: 0.15
Nodes (16): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, executionAnalytics(), executionBreakdown(), ExecutionEnvironment (+8 more)

### Community 100 - "seedRestaurantDemo.ts"
Cohesion: 0.19
Nodes (16): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+8 more)

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
Cohesion: 0.26
Nodes (14): getAgentById(), buildEventTriggerDefinition(), createEventTrigger(), getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), assertOwnedAgentRefs() (+6 more)

### Community 112 - "seedAgentBubbles.ts"
Cohesion: 0.60
Nodes (4): ensureAgentLiveStateIndexes(), arg(), main(), SHOWCASE

### Community 113 - "privateApps.ts"
Cohesion: 0.23
Nodes (14): describeManifestIssues(), exportableManifest(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listPrivateApps(), normalize() (+6 more)

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
Nodes (17): DelegationContext, DelegationDeps, col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus, ensureDelegationIndexes() (+9 more)

### Community 119 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 120 - "scheduler.ts"
Cohesion: 0.24
Nodes (12): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes(), planSchedules() (+4 more)

### Community 121 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 122 - "channelApps.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addChannel(), addEmptyInstallation(), connections(), widgets()

### Community 123 - "webhookTriggers.ts"
Cohesion: 0.42
Nodes (8): syncEventTriggerFor(), Automation, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent(), liveWebhookCountFor(), PublishedAutomation

### Community 124 - "builtinTools.ts"
Cohesion: 0.19
Nodes (12): Agent, resolveAppGrantTools(), APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField (+4 more)

### Community 125 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 126 - "offices.ts"
Cohesion: 0.33
Nodes (4): createOffice(), ensureDefaultOffice(), Office, offices

### Community 127 - "selectVisualStates"
Cohesion: 0.33
Nodes (5): agentLiveStatesForFloor(), rank(), selectVisualStates(), NOW, row()

### Community 128 - "floorWork.ts"
Cohesion: 0.36
Nodes (7): Floor, agents, competencyOf(), effectiveTargets(), FloorTarget, floorWorkOverview, sectors

### Community 129 - "toolCallLog.ts"
Cohesion: 0.40
Nodes (4): listToolCalls(), logToolCalls(), ToolCallLog, toolCallLogs

### Community 131 - "channelOverview.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addWidget(), messages(), say(), widgets()

## Knowledge Gaps
- **484 isolated node(s):** `ChannelAppKey`, `widgets`, `messages`, `google`, `slack` (+479 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`?**
  _High betweenness centrality (0.137) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `runProcessor.ts` to `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.136) - this node is a cross-community bridge._
- **Why does `db` connect `db.ts` to `floorWork.ts`, `floors.ts`, `toolCallLog.ts`, `sectorExecutions.ts`, `knowledge.ts`, `executionCenter.ts`, `index.ts`, `audit.ts`, `agents.ts`, `encrypt`, `respondWithAgentIfLinked`, `automations/repository.ts`, `widgets.ts`, `agentLiveState.ts`, `agentEvents.ts`, `migration.ts`, `tools.ts`, `installations.ts`, `floorCommunication.ts`, `tokenUsage.ts`, `connections/repository.ts`, `runRepository.ts`, `grants.ts`, `navigation.ts`, `channelApps.ts`, `executionRoots.ts`, `seedRestaurantDemo.ts`, `sectorAccess.ts`, `migrate.ts`, `userSettings.ts`, `seedAgentBubbles.ts`, `privateApps.ts`, `delegationWiring.ts`, `scheduler.ts`, `offices.ts`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ChannelAppKey`, `widgets`, `messages` to the rest of the system?**
  _484 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1066066066066066 - nodes in this community are weakly interconnected._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.063568010936432 - nodes in this community are weakly interconnected._