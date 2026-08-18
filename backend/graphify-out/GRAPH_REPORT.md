# Graph Report - backend  (2026-08-18)

## Corpus Check
- 283 files · ~289,740 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2451 nodes · 5659 edges · 156 communities (137 shown, 19 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 42 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1ab3c3e1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- automations/service.ts
- floorWork.ts
- agentRuntime.ts
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
- agentEvents.ts
- whatsapp.ts
- patterns.ts
- routineExecution.ts
- eventTrigger.ts
- apps/types.ts
- dependencies
- agentMetrics.ts
- migration.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- migrate.ts
- sectors.ts
- runRepository.ts
- sourceMonitoring.test.mjs
- connections/service.ts
- modelCache.ts
- agentDefinition.ts
- tools.ts
- eventTrigger.integration.test.mjs
- executionRoots.ts
- jsonSchema.ts
- executionModes.integration.test.mjs
- scripts
- validate.ts
- package.json
- migrationFixture.integration.test.mjs
- installations.ts
- googleCalendar.ts
- delegation.test.mjs
- runnerTimeout.test.mjs
- runtimeHardening.test.mjs
- schedulerPublish.integration.test.mjs
- providerPayload.test.mjs
- agentHistory.integration.test.mjs
- auditRouteMap.test.mjs
- routineDelivery.integration.test.mjs
- deployment.test.mjs
- delegateToAgent
- privateApps.ts
- collaboration.test.mjs
- memoryStore.integration.test.mjs
- config.test.mjs
- groundingContract.test.mjs
- jsonSchema.test.mjs
- outputContract.test.mjs
- readiness.test.mjs
- automations.test.mjs
- dotenv
- agentLiveTracker.ts
- delegationWiring.ts
- automations/repository.ts
- routine.test.mjs
- seedGuard.test.mjs
- runService.ts
- seedRestaurantDemo.ts
- registry.ts
- executionRoutes.ts
- sectorExecutions.ts
- llmFake.ts
- entrypointParity.test.mjs
- tokensByModel.integration.test.mjs
- runConfig.ts
- agentRoutineRoutes.ts
- listScheduled
- tokenUsage.ts
- run-tests.mjs
- runProcessor.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- builtinTools.ts
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- agentTools.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- floorCommunication.ts
- sectorAccess.integration.test.mjs
- autoModel.ts
- collaborationGate.test.mjs
- floorWork.integration.test.mjs
- gateWiring.integration.test.mjs
- channelApps.integration.test.mjs
- channelOverview.integration.test.mjs
- llmFakeGate.test.mjs
- engine.ts
- logHygiene.test.mjs
- sourceCheckpoint.integration.test.mjs
- cron-parser
- executionSummary
- sourceTool.integration.test.mjs
- timeoutCancellation.test.mjs
- toolsSecurity.test.mjs
- sectorTeam.integration.test.mjs
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- safeError.ts
- db.ts
- floors.ts
- openai.ts
- sourceSsrf.test.mjs
- collaborationGate.ts
- connections/repository.ts
- hardening.integration.test.mjs
- clarify.ts

## God Nodes (most connected - your core abstractions)
1. `respondWithAgentIfLinked()` - 52 edges
2. `db` - 50 edges
3. `startMongo()` - 41 edges
4. `stopMongo()` - 41 edges
5. `buildDeps()` - 39 edges
6. `getAgentById()` - 31 edges
7. `productionDelegationDeps()` - 27 edges
8. `encrypt()` - 26 edges
9. `refreshMemoryAndIdentity()` - 24 edges
10. `AppDefinition` - 23 edges

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
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (156 total, 19 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.14
Nodes (22): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, getWidgetConfigAgent(), inboundMediaToText(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity() (+14 more)

### Community 1 - "automations/service.ts"
Cohesion: 0.08
Nodes (38): assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName(), requireFloor() (+30 more)

### Community 2 - "floorWork.ts"
Cohesion: 0.14
Nodes (22): Floor, agents, competencyOf(), effectiveTargets(), FloorTarget, floorWorkOverview, sectors, serializeSector() (+14 more)

### Community 3 - "agentRuntime.ts"
Cohesion: 0.13
Nodes (26): enforceOutputContract(), AgentExecutionRequest, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), executeAgentTask() (+18 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.05
Nodes (58): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, chunks (+50 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.10
Nodes (24): ACTIVE_RUN_STATUSES, AgentRef, agents, AutomationDoc, automations, decodeRunCursor(), encodeRunCursor(), ExecutionPage (+16 more)

### Community 6 - "src/index.ts"
Cohesion: 0.04
Nodes (39): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), ensureDelegationIndexes(), app, AVATAR_MIME_TYPES (+31 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (52): sanitizeActivationWrite(), ACTIVATION_MODES, Agent, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentToolHeader (+44 more)

### Community 9 - "grants.ts"
Cohesion: 0.17
Nodes (23): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+15 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (32): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+24 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.08
Nodes (39): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+31 more)

### Community 12 - "runner.ts"
Cohesion: 0.06
Nodes (65): LivePassage, liveStepIdFor(), STEP(), RoutineSource, AgentCall, delay(), DeliverCall, executeStep() (+57 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.08
Nodes (32): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+24 more)

### Community 14 - "delegation.ts"
Cohesion: 0.09
Nodes (28): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, buildCapabilityMissing(), CapabilityMissing, capabilityMissingTool(), childContext(), DEFAULT_DELEGATION_TOKEN_BUDGET (+20 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.07
Nodes (14): FLOOR, call(), connectSlack(), PAGE, OPCOES, AGENTE, SETOR, startMongo() (+6 more)

### Community 16 - "agentEvents.ts"
Cohesion: 0.18
Nodes (12): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, events, finalizeAgentEvent(), finalizeAgentEventSafe() (+4 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.14
Nodes (18): ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter(), InboundMediaRef, InboundMessage (+10 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.14
Nodes (15): RecordAgentEventInput, AgentExecutionResult, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineExecutionDeps, RoutineRunContext (+7 more)

### Community 20 - "eventTrigger.ts"
Cohesion: 0.21
Nodes (29): ensureActivationMode(), getAgentById(), buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), readEventTriggerConfig(), updateEventTrigger(), aiStepPlanned() (+21 more)

### Community 21 - "apps/types.ts"
Cohesion: 0.07
Nodes (36): manifest, adapters, manifest, MODULES, OFFICIAL_ADAPTERS, OfficialAppsError, OfficialModule, adapters (+28 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.16
Nodes (16): AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel(), kpiShortLabel() (+8 more)

### Community 24 - "migration.ts"
Cohesion: 0.11
Nodes (27): AgentBuiltinTool, revokeInstallation(), agents, AppMigrationReport, credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation(), ensureGoogleInstallations() (+19 more)

### Community 25 - "records.ts"
Cohesion: 0.07
Nodes (51): readPath(), clarificationKey(), ClarifyMemoryTarget, recallClarifications(), rememberClarification(), assertAgentMayWrite(), floors, MemoryAccessError (+43 more)

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
Cohesion: 0.12
Nodes (25): ensureAppActionIndexes(), ensureInstallationIndexes(), backfillConnectionAppKeys(), migrateAppsAndInstallations(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes() (+17 more)

### Community 32 - "sectors.ts"
Cohesion: 0.12
Nodes (25): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+17 more)

### Community 33 - "runRepository.ts"
Cohesion: 0.13
Nodes (19): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+11 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.12
Nodes (20): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), createConnection(), CreateConnectionInput, isNonEmpty(), normalizeName() (+12 more)

### Community 36 - "modelCache.ts"
Cohesion: 0.29
Nodes (9): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), humanizeModelId(), isChatModel() (+1 more)

### Community 37 - "agentDefinition.ts"
Cohesion: 0.15
Nodes (15): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+7 more)

### Community 38 - "tools.ts"
Cohesion: 0.10
Nodes (20): clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS, TOOL_LIMITS (+12 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.12
Nodes (21): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+13 more)

### Community 41 - "jsonSchema.ts"
Cohesion: 0.20
Nodes (16): checkJson(), parseJsonOutput(), runResolvedTool(), checkStageOutput(), checkJsonText(), JsonCheck, parseJsonText(), describeErrors() (+8 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "validate.ts"
Cohesion: 0.18
Nodes (19): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), normalizeCondition() (+11 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "installations.ts"
Cohesion: 0.07
Nodes (42): channelOverview, createInstallation(), CreateInstallationInput, deleteInstallation(), installationPublic(), installations, LEGACY_APP_VERSION, listInstallations() (+34 more)

### Community 48 - "googleCalendar.ts"
Cohesion: 0.13
Nodes (21): adapters, manifest, buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), googleConfigured() (+13 more)

### Community 49 - "delegation.test.mjs"
Cohesion: 0.22
Nodes (8): B, BUILDING, buscar(), comCompetencias(), ctxFor(), FLOOR_A, FLOOR_B, mkAgent()

### Community 50 - "runnerTimeout.test.mjs"
Cohesion: 0.25
Nodes (3): AGENT_ID, baseDeps(), runnerFor()

### Community 51 - "runtimeHardening.test.mjs"
Cohesion: 0.28
Nodes (6): AGENT_ID, delegateTo(), dispatch(), FLOOR, SECTOR_ID, targetAgent()

### Community 52 - "schedulerPublish.integration.test.mjs"
Cohesion: 0.39
Nodes (6): automations(), definition(), editDraft(), seedPublished(), step(), versions()

### Community 53 - "providerPayload.test.mjs"
Cohesion: 0.18
Nodes (8): AnthropicFalso, enviado, lenta(), medirAnthropic(), OpenAIFalso, pedindoDuas(), respostaAnthropic, respostaOpenAI

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

### Community 58 - "delegateToAgent"
Cohesion: 0.27
Nodes (14): agentCard(), asOutputFormat(), buildDelegationTools(), checkDelegation(), delegateToAgent(), delegateToSector(), gateContext(), gateTargetForAgent() (+6 more)

### Community 59 - "privateApps.ts"
Cohesion: 0.11
Nodes (30): describeManifestIssues(), exportableManifest(), FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest() (+22 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "memoryStore.integration.test.mjs"
Cohesion: 0.22
Nodes (7): AGENTE, ANDAR, CHAVE_AGENTE, CHAVE_SETOR, noAgente, noSetor, SETOR

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
Nodes (9): AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail(), OFFICIAL_APPS (+1 more)

### Community 77 - "delegationWiring.ts"
Cohesion: 0.13
Nodes (22): livePassagesFor(), agentCanDelegate(), DelegationContext, DelegationDeps, TEAM_TOOL_NAMES, col, DelegationFinish, DelegationRecord (+14 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, signBody() (+4 more)

### Community 84 - "runService.ts"
Cohesion: 0.22
Nodes (12): getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), getRoutineForAgent(), insertRunIdempotent(), createRun(), CreateRunInput, AutomationRun (+4 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 96 - "registry.ts"
Cohesion: 0.18
Nodes (17): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+9 more)

### Community 97 - "executionRoutes.ts"
Cohesion: 0.18
Nodes (8): EXECUTION_TABS, ExecutionFilters, ExecutionTab, RunTimelineFilters, AnalyticsPeriod, ANALYTICS_PERIODS, executionRouter, parseFilters()

### Community 98 - "sectorExecutions.ts"
Cohesion: 0.10
Nodes (24): resolveOwnedSectorId(), PERIODS, requireSector(), sectorExecutionRouter, requireSector(), agentEvents, durationOf(), ExecutionEnvironment (+16 more)

### Community 99 - "llmFake.ts"
Cohesion: 0.15
Nodes (5): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply()

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "tokensByModel.integration.test.mjs"
Cohesion: 0.22
Nodes (5): runs(), wipe(), AGENTE, ANDAR, ONTEM

### Community 102 - "runConfig.ts"
Cohesion: 0.15
Nodes (14): capabilitiesFor(), dentro(), LIMITS, MATRIX, ModelCapabilities, normalizeRunConfig(), numeroFinito(), REASONING_EFFORTS (+6 more)

### Community 103 - "agentRoutineRoutes.ts"
Cohesion: 0.11
Nodes (39): StepCondition, EventTriggerError, EventTriggerSpec, webhookEndpoint(), AppActionPlan, MemoryPlan, listAgentAutomations(), listRoutines() (+31 more)

### Community 104 - "listScheduled"
Cohesion: 0.43
Nodes (8): automationFilter(), averageTokens(), listRunsForCenter(), listScheduled(), listTriggers(), loadJoins(), loadRunStats(), placeOf()

### Community 105 - "tokenUsage.ts"
Cohesion: 0.20
Nodes (16): dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce(), settlePendingCharges() (+8 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "runProcessor.ts"
Cohesion: 0.15
Nodes (28): runEventKey(), createLiveTracker(), findAutomation(), findVersion(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun() (+20 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "builtinTools.ts"
Cohesion: 0.14
Nodes (21): sourceSettingsOf(), adapters, manifest, APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog() (+13 more)

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "interactiveRoutes.integration.test.mjs"
Cohesion: 0.48
Nodes (6): comSessao(), criarAgente(), esperarCobranca(), patch(), somar(), tokensDoDono()

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "agentTools.ts"
Cohesion: 0.11
Nodes (25): AgentTool, legacyToolToExecutable(), resolveHttpTool(), ToolCallRecord, toolInputSchema(), assertPublicUrl(), DEFAULTS, isLoopback() (+17 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "floorCommunication.ts"
Cohesion: 0.19
Nodes (13): buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode, FloorLink (+5 more)

### Community 120 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 121 - "autoModel.ts"
Cohesion: 0.29
Nodes (7): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), auxModelFor()

### Community 123 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 124 - "gateWiring.integration.test.mjs"
Cohesion: 0.53
Nodes (5): agents(), insertAgent(), insertSector(), sectors(), threeAnswers()

### Community 126 - "channelApps.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addChannel(), addEmptyInstallation(), connections(), widgets()

### Community 127 - "channelOverview.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addWidget(), messages(), say(), widgets()

### Community 129 - "engine.ts"
Cohesion: 0.07
Nodes (38): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+30 more)

### Community 131 - "sourceCheckpoint.integration.test.mjs"
Cohesion: 0.25
Nodes (5): agora, AUTOMACAO, FONTE, OUTRA_FONTE, QUANDO

### Community 133 - "executionSummary"
Cohesion: 0.29
Nodes (7): clarificationsSince(), tokensByModelSince(), agentConstraint(), agentIdsInSector(), executionSummary, runFilter(), windowStart()

### Community 134 - "sourceTool.integration.test.mjs"
Cohesion: 0.20
Nodes (6): AGENTE, agenteFalso, ANDAR, FEED(), itensDoFeed, servidor

### Community 135 - "timeoutCancellation.test.mjs"
Cohesion: 0.40
Nodes (4): AnthropicFalso, comportamento, contadora(), espera()

### Community 146 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 151 - "db.ts"
Cohesion: 0.13
Nodes (13): ChannelAppKey, messages, widgets, auth, db, mongoClient, AgentDoc, aggregateSectorDecisions() (+5 more)

### Community 153 - "floors.ts"
Cohesion: 0.12
Nodes (31): agentStatesForFloor(), buildingOverview(), floorMetrics, Building, BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE (+23 more)

### Community 155 - "openai.ts"
Cohesion: 0.09
Nodes (55): MAX_TOOL_ITERATIONS, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL, extractIdentity(), extractStructuredOutput() (+47 more)

### Community 158 - "collaborationGate.ts"
Cohesion: 0.28
Nodes (8): checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows(), FloorCommunicationConfig

### Community 159 - "connections/repository.ts"
Cohesion: 0.20
Nodes (4): connections, deliveries, listDeliveries(), sentDeliveriesByAgent()

### Community 162 - "clarify.ts"
Cohesion: 0.24
Nodes (9): clarificationFrom(), ClarificationRequest, CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarificationGuidance(), CLARIFY_LIMIT (+1 more)

## Knowledge Gaps
- **610 isolated node(s):** `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget`, `DelegationDenyCode`, `DelegationCheck`, `OPEN_COMMUNICATION` (+605 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.173) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `runProcessor.ts`?**
  _High betweenness centrality (0.173) - this node is a cross-community bridge._
- **Why does `db` connect `db.ts` to `engine.ts`, `floorWork.ts`, `knowledge.ts`, `executionCenter.ts`, `src/index.ts`, `audit.ts`, `agents.ts`, `grants.ts`, `respondWithAgentIfLinked`, `runner.ts`, `agentLiveState.ts`, `agentEvents.ts`, `migration.ts`, `floors.ts`, `records.ts`, `widgets.ts`, `connections/repository.ts`, `migrate.ts`, `runRepository.ts`, `sectors.ts`, `tools.ts`, `executionRoots.ts`, `installations.ts`, `googleCalendar.ts`, `privateApps.ts`, `delegationWiring.ts`, `automations/repository.ts`, `seedRestaurantDemo.ts`, `registry.ts`, `sectorExecutions.ts`, `tokenUsage.ts`, `floorCommunication.ts`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget`, `DelegationDenyCode` to the rest of the system?**
  _610 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `llm.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13768115942028986 - nodes in this community are weakly interconnected._
- **Should `automations/service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07624113475177305 - nodes in this community are weakly interconnected._