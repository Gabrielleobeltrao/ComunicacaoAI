# Graph Report - backend  (2026-08-18)

## Corpus Check
- 288 files · ~296,017 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2489 nodes · 5776 edges · 176 communities (148 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c48dff82`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- eventTrigger.ts
- routine.ts
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
- runProcessor.ts
- agentEvents.ts
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
- sectors.ts
- runRepository.ts
- sourceMonitoring.test.mjs
- connections/service.ts
- claude.ts
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
- agentLiveTracker.ts
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
- openai.ts
- seedRestaurantDemo.ts
- channelApps.ts
- http.ts
- sectorKnowledgeRoutes.ts
- llmFake.ts
- entrypointParity.test.mjs
- automations/service.ts
- agentDefinition.ts
- agentRoutineRoutes.ts
- apps/types.ts
- tokenUsage.ts
- run-tests.mjs
- providerApps.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- builtinTools.ts
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- delegateToAgent
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- floorCommunication.ts
- sectorAccess.integration.test.mjs
- floorRoutes.ts
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
- AutomationDefinition
- decrypt
- appRoutes.integration.test.mjs
- buildClient
- safeHttp.ts
- googleTools.ts
- config.ts
- floors.ts
- safeError.ts
- ResolvedTool
- googleCalendar.ts
- scopeGate.test.mjs
- official/index.ts
- hubspot/adapter.ts
- hardening.integration.test.mjs
- nuvemshop/adapter.ts
- rd-station/adapter.ts
- email/manifest.ts
- floorWork.ts
- telegram/manifest.ts
- playgroundSession.ts
- web-chat/manifest.ts
- whatsapp/manifest.ts
- autoModel.ts
- agentLiveState.test.mjs
- executeSectorTeam

## God Nodes (most connected - your core abstractions)
1. `respondWithAgentIfLinked()` - 55 edges
2. `db` - 51 edges
3. `startMongo()` - 41 edges
4. `stopMongo()` - 41 edges
5. `buildDeps()` - 39 edges
6. `getAgentById()` - 31 edges
7. `productionDelegationDeps()` - 28 edges
8. `encrypt()` - 26 edges
9. `ResolvedTool` - 24 edges
10. `refreshMemoryAndIdentity()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
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

## Communities (176 total, 28 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.15
Nodes (21): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, getWidgetConfigAgent(), inboundMediaToText(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity() (+13 more)

### Community 1 - "eventTrigger.ts"
Cohesion: 0.20
Nodes (23): buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), readEventTriggerConfig(), updateEventTrigger() (+15 more)

### Community 2 - "routine.ts"
Cohesion: 0.20
Nodes (23): appStep(), emptyMemoryPlan(), normalizeMemoryPlan(), buildRoutineDefinition(), createRoutine(), normalizeSource(), novaGeracaoDeFonte(), readRoutineExecution() (+15 more)

### Community 3 - "agentRuntime.ts"
Cohesion: 0.12
Nodes (26): enforceOutputContract(), AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+18 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.09
Nodes (33): chunks, chunkText(), combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), documents (+25 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (50): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+42 more)

### Community 6 - "src/index.ts"
Cohesion: 0.05
Nodes (38): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), app, AVATAR_MIME_TYPES, channelWebhookUrl() (+30 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (49): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentToolHeader, AgentToolParam (+41 more)

### Community 9 - "grants.ts"
Cohesion: 0.26
Nodes (13): missingCapability(), AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate(), isVersionCompatible() (+5 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (32): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+24 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.08
Nodes (37): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+29 more)

### Community 12 - "runner.ts"
Cohesion: 0.06
Nodes (69): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), RoutineSource, AgentCall, delay() (+61 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.11
Nodes (24): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+16 more)

### Community 14 - "delegation.ts"
Cohesion: 0.11
Nodes (20): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, ClarificationRequest, buildCapabilityMissing(), CapabilityMissing, DEFAULT_DELEGATION_TOKEN_BUDGET, DelegationBudget (+12 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.06
Nodes (17): FLOOR, PAGE, OPCOES, AGENTE, SETOR, startMongo(), stopMongo(), A (+9 more)

### Community 16 - "automations/types.ts"
Cohesion: 0.14
Nodes (18): StepCondition, EventTriggerSpec, AppActionPlan, MemoryPlan, RoutineSpec, AI_STEP_TYPES, AutomationInput, AutomationLimits (+10 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.14
Nodes (18): ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter(), InboundMediaRef, InboundMessage (+10 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.14
Nodes (17): instrumentTools(), executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineRunContext, RoutineStepCall, RoutineStepResult (+9 more)

### Community 20 - "runProcessor.ts"
Cohesion: 0.16
Nodes (26): runEventKey(), createLiveTracker(), findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor() (+18 more)

### Community 21 - "agentEvents.ts"
Cohesion: 0.20
Nodes (11): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow (+3 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "migration.ts"
Cohesion: 0.13
Nodes (26): AgentBuiltinTool, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation(), ensureGoogleInstallations() (+18 more)

### Community 25 - "records.ts"
Cohesion: 0.07
Nodes (54): readPath(), clarificationKey(), ClarifyMemoryTarget, recallClarifications(), rememberClarification(), assertAgentMayWrite(), floors, MemoryAccessError (+46 more)

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
Nodes (16): ensureAgentLiveStateIndexes(), auth, db, mongoClient, AgentDoc, arg(), main(), SHOWCASE (+8 more)

### Community 32 - "sectors.ts"
Cohesion: 0.05
Nodes (59): serializeSector(), PERIODS, sectorExecutionRouter, accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision (+51 more)

### Community 33 - "runRepository.ts"
Cohesion: 0.11
Nodes (25): artifacts, findRun(), insertRunIdempotent(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel() (+17 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.08
Nodes (23): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), connections, deliveries, listDeliveries(), sentDeliveriesByAgent() (+15 more)

### Community 36 - "claude.ts"
Cohesion: 0.15
Nodes (16): anthropicUsage(), AUXILIARY_MODEL, DEFAULT_MODEL, FALLBACK_MODELS, generateAgentReply(), listAvailableModels(), cache, cacheKey() (+8 more)

### Community 37 - "agentTools.ts"
Cohesion: 0.16
Nodes (16): AgentTool, legacyToolToExecutable(), MAX_TOOL_ITERATIONS, resolveHttpTool(), toolInputSchema(), ExecutableTool, executeToolCall(), ExecuteToolOptions (+8 more)

### Community 38 - "tools.ts"
Cohesion: 0.09
Nodes (21): clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS, TOOL_LIMITS (+13 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.12
Nodes (21): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+13 more)

### Community 41 - "jsonSchema.ts"
Cohesion: 0.23
Nodes (14): runResolvedTool(), checkStageOutput(), checkJsonText(), JsonCheck, parseJsonText(), describeErrors(), join(), matchesType() (+6 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "validate.ts"
Cohesion: 0.20
Nodes (17): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), canonical() (+9 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "installations.ts"
Cohesion: 0.09
Nodes (34): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installationPublic(), installations, LEGACY_APP_VERSION, listInstallations() (+26 more)

### Community 48 - "agentLiveTracker.ts"
Cohesion: 0.24
Nodes (7): AgentBubbleState, catalogIndex(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail(), SYSTEM_APPS

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
Nodes (28): AppStepContext, AppStepError, executeAppStep(), resolveArgs(), describeManifestIssues(), exportableManifest(), archivePrivateApp(), createPrivateApp() (+20 more)

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

### Community 76 - "AppDefinition"
Cohesion: 0.38
Nodes (7): adapters, manifest, native(), num(), schema(), str(), AppDefinition

### Community 77 - "delegationWiring.ts"
Cohesion: 0.12
Nodes (19): agentCanDelegate(), capabilityMissingTool(), DelegationContext, TEAM_TOOL_NAMES, col, DelegationFinish, DelegationRecord, DelegationStart (+11 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.22
Nodes (5): automations, listActiveAutomations(), listActivePublished(), ListAutomationsQuery, versions

### Community 84 - "openai.ts"
Cohesion: 0.08
Nodes (37): checkGuardrail(), planSectorResponse(), planStageTransition(), AUXILIARY_MODEL, checkGuardrail(), DEFAULT_MODEL, FALLBACK_MODELS, generateAgentReply() (+29 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.21
Nodes (14): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+6 more)

### Community 97 - "http.ts"
Cohesion: 0.28
Nodes (4): AutomationVersion, ValidationError, automationRouter, fail()

### Community 98 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.21
Nodes (9): resolveOwnedSectorId(), deleteDocument(), deleteDocumentFor(), KnowledgeDocument, oid(), requireSector(), requireSector(), sectorKnowledgeRouter (+1 more)

### Community 99 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "automations/service.ts"
Cohesion: 0.16
Nodes (24): ensureActivationMode(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), defaultDefinition(), normalizeName() (+16 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.10
Nodes (29): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+21 more)

### Community 103 - "agentRoutineRoutes.ts"
Cohesion: 0.16
Nodes (18): getAgentById(), EventTriggerError, normalizeCondition(), webhookEndpoint(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError (+10 more)

### Community 104 - "apps/types.ts"
Cohesion: 0.11
Nodes (25): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+17 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): TokenUsage, dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "providerApps.ts"
Cohesion: 0.25
Nodes (10): adapters, manifest, hubspotTools(), mercadoPagoTools(), num(), nuvemshopTools(), objectSchema(), rdStationTools() (+2 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.16
Nodes (12): AGENT, agentDoc(), ALVO, alvoDoc(), base, call, ctx, depsDelegacao() (+4 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "builtinTools.ts"
Cohesion: 0.13
Nodes (18): resolveAppGrantTools(), APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, getBuiltinApp() (+10 more)

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "interactiveRoutes.integration.test.mjs"
Cohesion: 0.43
Nodes (7): comSessao(), criarAgente(), esperarCobranca(), esperarTurnos(), patch(), somar(), tokensDoDono()

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "delegateToAgent"
Cohesion: 0.27
Nodes (14): agentCard(), asOutputFormat(), buildDelegationTools(), checkDelegation(), delegateToAgent(), delegateToSector(), gateContext(), gateTargetForAgent() (+6 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "floorCommunication.ts"
Cohesion: 0.18
Nodes (14): Building, buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode (+6 more)

### Community 120 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 121 - "floorRoutes.ts"
Cohesion: 0.24
Nodes (9): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, deleteFloor(), getFloorActivity(), setFloorStatus() (+1 more)

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
Cohesion: 0.09
Nodes (33): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+25 more)

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
Cohesion: 0.30
Nodes (11): searchKnowledgeLexicallyForOwners(), escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm, normalize(), pad() (+3 more)

### Community 146 - "AutomationDefinition"
Cohesion: 0.31
Nodes (10): CreateAutomationInput, UpdateDraftPatch, Automation, AutomationDefinition, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent() (+2 more)

### Community 147 - "decrypt"
Cohesion: 0.31
Nodes (7): findByWebhookKey(), signBody(), verifySignature(), webhookIdempotencyKey(), decrypt(), getKey(), webhookRouter

### Community 149 - "buildClient"
Cohesion: 0.18
Nodes (17): buildClient(), extractIdentity(), extractStructuredOutput(), transcribeImage(), updateMemory(), updateStructuredMemory(), buildClient(), extractIdentity() (+9 more)

### Community 150 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 151 - "googleTools.ts"
Cohesion: 0.50
Nodes (5): getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 152 - "config.ts"
Cohesion: 0.32
Nodes (7): clientUrl, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig()

### Community 153 - "floors.ts"
Cohesion: 0.15
Nodes (20): BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE, isValidTimezone(), LANGUAGES, updateBuilding(), collection (+12 more)

### Community 155 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 156 - "ResolvedTool"
Cohesion: 0.43
Nodes (7): RecordAgentEventInput, AgentExecutionRequest, AgentExecutionResult, ResolvedTool, RoutineExecutionDeps, DelegationDeps, FloorCommunicationConfig

### Community 157 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (14): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse, deleteIntegration() (+6 more)

### Community 159 - "official/index.ts"
Cohesion: 0.17
Nodes (10): MODULES, OFFICIAL_ADAPTERS, OFFICIAL_APPS, OfficialAppsError, OfficialModule, adapters, manifest, adapters (+2 more)

### Community 165 - "floorWork.ts"
Cohesion: 0.17
Nodes (17): Agent, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows() (+9 more)

### Community 167 - "playgroundSession.ts"
Cohesion: 0.25
Nodes (8): guardarTurnoDeTeste(), appendPlaygroundTurns(), clearPlaygroundTurns(), cortar(), loadPlaygroundTurns(), PlaygroundSession, PlaygroundTurn, sessions

### Community 170 - "autoModel.ts"
Cohesion: 0.29
Nodes (7): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), auxModelFor()

### Community 175 - "executeSectorTeam"
Cohesion: 0.31
Nodes (9): emitAgentEvent(), executeSectorTeam(), participationTelemetry(), recordChildRun(), stageInstruction(), BriefingMember, coordinatorBriefing(), limpar() (+1 more)

## Knowledge Gaps
- **605 isolated node(s):** `name`, `version`, `type`, `main`, `dev` (+600 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.189) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `runProcessor.ts`?**
  _High betweenness centrality (0.181) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `sourceCheckpoint.integration.test.mjs`, `sourceTool.integration.test.mjs`, `toolsSecurity.test.mjs`, `appRoutes.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `hardening.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `executionModes.integration.test.mjs`, `migrationFixture.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `memoryStore.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sourceStaleRun.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `interactiveRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `floorWork.integration.test.mjs`, `gateWiring.integration.test.mjs`, `sectorTeam.integration.test.mjs`, `channelApps.integration.test.mjs`, `channelOverview.integration.test.mjs`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `type` to the rest of the system?**
  _605 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `llm.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14624505928853754 - nodes in this community are weakly interconnected._
- **Should `agentRuntime.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12315270935960591 - nodes in this community are weakly interconnected._