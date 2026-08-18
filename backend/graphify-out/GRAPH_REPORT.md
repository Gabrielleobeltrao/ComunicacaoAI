# Graph Report - backend  (2026-08-18)

## Corpus Check
- 287 files · ~292,942 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2474 nodes · 5733 edges · 169 communities (142 shown, 27 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 43 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `08249053`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- eventTrigger.ts
- sectorAccess.ts
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
- automations/types.ts
- whatsapp.ts
- patterns.ts
- routineExecution.ts
- checkCollaboration
- AppDefinition
- dependencies
- agentEvents.ts
- migration.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- building.ts
- db.ts
- runRepository.ts
- sourceMonitoring.test.mjs
- connections/service.ts
- modelCache.ts
- agentTools.ts
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
- builtinTools.ts
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
- navigation.ts
- delegationWiring.ts
- automations/repository.ts
- routine.test.mjs
- seedGuard.test.mjs
- scheduler.ts
- seedRestaurantDemo.ts
- channelApps.ts
- http.ts
- sectorExecutions.ts
- llmFake.ts
- entrypointParity.test.mjs
- automations/service.ts
- agentDefinition.ts
- agentRoutineRoutes.ts
- connections/repository.ts
- tokenUsage.ts
- run-tests.mjs
- runProcessor.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- clarify.ts
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- toolExecution.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- floorWork.ts
- sectorAccess.integration.test.mjs
- executeSectorTeam
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
- safeHttp.ts
- config.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- safeError.ts
- official/index.ts
- appRoutes.integration.test.mjs
- openai.ts
- slack/adapter.ts
- runQueue.integration.test.mjs
- auditMiddleware.ts
- floors.ts
- web-chat/manifest.ts
- googleCalendar.ts
- scopeGate.test.mjs
- providerApps.ts
- apps/types.ts
- hardening.integration.test.mjs
- sourceSsrf.test.mjs
- connections/types.ts
- sectorDecisions.ts
- hubspot/adapter.ts
- email/manifest.ts
- whatsapp/manifest.ts

## God Nodes (most connected - your core abstractions)
1. `respondWithAgentIfLinked()` - 53 edges
2. `db` - 51 edges
3. `startMongo()` - 41 edges
4. `stopMongo()` - 41 edges
5. `buildDeps()` - 39 edges
6. `getAgentById()` - 31 edges
7. `productionDelegationDeps()` - 27 edges
8. `encrypt()` - 26 edges
9. `refreshMemoryAndIdentity()` - 24 edges
10. `ResolvedTool` - 24 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts
- `BuiltinApp` --references--> `ResolvedTool`  [EXTRACTED]
  src/builtinTools.ts → src/agentTools.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (169 total, 27 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.20
Nodes (16): auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput(), FAKE_LLM_ENABLED, generateAgentReply(), listModelsForProvider() (+8 more)

### Community 1 - "eventTrigger.ts"
Cohesion: 0.16
Nodes (27): StepCondition, buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers() (+19 more)

### Community 2 - "sectorAccess.ts"
Cohesion: 0.27
Nodes (10): accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES, SectorAccessConfig (+2 more)

### Community 3 - "agentRuntime.ts"
Cohesion: 0.11
Nodes (31): enforceOutputContract(), AgentExecutionRequest, AgentExecutionResult, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective() (+23 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.05
Nodes (58): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, chunks (+50 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (49): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+41 more)

### Community 6 - "src/index.ts"
Cohesion: 0.04
Nodes (43): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), clarificationGuidance(), CLARIFY_LIMIT (+35 more)

### Community 7 - "audit.ts"
Cohesion: 0.11
Nodes (25): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic, AuditFilters (+17 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (50): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentTool, AgentToolHeader (+42 more)

### Community 9 - "grants.ts"
Cohesion: 0.13
Nodes (23): AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction(), declarativeTool() (+15 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.08
Nodes (33): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+25 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.08
Nodes (39): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+31 more)

### Community 12 - "runner.ts"
Cohesion: 0.06
Nodes (69): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), RoutineSource, AgentCall, delay() (+61 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.09
Nodes (30): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+22 more)

### Community 14 - "delegation.ts"
Cohesion: 0.10
Nodes (22): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, ClarificationRequest, buildCapabilityMissing(), CapabilityMissing, DEFAULT_DELEGATION_TOKEN_BUDGET, DelegationBudget (+14 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.07
Nodes (15): FLOOR, PAGE, OPCOES, AGENTE, SETOR, startMongo(), stopMongo(), A (+7 more)

### Community 16 - "automations/types.ts"
Cohesion: 0.11
Nodes (26): CreateRunInput, AutomationRun, SafeRunError, CreateAutomationInput, UpdateDraftPatch, AI_STEP_TYPES, Automation, AutomationDefinition (+18 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.14
Nodes (18): ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter(), InboundMediaRef, InboundMessage (+10 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.12
Nodes (17): AgentEventStatus, RecordAgentEventInput, AgentBubbleState, instrumentTools(), LiveTracker, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry() (+9 more)

### Community 20 - "checkCollaboration"
Cohesion: 0.24
Nodes (17): checkCollaboration(), discoverable(), policyAllows(), agentCard(), asOutputFormat(), buildDelegationTools(), checkDelegation(), delegateToAgent() (+9 more)

### Community 21 - "AppDefinition"
Cohesion: 0.46
Nodes (6): native(), num(), schema(), str(), PrivateAppDoc, AppDefinition

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentEvents.ts"
Cohesion: 0.09
Nodes (27): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentExecutionEvent, events, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow (+19 more)

### Community 24 - "migration.ts"
Cohesion: 0.11
Nodes (31): catalogIndex(), LiveTrackerContext, NOOP_TRACKER, toolDetail(), AgentBuiltinTool, agents, AppMigrationReport, backfillConnectionAppKeys() (+23 more)

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
Cohesion: 0.08
Nodes (32): ensureActivationMode(), addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel() (+24 more)

### Community 31 - "building.ts"
Cohesion: 0.20
Nodes (8): Building, BuildingPatch, buildings, DEFAULT_TIMEZONE, LANGUAGES, updateBuilding(), communicationImpact, buildingRouter

### Community 32 - "db.ts"
Cohesion: 0.07
Nodes (38): auth, db, mongoClient, serializeSector(), AgentDoc, suggestedEntryPolicy(), assignAgentToSector(), AssignOutcome (+30 more)

### Community 33 - "runRepository.ts"
Cohesion: 0.14
Nodes (17): artifacts, findRun(), insertRunIdempotent(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel() (+9 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.21
Nodes (11): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, decryptConfig(), getConnection(), isNonEmpty(), normalizeName(), patchConnection() (+3 more)

### Community 36 - "modelCache.ts"
Cohesion: 0.29
Nodes (9): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), humanizeModelId(), isChatModel() (+1 more)

### Community 37 - "agentTools.ts"
Cohesion: 0.43
Nodes (6): legacyToolToExecutable(), MAX_TOOL_ITERATIONS, missingCapability(), resolveHttpTool(), runResolvedTool(), toolInputSchema()

### Community 38 - "tools.ts"
Cohesion: 0.09
Nodes (21): clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS, TOOL_DEFAULTS (+13 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.12
Nodes (20): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+12 more)

### Community 41 - "jsonSchema.ts"
Cohesion: 0.25
Nodes (13): checkStageOutput(), checkJsonText(), JsonCheck, parseJsonText(), describeErrors(), join(), matchesType(), Schema (+5 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "validate.ts"
Cohesion: 0.19
Nodes (19): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), canonical() (+11 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "installations.ts"
Cohesion: 0.14
Nodes (19): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installations, LEGACY_APP_VERSION, markInstallationTested(), normalizeConfig() (+11 more)

### Community 48 - "builtinTools.ts"
Cohesion: 0.18
Nodes (13): adapters, manifest, APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField (+5 more)

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
Nodes (24): backfillManagedChannelInstallations(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes() (+16 more)

### Community 59 - "privateApps.ts"
Cohesion: 0.12
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

### Community 76 - "navigation.ts"
Cohesion: 0.19
Nodes (16): installationPublic(), listInstallations(), buildNavigation(), dropPinsForApp(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus (+8 more)

### Community 77 - "delegationWiring.ts"
Cohesion: 0.07
Nodes (41): resolveAppGrantTools(), resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), col, DelegationFinish, DelegationRecord, DelegationStart (+33 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.13
Nodes (11): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+3 more)

### Community 84 - "scheduler.ts"
Cohesion: 0.24
Nodes (12): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes(), planSchedules() (+4 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.20
Nodes (14): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+6 more)

### Community 97 - "http.ts"
Cohesion: 0.20
Nodes (8): ValidationError, requireAgent(), automationRouter, connectionRouter, parseFilters(), fail(), notFound(), oid()

### Community 98 - "sectorExecutions.ts"
Cohesion: 0.13
Nodes (19): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+11 more)

### Community 99 - "llmFake.ts"
Cohesion: 0.15
Nodes (5): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply()

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "automations/service.ts"
Cohesion: 0.13
Nodes (27): getAgentById(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), defaultDefinition(), normalizeName() (+19 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.07
Nodes (40): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+32 more)

### Community 103 - "agentRoutineRoutes.ts"
Cohesion: 0.13
Nodes (39): EventTriggerError, normalizeCondition(), readEventTriggerConfig(), webhookEndpoint(), emptyAppActionPlan(), emptyMemoryPlan(), normalizeAppActionPlan(), normalizeMemoryPlan() (+31 more)

### Community 104 - "connections/repository.ts"
Cohesion: 0.17
Nodes (6): connections, deliveries, insertDeliveryIdempotent(), listDeliveries(), sentDeliveriesByAgent(), updateDelivery()

### Community 105 - "tokenUsage.ts"
Cohesion: 0.20
Nodes (16): dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce(), settlePendingCharges() (+8 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "runProcessor.ts"
Cohesion: 0.19
Nodes (22): runEventKey(), createLiveTracker(), findAutomation(), findVersion(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun() (+14 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "clarify.ts"
Cohesion: 0.47
Nodes (5): CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarifyBudgetSpent()

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "interactiveRoutes.integration.test.mjs"
Cohesion: 0.43
Nodes (7): comSessao(), criarAgente(), esperarCobranca(), esperarTurnos(), patch(), somar(), tokensDoDono()

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "toolExecution.ts"
Cohesion: 0.22
Nodes (11): decrypt(), executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets(), ToolExecutionResult (+3 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "floorWork.ts"
Cohesion: 0.11
Nodes (26): Agent, CollaborationDecision, CollaborationDenyCode, GateContext, GateTarget, DELEGATION_MAX_DEPTH, buildings, canCommunicate() (+18 more)

### Community 120 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 121 - "executeSectorTeam"
Cohesion: 0.31
Nodes (9): clarificationFrom(), childContext(), emitAgentEvent(), executeSectorTeam(), participationTelemetry(), recordChildRun(), runAgentTask(), runWithRetry() (+1 more)

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

### Community 139 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 140 - "config.ts"
Cohesion: 0.32
Nodes (7): clientUrl, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig()

### Community 146 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 147 - "official/index.ts"
Cohesion: 0.15
Nodes (11): MODULES, OFFICIAL_ADAPTERS, OfficialAppsError, OfficialModule, adapters, manifest, adapters, manifest (+3 more)

### Community 149 - "openai.ts"
Cohesion: 0.09
Nodes (53): anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL, extractIdentity(), extractStructuredOutput(), FALLBACK_MODELS (+45 more)

### Community 152 - "auditMiddleware.ts"
Cohesion: 0.19
Nodes (10): AuditAction, recordAudit(), safeMetadata(), auditRequests(), AuditTarget, auditTargetFor(), matches(), Rule (+2 more)

### Community 153 - "floors.ts"
Cohesion: 0.13
Nodes (24): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, isValidTimezone(), collection (+16 more)

### Community 157 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (14): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse, deleteIntegration() (+6 more)

### Community 159 - "providerApps.ts"
Cohesion: 0.25
Nodes (10): adapters, manifest, hubspotTools(), mercadoPagoTools(), num(), nuvemshopTools(), objectSchema(), rdStationTools() (+2 more)

### Community 160 - "apps/types.ts"
Cohesion: 0.12
Nodes (14): manifest, APP_ACTIVATIONS, APP_AVAILABILITIES, AppActionDefinition, AppActionExecution, AppAuthDefinition, AppAuthField, AppAuthKind (+6 more)

### Community 164 - "connections/types.ts"
Cohesion: 0.18
Nodes (12): chunkTelegram(), FetchImpl, MailTransport, maskDestination(), sendEmail(), sendTelegram(), Connection, ConnectionStatus (+4 more)

### Community 165 - "sectorDecisions.ts"
Cohesion: 0.29
Nodes (5): aggregateSectorDecisions(), listSectorDecisionsForConversation(), SectorDecision, SectorDecisionAggregate, sectorDecisions

## Knowledge Gaps
- **604 isolated node(s):** `TriggerKind`, `TRIGGER_KINDS`, `NormalizedActivation`, `EMPTY_WIRING`, `TriggerState` (+599 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **27 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `runProcessor.ts`?**
  _High betweenness centrality (0.186) - this node is a cross-community bridge._
- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.185) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `sourceCheckpoint.integration.test.mjs`, `sourceTool.integration.test.mjs`, `toolsSecurity.test.mjs`, `appRoutes.integration.test.mjs`, `runQueue.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `hardening.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `executionModes.integration.test.mjs`, `migrationFixture.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `memoryStore.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sourceStaleRun.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `interactiveRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `floorWork.integration.test.mjs`, `gateWiring.integration.test.mjs`, `sectorTeam.integration.test.mjs`, `channelApps.integration.test.mjs`, `channelOverview.integration.test.mjs`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `TriggerKind`, `TRIGGER_KINDS`, `NormalizedActivation` to the rest of the system?**
  _604 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `agentRuntime.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1140819964349376 - nodes in this community are weakly interconnected._
- **Should `knowledge.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.052403846153846155 - nodes in this community are weakly interconnected._