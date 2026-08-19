# Graph Report - backend  (2026-08-18)

## Corpus Check
- 290 files · ~302,519 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2521 nodes · 5828 edges · 177 communities (151 shown, 26 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `de0d3998`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- agentRoutineRoutes.ts
- routine.ts
- agentRuntime.ts
- knowledge.ts
- executionCenter.ts
- src/index.ts
- audit.ts
- agents.ts
- grants.ts
- agentReadiness.ts
- refreshMemoryAndIdentity
- sourceChange.ts
- agentLiveState.ts
- delegation.ts
- mongoServer.mjs
- runner.ts
- whatsapp.ts
- patterns.ts
- routineExecution.ts
- runProcessor.ts
- googleCalendar.ts
- dependencies
- agentMetrics.ts
- migration.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- db.ts
- sectorExecutions.ts
- runRepository.ts
- sourceMonitoring.test.mjs
- connections/service.ts
- modelCache.ts
- toolExecution.ts
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
- registry.ts
- delegation.test.mjs
- runnerTimeout.test.mjs
- runtimeHardening.test.mjs
- schedulerPublish.integration.test.mjs
- providerPayload.test.mjs
- agentHistory.integration.test.mjs
- auditRouteMap.test.mjs
- routineDelivery.integration.test.mjs
- deployment.test.mjs
- migrate.ts
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
- AppDefinition
- delegationWiring.ts
- automations/repository.ts
- routine.test.mjs
- seedGuard.test.mjs
- sectorPlanner.ts
- seedRestaurantDemo.ts
- appInstallationRoutes.ts
- appGrantRoutes.ts
- delegateToAgent
- llmFake.ts
- entrypointParity.test.mjs
- automations/service.ts
- agentDefinition.ts
- navigation.ts
- liveSources.ts
- tokenUsage.ts
- run-tests.mjs
- builtinTools.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- clarify.ts
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- sectors.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- floorCommunication.ts
- sectorAccess.integration.test.mjs
- sectorAccess.ts
- collaborationGate.test.mjs
- floorWork.integration.test.mjs
- gateWiring.integration.test.mjs
- sectorTeam.integration.test.mjs
- channelApps.integration.test.mjs
- channelOverview.integration.test.mjs
- llmFakeGate.test.mjs
- engine.ts
- logHygiene.test.mjs
- sourceCheckpoint.integration.test.mjs
- cron-parser
- scopeCache.ts
- sourceTool.integration.test.mjs
- timeoutCancellation.test.mjs
- toolsSecurity.test.mjs
- conversationTurns.ts
- lexicalRetrieval.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- delegationLog.ts
- scheduler.ts
- appRoutes.integration.test.mjs
- openai.ts
- safeHttp.ts
- googleTools.ts
- config.ts
- floors.ts
- safeError.ts
- runConfig.ts
- sectorPlanner.test.mjs
- scopeGate.test.mjs
- official/index.ts
- hubspot/adapter.ts
- hardening.integration.test.mjs
- rd-station/adapter.ts
- agentTools.ts
- floorWork.ts
- sourceCheckpoint.ts
- web-chat/manifest.ts
- whatsapp/manifest.ts
- stripe/adapter.ts
- apps/types.ts
- sectorBriefing.ts
- agentEvents.ts
- auditMiddleware.ts
- playgroundSession.ts
- sourceSsrf.test.mjs

## God Nodes (most connected - your core abstractions)
1. `respondWithAgentIfLinked()` - 55 edges
2. `db` - 51 edges
3. `startMongo()` - 41 edges
4. `stopMongo()` - 41 edges
5. `buildDeps()` - 39 edges
6. `productionDelegationDeps()` - 31 edges
7. `getAgentById()` - 31 edges
8. `encrypt()` - 26 edges
9. `refreshMemoryAndIdentity()` - 24 edges
10. `AppDefinition` - 23 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `buildDeps()` --indirect_call--> `runEventKey()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (177 total, 26 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.16
Nodes (20): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, askAux(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput() (+12 more)

### Community 1 - "agentRoutineRoutes.ts"
Cohesion: 0.17
Nodes (20): getAgentById(), EventTriggerError, normalizeCondition(), webhookEndpoint(), listAgentAutomations(), listRoutines(), readSourceFromDefinition(), RoutineError (+12 more)

### Community 2 - "routine.ts"
Cohesion: 0.12
Nodes (51): ensureActivationMode(), StepCondition, buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger() (+43 more)

### Community 3 - "agentRuntime.ts"
Cohesion: 0.10
Nodes (30): composeAgentPrompt(), enforceOutputContract(), outputDirective(), AgentExecutionRequest, AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema() (+22 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.08
Nodes (36): chunks, chunkText(), combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), deleteDocument() (+28 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (49): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+41 more)

### Community 6 - "src/index.ts"
Cohesion: 0.04
Nodes (50): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), formatOptions(), resolveChoice() (+42 more)

### Community 7 - "audit.ts"
Cohesion: 0.11
Nodes (24): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditActorType, AuditEvent, AuditEventPublic, AuditFilters, AuditResult (+16 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (48): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentToolHeader, AgentToolParam (+40 more)

### Community 9 - "grants.ts"
Cohesion: 0.17
Nodes (22): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+14 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (31): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+23 more)

### Community 11 - "refreshMemoryAndIdentity"
Cohesion: 0.11
Nodes (27): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+19 more)

### Community 12 - "sourceChange.ts"
Cohesion: 0.14
Nodes (33): RoutineSource, STEP_SOURCE, executeStep(), chaveDoItem(), contentHashOf(), detectHttpChange(), detectRssChange(), HttpChange (+25 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.09
Nodes (30): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+22 more)

### Community 14 - "delegation.ts"
Cohesion: 0.09
Nodes (26): presetSpec(), suggestPresetForCapability(), buildCapabilityMissing(), CapabilityMissing, DEFAULT_DELEGATION_TOKEN_BUDGET, DelegationBudget, DelegationCheck, DelegationContext (+18 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.06
Nodes (17): FLOOR, PAGE, OPCOES, AGENTE, SETOR, startMongo(), stopMongo(), A (+9 more)

### Community 16 - "runner.ts"
Cohesion: 0.07
Nodes (31): AgentCall, delay(), DeliverCall, FetchResult, MemoryOps, runDefinition(), RunnerDeps, SourceHalt (+23 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.12
Nodes (20): AgentEventStatus, RecordAgentEventInput, AgentExecutionResult, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineExecutionDeps (+12 more)

### Community 20 - "runProcessor.ts"
Cohesion: 0.14
Nodes (27): findAutomation(), findVersion(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped() (+19 more)

### Community 21 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (15): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse (+7 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "migration.ts"
Cohesion: 0.18
Nodes (19): AgentBuiltinTool, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation(), ensureGoogleInstallations() (+11 more)

### Community 25 - "records.ts"
Cohesion: 0.07
Nodes (52): readPath(), clarificationKey(), ClarifyMemoryTarget, recallClarifications(), rememberClarification(), assertAgentMayWrite(), floors, MemoryAccessError (+44 more)

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

### Community 31 - "db.ts"
Cohesion: 0.12
Nodes (14): auth, db, mongoClient, AgentDoc, aggregateSectorDecisions(), listSectorDecisionsForConversation(), SectorDecision, SectorDecisionAggregate (+6 more)

### Community 32 - "sectorExecutions.ts"
Cohesion: 0.10
Nodes (24): resolveOwnedSectorId(), PERIODS, requireSector(), sectorExecutionRouter, requireSector(), agentEvents, durationOf(), ExecutionEnvironment (+16 more)

### Community 33 - "runRepository.ts"
Cohesion: 0.13
Nodes (21): artifacts, findRun(), insertRunIdempotent(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel() (+13 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.08
Nodes (23): connections, deliveries, insertDeliveryIdempotent(), listDeliveries(), sentDeliveriesByAgent(), updateDelivery(), CONNECTION_CATALOG, createConnection() (+15 more)

### Community 36 - "modelCache.ts"
Cohesion: 0.29
Nodes (9): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), humanizeModelId(), isChatModel() (+1 more)

### Community 37 - "toolExecution.ts"
Cohesion: 0.23
Nodes (10): executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets(), ToolExecutionResult, SENSITIVE_HEADER (+2 more)

### Community 38 - "tools.ts"
Cohesion: 0.09
Nodes (21): clamp(), createTool(), deleteTool(), getTool(), getToolsByIds(), listTools(), normalize(), TOOL_AUTH_KINDS (+13 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.11
Nodes (21): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+13 more)

### Community 41 - "jsonSchema.ts"
Cohesion: 0.23
Nodes (14): checkJson(), checkStageOutput(), checkJsonText(), JsonCheck, parseJsonText(), describeErrors(), join(), matchesType() (+6 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "validate.ts"
Cohesion: 0.17
Nodes (20): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), STEP_TYPES (+12 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "installations.ts"
Cohesion: 0.15
Nodes (19): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installations, LEGACY_APP_VERSION, markInstallationTested(), normalizeConfig() (+11 more)

### Community 48 - "registry.ts"
Cohesion: 0.14
Nodes (16): AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail(), OFFICIAL_APPS (+8 more)

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

### Community 58 - "migrate.ts"
Cohesion: 0.13
Nodes (23): ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes(), ensureBuildingIndexes() (+15 more)

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

### Community 76 - "AppDefinition"
Cohesion: 0.53
Nodes (5): native(), num(), schema(), str(), AppDefinition

### Community 77 - "delegationWiring.ts"
Cohesion: 0.23
Nodes (19): recordAgentEvent(), recordAgentEventSafe(), createLiveTracker(), executeAgentTask(), resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), finishDelegation() (+11 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.14
Nodes (10): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+2 more)

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.24
Nodes (14): describeMember(), describePlan(), ExecutionTask, fallbackPlan(), listaCurta(), MAX_TASKS, parsePlanJson(), planExecution() (+6 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 96 - "appInstallationRoutes.ts"
Cohesion: 0.18
Nodes (15): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+7 more)

### Community 97 - "appGrantRoutes.ts"
Cohesion: 0.23
Nodes (7): ValidationError, appGrantRouter, auditEntity(), automationRouter, fail(), notFound(), oid()

### Community 98 - "delegateToAgent"
Cohesion: 0.27
Nodes (14): agentCard(), asOutputFormat(), buildDelegationTools(), checkDelegation(), delegateToAgent(), delegateToSector(), gateContext(), gateTargetForAgent() (+6 more)

### Community 99 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "automations/service.ts"
Cohesion: 0.12
Nodes (30): assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName() (+22 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.11
Nodes (25): AgentDefinition, definitionOf(), OutputCheck, resolveAgentRun(), resolveCache(), ResolvedAgentRun, ResolveRunOptions, ActionRisk (+17 more)

### Community 103 - "navigation.ts"
Cohesion: 0.16
Nodes (18): installationPublic(), listInstallations(), buildNavigation(), dropPinsForApp(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus (+10 more)

### Community 104 - "liveSources.ts"
Cohesion: 0.36
Nodes (7): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), advanceCheckpoint(), beginCheck()

### Community 105 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): attemptChargeKey(), dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "builtinTools.ts"
Cohesion: 0.24
Nodes (13): APP_GUIDES, BUILTIN_APPS, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, hubspotTools(), mercadoPagoTools(), num() (+5 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.16
Nodes (12): AGENT, agentDoc(), ALVO, alvoDoc(), base, call, ctx, depsDelegacao() (+4 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "clarify.ts"
Cohesion: 0.24
Nodes (9): clarificationFrom(), ClarificationRequest, CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarificationGuidance(), CLARIFY_LIMIT (+1 more)

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "interactiveRoutes.integration.test.mjs"
Cohesion: 0.43
Nodes (7): comSessao(), criarAgente(), esperarCobranca(), esperarTurnos(), patch(), somar(), tokensDoDono()

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "sectors.ts"
Cohesion: 0.12
Nodes (25): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+17 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "floorCommunication.ts"
Cohesion: 0.18
Nodes (13): Building, buildings, COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode, FloorLink (+5 more)

### Community 120 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 121 - "sectorAccess.ts"
Cohesion: 0.21
Nodes (14): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+6 more)

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
Cohesion: 0.13
Nodes (20): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+12 more)

### Community 131 - "sourceCheckpoint.integration.test.mjs"
Cohesion: 0.25
Nodes (5): agora, AUTOMACAO, FONTE, OUTRA_FONTE, QUANDO

### Community 133 - "scopeCache.ts"
Cohesion: 0.31
Nodes (8): cache, chaveDe(), Entrada, normalizar(), rememberedScope(), rememberScope(), checkScope(), ScopeVerdict

### Community 134 - "sourceTool.integration.test.mjs"
Cohesion: 0.20
Nodes (6): AGENTE, agenteFalso, ANDAR, FEED(), itensDoFeed, servidor

### Community 135 - "timeoutCancellation.test.mjs"
Cohesion: 0.40
Nodes (4): AnthropicFalso, comportamento, contadora(), espera()

### Community 139 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 140 - "lexicalRetrieval.ts"
Cohesion: 0.18
Nodes (18): searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm (+10 more)

### Community 146 - "delegationLog.ts"
Cohesion: 0.22
Nodes (8): col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus, ensureDelegationIndexes(), listDelegationsForAgent(), succeededDelegationsByCaller()

### Community 147 - "scheduler.ts"
Cohesion: 0.24
Nodes (12): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes(), planSchedules() (+4 more)

### Community 149 - "openai.ts"
Cohesion: 0.08
Nodes (59): MAX_TOOL_ITERATIONS, runResolvedTool(), anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL (+51 more)

### Community 150 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 151 - "googleTools.ts"
Cohesion: 0.36
Nodes (6): adapters, manifest, googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 152 - "config.ts"
Cohesion: 0.32
Nodes (7): clientUrl, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig()

### Community 153 - "floors.ts"
Cohesion: 0.11
Nodes (33): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, BuildingPatch, buildings (+25 more)

### Community 155 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 156 - "runConfig.ts"
Cohesion: 0.18
Nodes (12): dentro(), LIMITS, MATRIX, ModelCapabilities, normalizeRunConfig(), numeroFinito(), REASONING_EFFORTS, ReasoningEffort (+4 more)

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.33
Nodes (4): COZINHA, EQUIPE, FINANCEIRO, JURIDICO

### Community 159 - "official/index.ts"
Cohesion: 0.15
Nodes (11): MODULES, OFFICIAL_ADAPTERS, OfficialAppsError, OfficialModule, adapters, manifest, adapters, manifest (+3 more)

### Community 163 - "agentTools.ts"
Cohesion: 0.38
Nodes (6): AgentTool, legacyToolToExecutable(), resolveHttpTool(), toolInputSchema(), ExecutableTool, TOOL_DEFAULTS

### Community 165 - "floorWork.ts"
Cohesion: 0.15
Nodes (19): Agent, AgentAppGrant, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget (+11 more)

### Community 166 - "sourceCheckpoint.ts"
Cohesion: 0.22
Nodes (9): acquireSourceLease(), checkpoints, ehChaveDuplicada(), LEASE_MS, leases, MAX_SEEN_KEYS, SourceCheckpoint, SourceLease (+1 more)

### Community 174 - "apps/types.ts"
Cohesion: 0.11
Nodes (14): manifest, manifest, APP_ACTIVATIONS, APP_AVAILABILITIES, AppActionExecution, AppAuthDefinition, AppAuthField, AppAuthKind (+6 more)

### Community 175 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

### Community 177 - "agentEvents.ts"
Cohesion: 0.22
Nodes (9): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow, runEventKey() (+1 more)

### Community 179 - "auditMiddleware.ts"
Cohesion: 0.22
Nodes (11): AuditAction, AuditEntityType, recordAudit(), safeMetadata(), auditRequests(), AuditTarget, auditTargetFor(), matches() (+3 more)

### Community 180 - "playgroundSession.ts"
Cohesion: 0.25
Nodes (8): guardarTurnoDeTeste(), appendPlaygroundTurns(), clearPlaygroundTurns(), cortar(), loadPlaygroundTurns(), PlaygroundSession, PlaygroundTurn, sessions

## Knowledge Gaps
- **623 isolated node(s):** `DEFAULT_MODEL`, `AUXILIARY_MODEL`, `FALLBACK_MODELS`, `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget` (+618 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **26 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `tokenUsage.ts` to `hardening.integration.test.mjs`, `runProcessor.ts`?**
  _High betweenness centrality (0.184) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `tokenUsage.ts`?**
  _High betweenness centrality (0.184) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `sourceCheckpoint.integration.test.mjs`, `sourceTool.integration.test.mjs`, `toolsSecurity.test.mjs`, `appRoutes.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `hardening.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `executionModes.integration.test.mjs`, `migrationFixture.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `memoryStore.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sourceStaleRun.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `interactiveRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `floorWork.integration.test.mjs`, `gateWiring.integration.test.mjs`, `sectorTeam.integration.test.mjs`, `channelApps.integration.test.mjs`, `channelOverview.integration.test.mjs`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DEFAULT_MODEL`, `AUXILIARY_MODEL`, `FALLBACK_MODELS` to the rest of the system?**
  _623 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `routine.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12337662337662338 - nodes in this community are weakly interconnected._
- **Should `agentRuntime.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09659090909090909 - nodes in this community are weakly interconnected._