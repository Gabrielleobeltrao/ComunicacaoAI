# Graph Report - backend  (2026-08-18)

## Corpus Check
- 286 files · ~291,137 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2468 nodes · 5720 edges · 177 communities (152 shown, 25 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 42 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `75dd073e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- eventTrigger.ts
- floorWork.ts
- ResolvedTool
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
- agentRoutineRoutes.ts
- AppDefinition
- dependencies
- agentMetrics.ts
- migration.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- apps/manifest.ts
- sectors.ts
- runRepository.ts
- sourceMonitoring.test.mjs
- connections/service.ts
- modelCache.ts
- openai.ts
- tools.ts
- eventTrigger.integration.test.mjs
- executionRoots.ts
- agentRuntime.ts
- executionModes.integration.test.mjs
- scripts
- validate.ts
- package.json
- migrationFixture.integration.test.mjs
- installations.ts
- googleTools.ts
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
- building.ts
- sectorExecutions.ts
- llmFake.ts
- entrypointParity.test.mjs
- automations/service.ts
- agentDefinition.ts
- routine.ts
- systemPrompt.ts
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
- toolExecution.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- floorCommunication.ts
- sectorAccess.integration.test.mjs
- autoModel.ts
- collaborationGate.test.mjs
- floorWork.integration.test.mjs
- gateWiring.integration.test.mjs
- sectorKnowledgeRoutes.ts
- channelApps.integration.test.mjs
- channelOverview.integration.test.mjs
- llmFakeGate.test.mjs
- engine.ts
- logHygiene.test.mjs
- sourceCheckpoint.integration.test.mjs
- cron-parser
- ChatTurn
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
- claude.ts
- buildSectorPlannerPrompt
- db.ts
- auditMiddleware.ts
- floors.ts
- buildClient
- web-chat/manifest.ts
- googleCalendar.ts
- scopeGate.test.mjs
- providerApps.ts
- apps/types.ts
- conversationTurns.ts
- lexicalRetrieval.ts
- adapters.ts
- sectorDecisions.ts
- oid
- toolCallLog.ts
- hubspot/adapter.ts
- nuvemshop/adapter.ts
- stripe/adapter.ts
- email/manifest.ts
- telegram/manifest.ts
- whatsapp/manifest.ts

## God Nodes (most connected - your core abstractions)
1. `respondWithAgentIfLinked()` - 53 edges
2. `db` - 50 edges
3. `startMongo()` - 41 edges
4. `stopMongo()` - 41 edges
5. `buildDeps()` - 39 edges
6. `getAgentById()` - 31 edges
7. `productionDelegationDeps()` - 27 edges
8. `encrypt()` - 26 edges
9. `ResolvedTool` - 24 edges
10. `refreshMemoryAndIdentity()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `buildDeps()` --indirect_call--> `runEventKey()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `floorWorkOverview` --indirect_call--> `withAgentDefaults()`  [INFERRED]
  src/floorWork.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (177 total, 25 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.15
Nodes (21): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, getWidgetConfigAgent(), inboundMediaToText(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity() (+13 more)

### Community 1 - "eventTrigger.ts"
Cohesion: 0.13
Nodes (25): StepCondition, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), AppActionPlan, MemoryPlan, MODE_LABELS (+17 more)

### Community 2 - "floorWork.ts"
Cohesion: 0.14
Nodes (22): DELEGATION_MAX_DEPTH, agents, competencyOf(), effectiveTargets(), FloorTarget, floorWorkOverview, sectors, serializeSector() (+14 more)

### Community 3 - "ResolvedTool"
Cohesion: 0.23
Nodes (12): RecordAgentEventInput, AgentExecutionRequest, AgentExecutionResult, Agent, ResolvedTool, AgentAppGrant, RoutineExecutionDeps, BuiltinApp (+4 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.09
Nodes (24): chunks, combineKnowledgeHits(), createDocument(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), documents (+16 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (50): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+42 more)

### Community 6 - "src/index.ts"
Cohesion: 0.05
Nodes (39): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), ensureDelegationIndexes(), app, AVATAR_MIME_TYPES (+31 more)

### Community 7 - "audit.ts"
Cohesion: 0.11
Nodes (23): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditActorType, AuditEvent, AuditEventPublic, AuditFilters, AuditResult (+15 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (49): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentToolHeader, AgentToolParam (+41 more)

### Community 9 - "grants.ts"
Cohesion: 0.18
Nodes (21): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+13 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (32): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+24 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.08
Nodes (39): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+31 more)

### Community 12 - "runner.ts"
Cohesion: 0.05
Nodes (71): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), publishedSourceFingerprint(), RoutineSource, AgentCall (+63 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.09
Nodes (27): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+19 more)

### Community 14 - "delegation.ts"
Cohesion: 0.08
Nodes (49): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, ClarificationRequest, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable() (+41 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.06
Nodes (19): FLOOR, PAGE, OPCOES, AGENTE, SETOR, startMongo(), stopMongo(), A (+11 more)

### Community 16 - "agentEvents.ts"
Cohesion: 0.16
Nodes (13): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, events, finalizeAgentEvent(), finalizeAgentEventSafe() (+5 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.14
Nodes (18): ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter(), InboundMediaRef, InboundMessage (+10 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.10
Nodes (23): AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail(), OFFICIAL_APPS (+15 more)

### Community 20 - "agentRoutineRoutes.ts"
Cohesion: 0.14
Nodes (20): getAgentById(), EventTriggerError, normalizeCondition(), readEventTriggerConfig(), webhookEndpoint(), listAgentAutomations(), listRoutines(), RoutineError (+12 more)

### Community 21 - "AppDefinition"
Cohesion: 0.38
Nodes (7): adapters, manifest, native(), num(), schema(), str(), AppDefinition

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.16
Nodes (16): AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel(), kpiShortLabel() (+8 more)

### Community 24 - "migration.ts"
Cohesion: 0.13
Nodes (26): AgentBuiltinTool, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation(), ensureGoogleInstallations() (+18 more)

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
Cohesion: 0.08
Nodes (32): ensureActivationMode(), addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel() (+24 more)

### Community 31 - "apps/manifest.ts"
Cohesion: 0.23
Nodes (13): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+5 more)

### Community 32 - "sectors.ts"
Cohesion: 0.12
Nodes (25): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+17 more)

### Community 33 - "runRepository.ts"
Cohesion: 0.14
Nodes (17): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+9 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.09
Nodes (21): connections, deliveries, insertDeliveryIdempotent(), listDeliveries(), sentDeliveriesByAgent(), updateDelivery(), CreateConnectionInput, decryptConfig() (+13 more)

### Community 36 - "modelCache.ts"
Cohesion: 0.29
Nodes (9): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), humanizeModelId(), isChatModel() (+1 more)

### Community 37 - "openai.ts"
Cohesion: 0.17
Nodes (12): runResolvedTool(), ToolCallRecord, AgentReplyResult, ANTHROPIC_AUX_MODEL, ANTHROPIC_DEFAULT_MODEL, OPENAI_AUX_MODEL, OPENAI_DEFAULT_MODEL, AUXILIARY_MODEL (+4 more)

### Community 38 - "tools.ts"
Cohesion: 0.10
Nodes (20): clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS, TOOL_LIMITS (+12 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.11
Nodes (21): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+13 more)

### Community 41 - "agentRuntime.ts"
Cohesion: 0.14
Nodes (22): AgentRunErrorKind, boundedSchema(), buildHistory(), checkJson(), inputToText(), parseJsonOutput(), ReplyFn, schemaDepth() (+14 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "validate.ts"
Cohesion: 0.19
Nodes (18): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), canonical() (+10 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "installations.ts"
Cohesion: 0.14
Nodes (19): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installations, LEGACY_APP_VERSION, markInstallationTested(), normalizeConfig() (+11 more)

### Community 48 - "googleTools.ts"
Cohesion: 0.50
Nodes (5): getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

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
Nodes (24): backfillManagedChannelInstallations(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), findAutomation(), backfillSourceFingerprints() (+16 more)

### Community 59 - "privateApps.ts"
Cohesion: 0.20
Nodes (16): describeManifestIssues(), exportableManifest(), archivePrivateApp(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listAppsForOwner() (+8 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "memoryStore.integration.test.mjs"
Cohesion: 0.22
Nodes (7): AGENTE, ANDAR, CHAVE_AGENTE, CHAVE_SETOR, noAgente, noSetor, SETOR

### Community 62 - "config.test.mjs"
Cohesion: 0.17
Nodes (5): here, PROD_SECRETS, PROD_URLS, PROIBIDOS, PROTOCOLOS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 76 - "navigation.ts"
Cohesion: 0.20
Nodes (15): installationPublic(), listInstallations(), buildNavigation(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus, preferences (+7 more)

### Community 77 - "delegationWiring.ts"
Cohesion: 0.16
Nodes (21): executeAgentTask(), buildDeps(), agentCanDelegate(), rootContext(), col, DelegationFinish, DelegationRecord, DelegationStart (+13 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.10
Nodes (21): automations, findByWebhookKey(), findVersion(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions (+13 more)

### Community 84 - "scheduler.ts"
Cohesion: 0.24
Nodes (12): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes(), planSchedules() (+4 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.22
Nodes (14): createAgent(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main() (+6 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.20
Nodes (14): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+6 more)

### Community 97 - "building.ts"
Cohesion: 0.15
Nodes (10): BuildingPatch, buildings, ValidationError, CONNECTION_CATALOG, appGrantRouter, auditEntity(), automationRouter, connectionRouter (+2 more)

### Community 98 - "sectorExecutions.ts"
Cohesion: 0.13
Nodes (19): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+11 more)

### Community 99 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "automations/service.ts"
Cohesion: 0.12
Nodes (33): assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName() (+25 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.07
Nodes (41): AgentDefinition, composeAgentPrompt(), definitionOf(), enforceOutputContract(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache() (+33 more)

### Community 103 - "routine.ts"
Cohesion: 0.16
Nodes (36): buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), updateEventTrigger(), aiStepPlanned(), appStep(), describeFlow(), emptyAppActionPlan() (+28 more)

### Community 104 - "systemPrompt.ts"
Cohesion: 0.15
Nodes (11): buildSystemPrompt(), buildSystemPromptParts(), DETAIL_INSTRUCTIONS, GUARDRAIL_CHECK_SYSTEM_PROMPT, IDENTITY_EXTRACTION_SYSTEM_PROMPT, LANGUAGE_INSTRUCTIONS, MEMORY_UPDATE_SYSTEM_PROMPT, SECTOR_PLANNER_SYSTEM_PROMPT (+3 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.16
Nodes (19): attemptChargeKey(), dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage() (+11 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "runProcessor.ts"
Cohesion: 0.29
Nodes (12): createLiveTracker(), agentIdsOf(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact(), insertStepRun(), updateRun() (+4 more)

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
Cohesion: 0.11
Nodes (24): AgentTool, legacyToolToExecutable(), resolveHttpTool(), toolInputSchema(), resolveAppGrantTools(), APP_GUIDES, BUILTIN_APPS, BuiltinAppGuide (+16 more)

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "interactiveRoutes.integration.test.mjs"
Cohesion: 0.48
Nodes (6): comSessao(), criarAgente(), esperarCobranca(), patch(), somar(), tokensDoDono()

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "toolExecution.ts"
Cohesion: 0.18
Nodes (13): decrypt(), getKey(), ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl() (+5 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "floorCommunication.ts"
Cohesion: 0.21
Nodes (12): buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode, FloorLink (+4 more)

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

### Community 125 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.15
Nodes (14): chunkText(), deleteDocument(), deleteDocumentFor(), getDocument(), getDocumentFor(), indexDocumentChunks(), KnowledgeDocument, listDocuments() (+6 more)

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

### Community 133 - "ChatTurn"
Cohesion: 0.27
Nodes (9): cache, chaveDe(), Entrada, normalizar(), rememberedScope(), rememberScope(), checkScope(), ScopeVerdict (+1 more)

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
Cohesion: 0.18
Nodes (9): MODULES, OFFICIAL_ADAPTERS, OfficialAppsError, OfficialModule, adapters, manifest, adapters, manifest (+1 more)

### Community 149 - "claude.ts"
Cohesion: 0.16
Nodes (20): MAX_TOOL_ITERATIONS, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL, FALLBACK_MODELS, generateAgentReply() (+12 more)

### Community 150 - "buildSectorPlannerPrompt"
Cohesion: 0.67
Nodes (4): planSectorResponse(), planSectorResponse(), buildSectorPlannerPrompt(), parseSectorPlan()

### Community 151 - "db.ts"
Cohesion: 0.23
Nodes (9): ensureAgentLiveStateIndexes(), auth, db, mongoClient, AgentDoc, arg(), main(), SHOWCASE (+1 more)

### Community 152 - "auditMiddleware.ts"
Cohesion: 0.22
Nodes (12): AuditAction, AuditEntityType, recordAudit(), entityLabelWithOwner(), normalizeLabel(), auditRequests(), AuditTarget, auditTargetFor() (+4 more)

### Community 153 - "floors.ts"
Cohesion: 0.10
Nodes (30): legacyWorkingMap(), agentStatesForFloor(), buildingOverview(), floorMetrics, Building, BuildingLanguage, DEFAULT_TIMEZONE, isValidTimezone() (+22 more)

### Community 155 - "buildClient"
Cohesion: 0.24
Nodes (12): extractIdentity(), extractStructuredOutput(), updateStructuredMemory(), buildClient(), extractIdentity(), extractStructuredOutput(), transcribeImage(), updateStructuredMemory() (+4 more)

### Community 157 - "googleCalendar.ts"
Cohesion: 0.19
Nodes (13): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), googleConfigured(), SCOPES, TokenResponse, deleteIntegration(), getIntegration() (+5 more)

### Community 159 - "providerApps.ts"
Cohesion: 0.25
Nodes (10): adapters, manifest, hubspotTools(), mercadoPagoTools(), num(), nuvemshopTools(), objectSchema(), rdStationTools() (+2 more)

### Community 160 - "apps/types.ts"
Cohesion: 0.14
Nodes (12): APP_ACTIVATIONS, APP_AVAILABILITIES, AppActionExecution, AppAuthDefinition, AppAuthField, AppAuthKind, AppAvailability, AppResourceField (+4 more)

### Community 162 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 163 - "lexicalRetrieval.ts"
Cohesion: 0.30
Nodes (11): searchKnowledgeLexicallyForOwners(), escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm, normalize(), pad() (+3 more)

### Community 164 - "adapters.ts"
Cohesion: 0.33
Nodes (6): chunkTelegram(), FetchImpl, MailTransport, maskDestination(), sendEmail(), sendTelegram()

### Community 165 - "sectorDecisions.ts"
Cohesion: 0.29
Nodes (5): aggregateSectorDecisions(), listSectorDecisionsForConversation(), SectorDecision, SectorDecisionAggregate, sectorDecisions

### Community 166 - "oid"
Cohesion: 0.50
Nodes (5): resolveOwnedSectorId(), oid(), requireSector(), requireSector(), getSectorById()

### Community 167 - "toolCallLog.ts"
Cohesion: 0.40
Nodes (4): listToolCalls(), logToolCalls(), ToolCallLog, toolCallLogs

## Knowledge Gaps
- **601 isolated node(s):** `name`, `version`, `type`, `main`, `dev` (+596 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `tokenUsage.ts` to `runProcessor.ts`, `delegationWiring.ts`?**
  _High betweenness centrality (0.166) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `tokenUsage.ts` to `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.159) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `sourceCheckpoint.integration.test.mjs`, `sourceTool.integration.test.mjs`, `toolsSecurity.test.mjs`, `appRoutes.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `hardening.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `executionModes.integration.test.mjs`, `migrationFixture.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `memoryStore.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sourceStaleRun.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `interactiveRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `floorWork.integration.test.mjs`, `gateWiring.integration.test.mjs`, `channelApps.integration.test.mjs`, `channelOverview.integration.test.mjs`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `type` to the rest of the system?**
  _601 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `llm.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14624505928853754 - nodes in this community are weakly interconnected._
- **Should `eventTrigger.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13054187192118227 - nodes in this community are weakly interconnected._