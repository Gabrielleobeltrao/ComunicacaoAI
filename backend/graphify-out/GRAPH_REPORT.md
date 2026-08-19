# Graph Report - backend  (2026-08-19)

## Corpus Check
- 300 files · ~323,361 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2640 nodes · 6110 edges · 198 communities (170 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fb3557ec`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- widgets.ts
- sourceCheckpoint.ts
- interactiveRun.ts
- knowledge.ts
- executionCenter.ts
- src/index.ts
- audit.ts
- agents.ts
- grants.ts
- agentReadiness.ts
- respondWithAgentIfLinked
- runner.ts
- floors.ts
- delegation.ts
- mongoServer.mjs
- automations/types.ts
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
- eventTrigger.ts
- runRepository.ts
- sectorExecutions.ts
- sectorAccess.ts
- sourceMonitoring.test.mjs
- connections/service.ts
- toolExecution.ts
- llmFake.ts
- tools.ts
- eventTrigger.integration.test.mjs
- executionRoots.ts
- jsonSchema.ts
- executionModes.integration.test.mjs
- scripts
- validate.ts
- package.json
- migrationFixture.integration.test.mjs
- webSourcePolicy.ts
- sectorKnowledgeRoutes.ts
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
- scheduler.ts
- delegationWiring.ts
- automations/repository.ts
- routine.test.mjs
- seedGuard.test.mjs
- sectorPlanner.ts
- seedRestaurantDemo.ts
- channelApps.ts
- openai.ts
- agentTools.ts
- agentRoutineRoutes.ts
- entrypointParity.test.mjs
- automations/service.ts
- agentDefinition.ts
- installations.ts
- sourceChange.ts
- tokenUsage.ts
- run-tests.mjs
- providerApps.ts
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
- db.ts
- autoModel.ts
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
- systemPrompt.ts
- conversationTurns.ts
- lexicalRetrieval.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- executionTrace.ts
- config.ts
- appRoutes.integration.test.mjs
- claude.ts
- agentEvents.ts
- building.ts
- sourceTool.ts
- apps/manifest.ts
- toolsSecurity.test.mjs
- webContent.ts
- sectorPlanner.test.mjs
- scopeGate.test.mjs
- AppDefinition
- mercado-pago/adapter.ts
- hardening.integration.test.mjs
- delegateToAgent
- agentRuntime.ts
- buildClient
- floorWork.ts
- playgroundSession.ts
- safeHttp.ts
- official/index.ts
- sectorAccess.integration.test.mjs
- webSourcePolicy.test.mjs
- webKnowledge.integration.test.mjs
- webKnowledge.ts
- apps/types.ts
- sectorBriefing.ts
- runConfig.ts
- googleTools.ts
- telegram/manifest.ts
- hubspot/adapter.ts
- runAgentTask
- rd-station/adapter.ts
- email/manifest.ts
- whatsapp/manifest.ts
- agentLiveTracker.ts
- builtinTools.ts
- modelDefaults.ts
- buildGuardrailCheckPrompt
- buildSectorPlannerPrompt
- buildStageTransitionPrompt
- getSectorById
- auditSectorFloorIntegrity.ts
- web-chat/manifest.ts

## God Nodes (most connected - your core abstractions)
1. `respondWithAgentIfLinked()` - 55 edges
2. `db` - 52 edges
3. `startMongo()` - 42 edges
4. `stopMongo()` - 42 edges
5. `buildDeps()` - 39 edges
6. `getAgentById()` - 33 edges
7. `productionDelegationDeps()` - 32 edges
8. `executeSectorTeam()` - 29 edges
9. `encrypt()` - 26 edges
10. `ResolvedTool` - 24 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `ensureAgentWebKnowledgeFresh()` --indirect_call--> `site()`  [INFERRED]
  src/webKnowledge.ts → test/sourceTool.integration.test.mjs
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (198 total, 28 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.16
Nodes (20): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, askAux(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput() (+12 more)

### Community 1 - "widgets.ts"
Cohesion: 0.07
Nodes (31): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 2 - "sourceCheckpoint.ts"
Cohesion: 0.15
Nodes (17): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), sourceFingerprint(), acquireSourceLease(), advanceCheckpoint() (+9 more)

### Community 3 - "interactiveRun.ts"
Cohesion: 0.23
Nodes (11): enforceOutputContract(), AgentRunError, comPrazo(), espera(), InteractiveReply, InteractiveRunOptions, runInteractive(), ToolRisk (+3 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.09
Nodes (26): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), documents, EMBEDDING_DIMENSIONS (+18 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (50): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+42 more)

### Community 6 - "src/index.ts"
Cohesion: 0.04
Nodes (41): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), clarificationGuidance(), CLARIFY_LIMIT, app (+33 more)

### Community 7 - "audit.ts"
Cohesion: 0.07
Nodes (42): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+34 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (50): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentToolHeader, AgentToolParam (+42 more)

### Community 9 - "grants.ts"
Cohesion: 0.15
Nodes (23): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+15 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (31): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+23 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.08
Nodes (38): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+30 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (23): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, MemoryOps, runDefinition(), RunnerDeps (+15 more)

### Community 13 - "floors.ts"
Cohesion: 0.06
Nodes (60): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+52 more)

### Community 14 - "delegation.ts"
Cohesion: 0.10
Nodes (23): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, ClarificationRequest, buildCapabilityMissing(), CapabilityMissing, DEFAULT_DELEGATION_TOKEN_BUDGET, DelegationBudget (+15 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.06
Nodes (17): FLOOR, PAGE, OPCOES, AGENTE, SETOR, startMongo(), stopMongo(), A (+9 more)

### Community 16 - "automations/types.ts"
Cohesion: 0.11
Nodes (23): ensureActivationMode(), CreateAutomationInput, syncEventTriggerFor(), UpdateDraftPatch, AI_STEP_TYPES, Automation, AutomationDefinition, AutomationInput (+15 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.18
Nodes (14): RecordAgentEventInput, LiveTracker, AgentExecutionRequest, AgentExecutionResult, ResolvedTool, KnowledgeUnavailableError, RoutineConfigurationError, RoutineExecutionDeps (+6 more)

### Community 20 - "runProcessor.ts"
Cohesion: 0.16
Nodes (25): runEventKey(), createLiveTracker(), findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor() (+17 more)

### Community 21 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (14): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse, deleteIntegration() (+6 more)

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

### Community 30 - "eventTrigger.ts"
Cohesion: 0.20
Nodes (28): buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), readEventTriggerConfig(), updateEventTrigger() (+20 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.13
Nodes (22): artifacts, findRun(), insertRunIdempotent(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel() (+14 more)

### Community 32 - "sectorExecutions.ts"
Cohesion: 0.13
Nodes (19): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+11 more)

### Community 33 - "sectorAccess.ts"
Cohesion: 0.20
Nodes (15): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+7 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.09
Nodes (22): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), connections, deliveries, listDeliveries(), sentDeliveriesByAgent() (+14 more)

### Community 36 - "toolExecution.ts"
Cohesion: 0.20
Nodes (12): decrypt(), getKey(), executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets() (+4 more)

### Community 37 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

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
Cohesion: 0.19
Nodes (19): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), canonical() (+11 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "webSourcePolicy.ts"
Cohesion: 0.11
Nodes (18): DEFAULT_ARTICLES_PER_RUN, DEFAULT_INTERVAL_MINUTES, DEFAULT_STALENESS_MINUTES, DISCOVERY_MODES, DiscoveryMode, emMs(), limitar(), MAX_ARTICLES_PER_RUN (+10 more)

### Community 48 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.15
Nodes (14): chunkText(), deleteDocument(), deleteDocumentFor(), getDocument(), getDocumentFor(), indexDocumentChunks(), KnowledgeDocument, listDocuments() (+6 more)

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
Cohesion: 0.18
Nodes (21): backfillManagedChannelInstallations(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), backfillSourceFingerprints() (+13 more)

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

### Community 76 - "scheduler.ts"
Cohesion: 0.23
Nodes (13): findVersion(), advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes() (+5 more)

### Community 77 - "delegationWiring.ts"
Cohesion: 0.13
Nodes (22): agentCanDelegate(), capabilityMissingTool(), DelegationContext, TEAM_TOOL_NAMES, col, DelegationFinish, DelegationRecord, DelegationStart (+14 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.13
Nodes (11): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+3 more)

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.11
Nodes (35): executeSectorTeam(), stageInstruction(), assembleWithoutModel(), buildSynthesisContext(), dedupeAgainst(), describeMember(), describePlan(), ExecutionTask (+27 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.20
Nodes (14): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+6 more)

### Community 97 - "openai.ts"
Cohesion: 0.21
Nodes (14): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), AUXILIARY_MODEL, DEFAULT_MODEL (+6 more)

### Community 98 - "agentTools.ts"
Cohesion: 0.32
Nodes (7): AgentTool, legacyToolToExecutable(), MAX_TOOL_ITERATIONS, resolveHttpTool(), toolInputSchema(), ExecutableTool, TOOL_DEFAULTS

### Community 99 - "agentRoutineRoutes.ts"
Cohesion: 0.11
Nodes (43): getAgentById(), StepCondition, EventTriggerError, EventTriggerSpec, normalizeCondition(), webhookEndpoint(), AppActionPlan, MemoryPlan (+35 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "automations/service.ts"
Cohesion: 0.16
Nodes (20): assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), defaultDefinition(), normalizeName(), requireFloor() (+12 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.18
Nodes (17): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+9 more)

### Community 103 - "installations.ts"
Cohesion: 0.10
Nodes (31): createInstallation(), CreateInstallationInput, deleteInstallation(), installationPublic(), installations, LEGACY_APP_VERSION, listInstallations(), markInstallationTested() (+23 more)

### Community 104 - "sourceChange.ts"
Cohesion: 0.21
Nodes (19): detectRssChange(), HttpChange, INITIAL_WINDOWS, InitialWindow, normalizeSourceUrl(), pareceFeed(), RssChange, previewSource() (+11 more)

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

### Community 111 - "clarify.ts"
Cohesion: 0.38
Nodes (6): clarificationFrom(), CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarifyBudgetSpent()

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
Cohesion: 0.15
Nodes (18): createSector(), deleteSector(), enforceSingleMembership(), MAX_SECTOR_MEMBERS, membersFromStages(), normalizeMembers(), normalizeStages(), SECTOR_MODE_LABEL (+10 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "floorCommunication.ts"
Cohesion: 0.18
Nodes (14): Building, buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode (+6 more)

### Community 120 - "db.ts"
Cohesion: 0.10
Nodes (20): auth, db, mongoClient, createOffice(), ensureDefaultOffice(), Office, offices, assignAgentToSector() (+12 more)

### Community 121 - "autoModel.ts"
Cohesion: 0.29
Nodes (7): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), auxModelFor()

### Community 123 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 124 - "gateWiring.integration.test.mjs"
Cohesion: 0.53
Nodes (5): agents(), insertAgent(), insertSector(), sectors(), threeAnswers()

### Community 125 - "sectorTeam.integration.test.mjs"
Cohesion: 0.20
Nodes (3): ANDAR, EVENTOS, PREDIO

### Community 126 - "channelApps.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addChannel(), addEmptyInstallation(), connections(), widgets()

### Community 127 - "channelOverview.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addWidget(), messages(), say(), widgets()

### Community 129 - "engine.ts"
Cohesion: 0.14
Nodes (19): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+11 more)

### Community 131 - "sourceCheckpoint.integration.test.mjs"
Cohesion: 0.25
Nodes (5): agora, AUTOMACAO, FONTE, OUTRA_FONTE, QUANDO

### Community 133 - "scopeCache.ts"
Cohesion: 0.31
Nodes (8): cache, chaveDe(), Entrada, normalizar(), rememberedScope(), rememberScope(), checkScope(), ScopeVerdict

### Community 134 - "sourceTool.integration.test.mjs"
Cohesion: 0.22
Nodes (6): AGENTE, agenteFalso, ANDAR, FEED(), itensDoFeed, servidor

### Community 135 - "timeoutCancellation.test.mjs"
Cohesion: 0.40
Nodes (4): AnthropicFalso, comportamento, contadora(), espera()

### Community 137 - "systemPrompt.ts"
Cohesion: 0.12
Nodes (13): buildIdentityCaptureInstruction(), buildProactivityInstruction(), buildResponseStyleInstruction(), DETAIL_INSTRUCTIONS, GUARDRAIL_CHECK_SYSTEM_PROMPT, GUARDRAIL_REFUSAL_MESSAGE, GUARDRAIL_SCOPE_INSTRUCTION, HANDOFF_INSTRUCTION (+5 more)

### Community 139 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 140 - "lexicalRetrieval.ts"
Cohesion: 0.20
Nodes (17): searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm (+9 more)

### Community 146 - "executionTrace.ts"
Cohesion: 0.17
Nodes (11): ExecutionTraceEvent, onTraceEvent(), readTrace(), sanitize(), Sink, traceEvent(), TraceEventType, TraceInput (+3 more)

### Community 147 - "config.ts"
Cohesion: 0.32
Nodes (7): clientUrl, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig()

### Community 149 - "claude.ts"
Cohesion: 0.17
Nodes (16): anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), DEFAULT_MODEL, FALLBACK_MODELS, generateAgentReply(), transcribeImage() (+8 more)

### Community 150 - "agentEvents.ts"
Cohesion: 0.20
Nodes (11): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow (+3 more)

### Community 151 - "building.ts"
Cohesion: 0.14
Nodes (12): BuildingPatch, buildings, DEFAULT_TIMEZONE, LANGUAGES, ValidationError, CONNECTION_CATALOG, auditEntity(), automationRouter (+4 more)

### Community 152 - "sourceTool.ts"
Cohesion: 0.35
Nodes (10): RoutineSource, chaveDoItem(), contentHashOf(), detectHttpChange(), getCheckpoint(), FonteDoAgente, j(), normalizar() (+2 more)

### Community 153 - "apps/manifest.ts"
Cohesion: 0.23
Nodes (13): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+5 more)

### Community 156 - "webContent.ts"
Cohesion: 0.32
Nodes (11): canonicalFromHtml(), canonicalizeUrl(), domainOf(), extractPageMeta(), extractReadableText(), iso(), metaContent(), pageFacts() (+3 more)

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.33
Nodes (4): COZINHA, EQUIPE, FINANCEIRO, JURIDICO

### Community 159 - "AppDefinition"
Cohesion: 0.38
Nodes (7): adapters, manifest, native(), num(), schema(), str(), AppDefinition

### Community 162 - "delegateToAgent"
Cohesion: 0.27
Nodes (14): agentCard(), asOutputFormat(), buildDelegationTools(), checkDelegation(), delegateToAgent(), delegateToSector(), gateContext(), gateTargetForAgent() (+6 more)

### Community 163 - "agentRuntime.ts"
Cohesion: 0.23
Nodes (12): AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), executeAgentTask(), inputToText(), ReplyFn, schemaDepth() (+4 more)

### Community 164 - "buildClient"
Cohesion: 0.22
Nodes (13): extractIdentity(), extractStructuredOutput(), updateStructuredMemory(), askAux(), buildClient(), extractIdentity(), extractStructuredOutput(), transcribeImage() (+5 more)

### Community 165 - "floorWork.ts"
Cohesion: 0.17
Nodes (16): Agent, AgentAppGrant, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget (+8 more)

### Community 166 - "playgroundSession.ts"
Cohesion: 0.25
Nodes (8): guardarTurnoDeTeste(), appendPlaygroundTurns(), clearPlaygroundTurns(), cortar(), loadPlaygroundTurns(), PlaygroundSession, PlaygroundTurn, sessions

### Community 167 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 168 - "official/index.ts"
Cohesion: 0.17
Nodes (10): MODULES, OFFICIAL_ADAPTERS, OFFICIAL_APPS, OfficialAppsError, OfficialModule, adapters, manifest, adapters (+2 more)

### Community 169 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 171 - "webKnowledge.integration.test.mjs"
Cohesion: 0.33
Nodes (5): artigosNoFeed, comFeed(), criarAgente(), pedidos, textoDaMateria

### Community 172 - "webKnowledge.ts"
Cohesion: 0.12
Nodes (28): WatchedSource, feedFromHtml(), looksLikeContent(), DiscoveryPlan, DiscoveryProbe, ehFeed(), planDiscovery(), urlsFromFeed() (+20 more)

### Community 174 - "apps/types.ts"
Cohesion: 0.12
Nodes (14): APP_ACTIVATIONS, APP_AVAILABILITIES, AppActionExecution, AppAuthDefinition, AppAuthField, AppAuthKind, AppAvailability, AppInstallationPublic (+6 more)

### Community 175 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

### Community 177 - "runConfig.ts"
Cohesion: 0.18
Nodes (12): dentro(), LIMITS, MATRIX, ModelCapabilities, normalizeRunConfig(), numeroFinito(), REASONING_EFFORTS, ReasoningEffort (+4 more)

### Community 178 - "googleTools.ts"
Cohesion: 0.50
Nodes (5): getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 182 - "runAgentTask"
Cohesion: 0.24
Nodes (11): executeRoutineStep(), persistWithRetry(), childContext(), runAgentTask(), runWithRetry(), preview(), breadthNotice(), buildRetrievalQuery() (+3 more)

### Community 187 - "agentLiveTracker.ts"
Cohesion: 0.24
Nodes (8): AgentBubbleState, catalogIndex(), instrumentTools(), LiveTrackerContext, NOOP_TRACKER, toolDetail(), ToolTrace, SYSTEM_APPS

### Community 188 - "builtinTools.ts"
Cohesion: 0.24
Nodes (10): resolveAppGrantTools(), APP_GUIDES, BUILTIN_APPS, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, getBuiltinApp(), resolveAgentTools() (+2 more)

### Community 189 - "modelDefaults.ts"
Cohesion: 0.33
Nodes (4): ANTHROPIC_AUX_MODEL, ANTHROPIC_DEFAULT_MODEL, OPENAI_AUX_MODEL, OPENAI_DEFAULT_MODEL

### Community 190 - "buildGuardrailCheckPrompt"
Cohesion: 0.67
Nodes (4): checkGuardrail(), checkGuardrail(), buildGuardrailCheckPrompt(), parseInScopeResult()

### Community 191 - "buildSectorPlannerPrompt"
Cohesion: 0.67
Nodes (4): planSectorResponse(), planSectorResponse(), buildSectorPlannerPrompt(), parseSectorPlan()

### Community 192 - "buildStageTransitionPrompt"
Cohesion: 0.67
Nodes (4): planStageTransition(), planStageTransition(), buildStageTransitionPrompt(), parseStageTransition()

### Community 193 - "getSectorById"
Cohesion: 0.50
Nodes (4): resolveOwnedSectorId(), requireSector(), requireSector(), getSectorById()

## Knowledge Gaps
- **653 isolated node(s):** `name`, `version`, `type`, `main`, `dev` (+648 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ensureAgentWebKnowledgeFresh()` connect `webKnowledge.ts` to `agentRoutineRoutes.ts`, `delegationWiring.ts`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **Why does `site()` connect `webKnowledge.ts` to `sourceTool.integration.test.mjs`?**
  _High betweenness centrality (0.129) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `sourceCheckpoint.integration.test.mjs`, `sourceTool.integration.test.mjs`, `appRoutes.integration.test.mjs`, `toolsSecurity.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `hardening.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `executionModes.integration.test.mjs`, `webKnowledge.integration.test.mjs`, `migrationFixture.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `memoryStore.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sourceStaleRun.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `interactiveRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `floorWork.integration.test.mjs`, `gateWiring.integration.test.mjs`, `sectorTeam.integration.test.mjs`, `channelApps.integration.test.mjs`, `channelOverview.integration.test.mjs`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `type` to the rest of the system?**
  _653 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `widgets.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07258064516129033 - nodes in this community are weakly interconnected._
- **Should `sourceCheckpoint.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14736842105263157 - nodes in this community are weakly interconnected._