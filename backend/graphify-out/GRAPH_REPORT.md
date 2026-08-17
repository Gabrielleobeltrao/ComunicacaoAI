# Graph Report - backend  (2026-08-17)

## Corpus Check
- 258 files · ~252,774 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2278 nodes · 5278 edges · 156 communities (131 shown, 25 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 42 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `264caa7d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- runProcessor.ts
- openai.ts
- runConfig.ts
- knowledge.ts
- executionCenter.ts
- src/index.ts
- audit.ts
- agents.ts
- grants.ts
- agentReadiness.ts
- respondWithAgentIfLinked
- runner.ts
- agentLiveState.ts
- delegation.ts
- mongoServer.mjs
- agentRoutineRoutes.ts
- whatsapp.ts
- patterns.ts
- routineExecution.ts
- automations/service.ts
- apps/types.ts
- dependencies
- agentMetrics.ts
- migration.ts
- installations.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- migrate.ts
- sectors.ts
- runRepository.ts
- sourceMonitoring.test.mjs
- sourceSsrf.test.mjs
- providerApps.ts
- official/index.ts
- tools.ts
- eventTrigger.integration.test.mjs
- executionRoots.ts
- automations/repository.ts
- seedRestaurantDemo.ts
- scripts
- validate.ts
- package.json
- connections/service.ts
- googleCalendar.ts
- floorWork.ts
- delegation.test.mjs
- runnerTimeout.test.mjs
- runtimeHardening.test.mjs
- schedulerPublish.integration.test.mjs
- agentEvents.ts
- agentHistory.integration.test.mjs
- auditRouteMap.test.mjs
- routineDelivery.integration.test.mjs
- deployment.test.mjs
- agentDefinition.test.mjs
- AppDefinition
- collaboration.test.mjs
- config.test.mjs
- groundingContract.test.mjs
- jsonSchema.test.mjs
- outputContract.test.mjs
- readiness.test.mjs
- automations.test.mjs
- dotenv
- floors.ts
- delegationWiring.ts
- automations/types.ts
- routine.test.mjs
- seedGuard.test.mjs
- privateApps.ts
- floorCommunication.ts
- db.ts
- navigation.ts
- sectorExecutions.ts
- agentTools.ts
- records.ts
- scheduler.ts
- sectorAccess.ts
- eventTrigger.ts
- builtinTools.ts
- tokenUsage.ts
- run-tests.mjs
- sourceCheckpoint.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- agentLiveTracker.ts
- sectorExecutions.integration.test.mjs
- config.ts
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- agentRuntime.ts
- executionModes.integration.test.mjs
- appMigration.integration.test.mjs
- building.ts
- sectorAccess.integration.test.mjs
- appRoutes.integration.test.mjs
- collaborationGate.test.mjs
- floorWork.integration.test.mjs
- gateWiring.integration.test.mjs
- userSettings.ts
- channelApps.integration.test.mjs
- channelOverview.integration.test.mjs
- llmFakeGate.test.mjs
- engine.ts
- logHygiene.test.mjs
- sourceCheckpoint.integration.test.mjs
- cron-parser
- toolsSecurity.test.mjs
- providerPayload.test.mjs
- conversationTurns.ts
- safeError.ts
- migrationFixture.integration.test.mjs
- selectVisualStates
- mongoClient
- toolCallLog.ts
- memoryStore.integration.test.mjs
- hubspot/adapter.ts
- hardening.integration.test.mjs
- candleAnalyzer.test.mjs
- mercado-pago/adapter.ts
- rd-station/adapter.ts
- getSectorById
- email/manifest.ts
- telegram/manifest.ts
- web-chat/manifest.ts
- whatsapp/manifest.ts

## God Nodes (most connected - your core abstractions)
1. `db` - 50 edges
2. `buildDeps()` - 39 edges
3. `respondWithAgentIfLinked()` - 38 edges
4. `startMongo()` - 34 edges
5. `stopMongo()` - 34 edges
6. `getAgentById()` - 30 edges
7. `encrypt()` - 26 edges
8. `refreshMemoryAndIdentity()` - 24 edges
9. `productionDelegationDeps()` - 24 edges
10. `AppDefinition` - 23 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts
- `resolveAgentTools()` --indirect_call--> `resolveHttpTool()`  [INFERRED]
  src/builtinTools.ts → src/agentTools.ts
- `resolveOwnedAgentId()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (156 total, 25 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.17
Nodes (18): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, auxiliaryModel(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), FAKE_LLM_ENABLED, generateAgentReply() (+10 more)

### Community 1 - "runProcessor.ts"
Cohesion: 0.14
Nodes (30): runEventKey(), createLiveTracker(), findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor() (+22 more)

### Community 2 - "openai.ts"
Cohesion: 0.05
Nodes (73): MAX_TOOL_ITERATIONS, ToolCallRecord, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractIdentity(), extractStructuredOutput() (+65 more)

### Community 3 - "runConfig.ts"
Cohesion: 0.12
Nodes (25): AgentDefinition, composeAgentPrompt(), definitionOf(), resolveAgentRun(), resolveCache(), ResolvedAgentRun, ResolveRunOptions, ReplyOptions (+17 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.07
Nodes (42): chunks, chunkText(), combineKnowledgeHits(), createDocument(), createDocumentFor(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent() (+34 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (48): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+40 more)

### Community 6 - "src/index.ts"
Cohesion: 0.05
Nodes (41): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), setActiveAgentId(), app, auxModelFor() (+33 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (41): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentTool, AgentToolHeader, AgentToolParam (+33 more)

### Community 9 - "grants.ts"
Cohesion: 0.18
Nodes (20): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+12 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (30): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+22 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.09
Nodes (36): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+28 more)

### Community 12 - "runner.ts"
Cohesion: 0.07
Nodes (54): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, MemoryOps, runDefinition(), RunnerDeps (+46 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.11
Nodes (25): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS, clearAgentState() (+17 more)

### Community 14 - "delegation.ts"
Cohesion: 0.11
Nodes (35): presetSpec(), suggestPresetForCapability(), checkCollaboration(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing (+27 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.09
Nodes (9): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), automations() (+1 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.11
Nodes (38): EventTriggerError, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), normalizeCondition(), webhookEndpoint(), createRoutine(), getRoutineForAgent() (+30 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.18
Nodes (11): executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineRunContext, RoutineStepCall, RoutineStepResult, StepUsage (+3 more)

### Community 20 - "automations/service.ts"
Cohesion: 0.13
Nodes (31): ensureActivationMode(), getAgentById(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput (+23 more)

### Community 21 - "apps/types.ts"
Cohesion: 0.10
Nodes (26): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+18 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "migration.ts"
Cohesion: 0.12
Nodes (29): AgentBuiltinTool, toPublicAgent(), agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+21 more)

### Community 25 - "installations.ts"
Cohesion: 0.13
Nodes (20): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installations, LEGACY_APP_VERSION, markInstallationTested(), normalizeConfig() (+12 more)

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

### Community 31 - "migrate.ts"
Cohesion: 0.13
Nodes (23): ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes() (+15 more)

### Community 32 - "sectors.ts"
Cohesion: 0.11
Nodes (24): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+16 more)

### Community 33 - "runRepository.ts"
Cohesion: 0.12
Nodes (23): artifacts, findRun(), insertRunIdempotent(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel() (+15 more)

### Community 36 - "providerApps.ts"
Cohesion: 0.25
Nodes (10): adapters, manifest, hubspotTools(), mercadoPagoTools(), num(), nuvemshopTools(), objectSchema(), rdStationTools() (+2 more)

### Community 37 - "official/index.ts"
Cohesion: 0.17
Nodes (10): MODULES, OFFICIAL_ADAPTERS, OFFICIAL_APPS, OfficialAppsError, OfficialModule, adapters, manifest, adapters (+2 more)

### Community 38 - "tools.ts"
Cohesion: 0.10
Nodes (22): encrypt(), clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS (+14 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.12
Nodes (21): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+13 more)

### Community 41 - "automations/repository.ts"
Cohesion: 0.13
Nodes (13): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+5 more)

### Community 42 - "seedRestaurantDemo.ts"
Cohesion: 0.23
Nodes (13): createAgent(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member() (+5 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "validate.ts"
Cohesion: 0.18
Nodes (19): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, evaluateCondition(), isConditionOperator(), StepCondition, canonical() (+11 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "connections/service.ts"
Cohesion: 0.09
Nodes (22): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), connections, deliveries, listDeliveries(), sentDeliveriesByAgent() (+14 more)

### Community 47 - "googleCalendar.ts"
Cohesion: 0.14
Nodes (19): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse (+11 more)

### Community 48 - "floorWork.ts"
Cohesion: 0.13
Nodes (20): AgentExecutionRequest, AgentExecutionResult, Agent, AgentAppGrant, RoutineExecutionDeps, CollaborationDecision, CollaborationDenyCode, discoverable() (+12 more)

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
Nodes (11): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), recordAgentEvent() (+3 more)

### Community 54 - "agentHistory.integration.test.mjs"
Cohesion: 0.25
Nodes (4): AGENT, FLOOR, OTHER_AGENT, ROUTINE

### Community 55 - "auditRouteMap.test.mjs"
Cohesion: 0.29
Nodes (5): ACTIONS, declaredRoutes(), readSource(), ROUTER_PREFIX, SOURCE_DIR

### Community 56 - "routineDelivery.integration.test.mjs"
Cohesion: 0.20
Nodes (8): AGENT, BUILDING, CONNECTION, FLOOR, memoriaNoAgente, monitor(), RSS, spec()

### Community 57 - "deployment.test.mjs"
Cohesion: 0.29
Nodes (4): compose, coolify, envExample, pkg

### Community 59 - "AppDefinition"
Cohesion: 0.38
Nodes (7): adapters, manifest, native(), num(), schema(), str(), AppDefinition

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 76 - "floors.ts"
Cohesion: 0.10
Nodes (32): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, Building, BuildingLanguage, DEFAULT_TIMEZONE (+24 more)

### Community 77 - "delegationWiring.ts"
Cohesion: 0.16
Nodes (14): agentCanDelegate(), capabilityMissingTool(), DelegationContext, col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus (+6 more)

### Community 78 - "automations/types.ts"
Cohesion: 0.14
Nodes (17): EventTriggerSpec, AppActionPlan, MemoryPlan, RoutineSpec, AI_STEP_TYPES, AutomationInput, AutomationLimits, DEFAULT_LIMITS (+9 more)

### Community 84 - "privateApps.ts"
Cohesion: 0.20
Nodes (16): describeManifestIssues(), exportableManifest(), archivePrivateApp(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listAppsForOwner() (+8 more)

### Community 85 - "floorCommunication.ts"
Cohesion: 0.21
Nodes (12): buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode, FloorLink (+4 more)

### Community 96 - "db.ts"
Cohesion: 0.20
Nodes (15): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+7 more)

### Community 97 - "navigation.ts"
Cohesion: 0.18
Nodes (17): installationPublic(), listInstallations(), buildNavigation(), dropPinsForApp(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus (+9 more)

### Community 98 - "sectorExecutions.ts"
Cohesion: 0.11
Nodes (23): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, finishSectorExecution() (+15 more)

### Community 99 - "agentTools.ts"
Cohesion: 0.13
Nodes (25): legacyToolToExecutable(), resolveHttpTool(), runResolvedTool(), toolInputSchema(), checkStageOutput(), describeErrors(), join(), matchesType() (+17 more)

### Community 100 - "records.ts"
Cohesion: 0.08
Nodes (46): readPath(), assertAgentMayWrite(), floors, MemoryAccessError, ResolvedScope, resolveTarget(), scopesForAgent(), scopesForOwner() (+38 more)

### Community 101 - "scheduler.ts"
Cohesion: 0.23
Nodes (13): findVersion(), advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes() (+5 more)

### Community 102 - "sectorAccess.ts"
Cohesion: 0.20
Nodes (15): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+7 more)

### Community 103 - "eventTrigger.ts"
Cohesion: 0.24
Nodes (24): describeCondition(), buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), readEventTriggerConfig(), updateEventTrigger(), aiStepPlanned(), appStep() (+16 more)

### Community 104 - "builtinTools.ts"
Cohesion: 0.18
Nodes (13): ResolvedTool, APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, getBuiltinApp() (+5 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "sourceCheckpoint.ts"
Cohesion: 0.20
Nodes (10): acquireSourceLease(), checkpoints, ehChaveDuplicada(), getCheckpoint(), LEASE_MS, leases, MAX_SEEN_KEYS, SourceCheckpoint (+2 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "agentLiveTracker.ts"
Cohesion: 0.27
Nodes (7): AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail()

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "config.ts"
Cohesion: 0.24
Nodes (9): auth, clientUrl, config, isProduction, originList(), port, stripTrailingSlash(), urlVar() (+1 more)

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "agentRuntime.ts"
Cohesion: 0.20
Nodes (14): AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+6 more)

### Community 117 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "building.ts"
Cohesion: 0.16
Nodes (11): BuildingPatch, buildings, ValidationError, CONNECTION_CATALOG, appGrantRouter, auditEntity(), automationRouter, connectionRouter (+3 more)

### Community 120 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 123 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 124 - "gateWiring.integration.test.mjs"
Cohesion: 0.53
Nodes (5): agents(), insertAgent(), insertSector(), sectors(), threeAnswers()

### Community 125 - "userSettings.ts"
Cohesion: 0.22
Nodes (9): decrypt(), getKey(), clearProviderApiKey(), FIELD_BY_PROVIDER, getProviderKeyStatus(), setMonthlyTokenCap(), setProviderApiKey(), settings (+1 more)

### Community 126 - "channelApps.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addChannel(), addEmptyInstallation(), connections(), widgets()

### Community 127 - "channelOverview.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addWidget(), messages(), say(), widgets()

### Community 129 - "engine.ts"
Cohesion: 0.15
Nodes (18): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+10 more)

### Community 131 - "sourceCheckpoint.integration.test.mjs"
Cohesion: 0.25
Nodes (5): agora, AUTOMACAO, FONTE, OUTRA_FONTE, QUANDO

### Community 134 - "providerPayload.test.mjs"
Cohesion: 0.22
Nodes (5): AnthropicFalso, enviado, OpenAIFalso, respostaAnthropic, respostaOpenAI

### Community 135 - "conversationTurns.ts"
Cohesion: 0.25
Nodes (7): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME

### Community 137 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 139 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 140 - "selectVisualStates"
Cohesion: 0.33
Nodes (5): agentLiveStatesForFloor(), rank(), selectVisualStates(), NOW, row()

### Community 141 - "mongoClient"
Cohesion: 0.40
Nodes (3): mongoClient, AgentDoc, Sector

### Community 142 - "toolCallLog.ts"
Cohesion: 0.40
Nodes (4): listToolCalls(), logToolCalls(), ToolCallLog, toolCallLogs

### Community 143 - "memoryStore.integration.test.mjs"
Cohesion: 0.22
Nodes (7): AGENTE, ANDAR, CHAVE_AGENTE, CHAVE_SETOR, noAgente, noSetor, SETOR

### Community 150 - "getSectorById"
Cohesion: 0.50
Nodes (4): resolveOwnedSectorId(), requireSector(), requireSector(), getSectorById()

## Knowledge Gaps
- **561 isolated node(s):** `raiz`, `dirTestes`, `LIMITE_MONGO`, `arquivos`, `comBanco` (+556 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.160) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `runProcessor.ts`?**
  _High betweenness centrality (0.160) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `sourceCheckpoint.integration.test.mjs`, `toolsSecurity.test.mjs`, `migrationFixture.integration.test.mjs`, `memoryStore.integration.test.mjs`, `hardening.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sourceStaleRun.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `executionModes.integration.test.mjs`, `appMigration.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `appRoutes.integration.test.mjs`, `floorWork.integration.test.mjs`, `gateWiring.integration.test.mjs`, `channelApps.integration.test.mjs`, `channelOverview.integration.test.mjs`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `raiz`, `dirTestes`, `LIMITE_MONGO` to the rest of the system?**
  _561 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `runProcessor.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13763440860215054 - nodes in this community are weakly interconnected._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05479818230419674 - nodes in this community are weakly interconnected._