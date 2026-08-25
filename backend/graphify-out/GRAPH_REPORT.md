# Graph Report - backend  (2026-08-25)

## Corpus Check
- 396 files · ~475,036 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3561 nodes · 8241 edges · 229 communities (198 shown, 31 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 70 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `200096cb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- installations.ts
- sourceChange.ts
- agentRoutineRoutes.ts
- whatsapp.ts
- knowledge.ts
- voyage.ts
- src/index.ts
- openai.ts
- agents.ts
- grants.ts
- agentReadiness.ts
- respondWithAgentIfLinked
- routine.ts
- agentLiveState.ts
- delegation.ts
- mongoServer.mjs
- official/index.ts
- googleCalendar.ts
- patterns.ts
- floorWork.ts
- guard.ts
- streams/service.ts
- dependencies
- agentMetrics.ts
- agentCapabilities.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- privateApps.ts
- runRepository.ts
- migrate.ts
- widgets.ts
- sourceMonitoring.test.mjs
- connections/service.ts
- validate.ts
- llmFake.ts
- tools.ts
- eventTrigger.integration.test.mjs
- executionRoots.ts
- apps/types.ts
- executionModes.integration.test.mjs
- scripts
- dispatcher.ts
- package.json
- bus.ts
- routineExecution.ts
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
- StreamManager
- runner.ts
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
- executionTrace.ts
- seedRestaurantDemo.ts
- routine.test.mjs
- seedGuard.test.mjs
- sectorPlanner.ts
- webKnowledge.ts
- channelApps.ts
- adaptiveWebReader.ts
- floors.ts
- functionRegistry.ts
- entrypointParity.test.mjs
- migration.ts
- agentDefinition.ts
- automations/service.ts
- contract.ts
- tokenUsage.ts
- run-tests.mjs
- sectorExecutions.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- planExecutionE2E.integration.test.mjs
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- sectors.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- browserRenderer.ts
- getSectorById
- sectorKnowledgeRoutes.ts
- collaborationGate.test.mjs
- floorWork.integration.test.mjs
- gateWiring.integration.test.mjs
- sectorTeam.integration.test.mjs
- channelApps.integration.test.mjs
- channelOverview.integration.test.mjs
- llmFakeGate.test.mjs
- automations/engine.ts
- logHygiene.test.mjs
- sourceCheckpoint.integration.test.mjs
- cron-parser
- scopeCache.ts
- sourceTool.integration.test.mjs
- timeoutCancellation.test.mjs
- run.ts
- widgetDestination.test.mjs
- automations/types.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- automations/repository.ts
- audit.ts
- appRoutes.integration.test.mjs
- clarify.ts
- claude.ts
- routineExecutorPaths.integration.test.mjs
- config.ts
- db.ts
- marketData/engine.ts
- sectorPlanner.test.mjs
- scopeGate.test.mjs
- streamManager.integration.test.mjs
- runProcessor.ts
- sourceCheckpoint.ts
- step.ts
- adaptiveWebReader.test.mjs
- executionCenter.ts
- internalEvents.ts
- publicWidgetRoutes.integration.test.mjs
- agentTools.ts
- webSourcePolicy.test.mjs
- webKnowledge.integration.test.mjs
- agentRuntime.ts
- alpaca.test.mjs
- executorAudit.integration.test.mjs
- delegationWiring.ts
- agentRoleRuntime.integration.test.mjs
- executorDispatcher.test.mjs
- internalEventTrigger.integration.test.mjs
- llm.ts
- systemPrompt.ts
- dependenciasDeclaradas.test.mjs
- validateAgainstSchema
- alpaca/adapter.ts
- eventTrigger.ts
- planCompiler.test.mjs
- sourceSsrf.test.mjs
- client.ts
- building.ts
- policyEnforcement.integration.test.mjs
- executorHardening.test.mjs
- agentEvents.ts
- hardening.integration.test.mjs
- connectionProfile.integration.test.mjs
- webSearch/budget.ts
- migrationFixture.integration.test.mjs
- researcherWebResearch.integration.test.mjs
- state.ts
- policies/repository.ts
- toolExecutor.ts
- sources.ts
- alpaca/manifest.ts
- manager.ts
- tradingPolicy.test.mjs
- events/types.ts
- executeSectorTeam
- connectionProfile.ts
- webSearch/provider.ts
- widgetRuntimeDestination.integration.test.mjs
- fluxoCompleto.integration.test.mjs
- autoModel.ts
- streams/registry.ts
- offices.ts
- toolsSecurity.test.mjs
- actionEvents.ts
- sectorBriefing.ts
- ticks.ts
- tokensByModel.integration.test.mjs
- toolExecutor.integration.test.mjs

## God Nodes (most connected - your core abstractions)
1. `startMongo()` - 69 edges
2. `stopMongo()` - 69 edges
3. `db` - 61 edges
4. `respondWithAgentIfLinked()` - 60 edges
5. `executeSectorTeam()` - 44 edges
6. `buildDeps()` - 43 edges
7. `getAgentById()` - 38 edges
8. `productionDelegationDeps()` - 33 edges
9. `Agent` - 30 edges
10. `runMigrations()` - 29 edges

## Surprising Connections (you probably didn't know these)
- `closeDueCandles()` --indirect_call--> `vela()`  [INFERRED]
  src/marketData/engine.ts → test/candleAnalyzer.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `ensureAgentWebKnowledgeFresh()` --indirect_call--> `site()`  [INFERRED]
  src/webKnowledge.ts → test/sourceTool.integration.test.mjs
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `PrivateAppDoc` --references--> `AppDefinition`  [EXTRACTED]
  src/apps/privateApps.ts → src/apps/types.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (229 total, 31 thin omitted)

### Community 0 - "installations.ts"
Cohesion: 0.07
Nodes (40): ConnectionProbe, connectionProbeFor(), PROBE_TIMEOUT_MS, probes, registerConnectionProbe(), runProbe(), createInstallation(), CreateInstallationInput (+32 more)

### Community 1 - "sourceChange.ts"
Cohesion: 0.17
Nodes (23): RoutineSource, chaveDoItem(), contentHashOf(), detectHttpChange(), detectRssChange(), HttpChange, INITIAL_WINDOWS, InitialWindow (+15 more)

### Community 2 - "agentRoutineRoutes.ts"
Cohesion: 0.14
Nodes (23): emptyMarketPlan(), emptySignalPlan(), EventTriggerError, MarketTriggerPlan, normalizeCondition(), normalizeMarketPlan(), normalizeSignalPlan(), readEventTriggerConfig() (+15 more)

### Community 3 - "whatsapp.ts"
Cohesion: 0.14
Nodes (18): ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter(), InboundMediaRef, InboundMessage (+10 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.07
Nodes (37): chunks, chunkText(), combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), DocumentPage (+29 more)

### Community 5 - "voyage.ts"
Cohesion: 0.07
Nodes (38): BudgetDenial, BudgetDoc, dia(), embeddingBudgetConfig, EmbeddingUsageEvent, embeddingUsageReport, ensureEmbeddingUsageIndexes(), estimateTokens() (+30 more)

### Community 6 - "src/index.ts"
Cohesion: 0.04
Nodes (53): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), aplicarContratoDeFerramenta(), app (+45 more)

### Community 7 - "openai.ts"
Cohesion: 0.10
Nodes (33): extractIdentity(), extractStructuredOutput(), listAvailableModels(), updateMemory(), updateStructuredMemory(), cache, cacheKey(), getCachedModels() (+25 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (45): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, agents, AgentSourceSettings, AgentToolHeader, AgentToolParam, CONVERSATION_PERSISTENCE_TYPES (+37 more)

### Community 9 - "grants.ts"
Cohesion: 0.18
Nodes (22): missingCapability(), recordActionEvent(), takeActionDetail(), environmentOf(), AppStepContext, AppStepError, executeAppStep(), resolveArgs() (+14 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (30): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+22 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.07
Nodes (42): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+34 more)

### Community 12 - "routine.ts"
Cohesion: 0.16
Nodes (31): buildEventTriggerDefinition(), describeEventTriggerFlow(), appStep(), emptyAppActionPlan(), emptyMemoryPlan(), memoryStep(), normalizeAppActionPlan(), normalizeMemoryPlan() (+23 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.09
Nodes (26): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+18 more)

### Community 14 - "delegation.ts"
Cohesion: 0.08
Nodes (46): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, Agent, ClarificationRequest, checkCollaboration(), CollaborationDecision, CollaborationDenyCode (+38 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.03
Nodes (35): FLOOR, PAGE, recebido, OPCOES, AGENTE, SETOR, ANDAR, PREDIO (+27 more)

### Community 16 - "official/index.ts"
Cohesion: 0.10
Nodes (20): manifest, MODULES, OFFICIAL_ADAPTERS, OFFICIAL_APPS, OfficialAppsError, OfficialModule, adapters, manifest (+12 more)

### Community 17 - "googleCalendar.ts"
Cohesion: 0.13
Nodes (21): adapters, manifest, buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), googleConfigured() (+13 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "floorWork.ts"
Cohesion: 0.29
Nodes (9): DELEGATION_MAX_DEPTH, Floor, agents, competencyOf(), effectiveTargets(), FloorTarget, floorWorkOverview, sectors (+1 more)

### Community 20 - "guard.ts"
Cohesion: 0.13
Nodes (25): countActionsSince(), definido(), dinheiro(), evaluatePolicy(), localParts(), looksLikeOption(), minutesOfDay(), needsContext() (+17 more)

### Community 21 - "streams/service.ts"
Cohesion: 0.13
Nodes (28): listEvents(), streamRouter, setStreamManager(), countStreams(), deleteStream(), findStream(), listResumableStreams(), listStreams() (+20 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.16
Nodes (16): AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel(), kpiShortLabel() (+8 more)

### Community 24 - "agentCapabilities.ts"
Cohesion: 0.17
Nodes (11): AgentRole, POR_PRESET, ROLE_LABEL, RoleCapabilities, roleOf(), RoleSection, RoleUIConfig, roleUIConfigOf() (+3 more)

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

### Community 30 - "privateApps.ts"
Cohesion: 0.10
Nodes (27): describeManifestIssues(), exportableManifest(), archivePrivateApp(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listAppsForOwner() (+19 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.10
Nodes (23): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+15 more)

### Community 32 - "migrate.ts"
Cohesion: 0.15
Nodes (26): ensureAppActionIndexes(), backfillManagedChannelInstallations(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), backfillSourceFingerprints() (+18 more)

### Community 33 - "widgets.ts"
Cohesion: 0.07
Nodes (31): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.09
Nodes (22): connections, deliveries, insertDeliveryIdempotent(), listDeliveries(), sentDeliveriesByAgent(), updateDelivery(), CONNECTION_CATALOG, createConnection() (+14 more)

### Community 36 - "validate.ts"
Cohesion: 0.17
Nodes (21): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), hasCycle() (+13 more)

### Community 37 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

### Community 38 - "tools.ts"
Cohesion: 0.10
Nodes (23): revokeInstallation(), encrypt(), clamp(), createTool(), deleteTool(), getTool(), headersDe(), listTools() (+15 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.11
Nodes (21): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+13 more)

### Community 41 - "apps/types.ts"
Cohesion: 0.10
Nodes (27): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+19 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.11
Nodes (13): acaoDeCandles, AGENT, APP_EM_BREVE, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO (+5 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "dispatcher.ts"
Cohesion: 0.12
Nodes (23): conferirEntrada(), conferirSaida(), dispatchAgentExecution(), DispatchDeps, falha(), fromLlmResult(), LlmRunner, semConfiguracao() (+15 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "bus.ts"
Cohesion: 0.12
Nodes (19): backoffMs(), completeEvent(), deadLetter(), devolverHandler(), EVENT_LEASE_MS, EVENT_TTL_MS, EventHandler, events (+11 more)

### Community 47 - "routineExecution.ts"
Cohesion: 0.10
Nodes (32): capabilitiesOf(), RecordAgentEventInput, AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER (+24 more)

### Community 48 - "builtinTools.ts"
Cohesion: 0.11
Nodes (21): adapters, manifest, adapters, manifest, adapters, manifest, NativeFactory, APP_GUIDES (+13 more)

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

### Community 58 - "StreamManager"
Cohesion: 0.21
Nodes (5): naoLoga(), StreamManager, StreamSocket, setStreamError(), setStreamState()

### Community 59 - "runner.ts"
Cohesion: 0.11
Nodes (21): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, MemoryOps, runDefinition(), RunnerDeps (+13 more)

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

### Community 76 - "scheduler.ts"
Cohesion: 0.24
Nodes (12): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes(), planSchedules() (+4 more)

### Community 77 - "executionTrace.ts"
Cohesion: 0.14
Nodes (14): CHAVES_SEGURAS, ExecutionTraceEvent, onTraceEvent(), preview(), readTrace(), recorte(), sanitize(), Sink (+6 more)

### Community 78 - "seedRestaurantDemo.ts"
Cohesion: 0.23
Nodes (13): createAgent(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member() (+5 more)

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.08
Nodes (52): adaptLegacyPlan(), buildSynthesisContext(), clarificationFor(), CompiledPlan, CompileOptions, compilePlan(), describeBinding(), describeMember() (+44 more)

### Community 85 - "webKnowledge.ts"
Cohesion: 0.07
Nodes (47): ReadMode, WatchedSource, browserRendererEnabled(), rendererAtivo(), reindexDocumentFor(), looksLikeContent(), urlsFromFeed(), urlsFromListing() (+39 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.20
Nodes (14): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+6 more)

### Community 97 - "adaptiveWebReader.ts"
Cohesion: 0.11
Nodes (38): aindaEsperando(), anotarEspera(), CABECALHOS, ehDocumentoXml(), emEspera, ExtractedLink, extrair(), falha() (+30 more)

### Community 98 - "floors.ts"
Cohesion: 0.14
Nodes (26): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, ensureDefaultBuilding(), isValidTimezone() (+18 more)

### Community 99 - "functionRegistry.ts"
Cohesion: 0.09
Nodes (12): adaptadores, CONFIG_CASAS, DOC_SAIDA, findAdapterFor(), FunctionAdapter, FunctionHandler, listPublicFunctions(), NUMEROS_SCHEMA (+4 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "migration.ts"
Cohesion: 0.11
Nodes (30): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+22 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.10
Nodes (29): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+21 more)

### Community 103 - "automations/service.ts"
Cohesion: 0.13
Nodes (32): ensureActivationMode(), getAgentById(), createEventTrigger(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation() (+24 more)

### Community 104 - "contract.ts"
Cohesion: 0.10
Nodes (29): AgentModelFields, parseAgentModelFields(), AgentContract, AgentContractInput, agentContractOf(), contractFromFunction(), ContractParseResult, DEFAULT_EXECUTOR (+21 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): TokenUsage, dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "sectorExecutions.ts"
Cohesion: 0.08
Nodes (35): serializeSector(), PERIODS, sectorExecutionRouter, accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision (+27 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.16
Nodes (12): AGENT, agentDoc(), ALVO, alvoDoc(), base, call, ctx, depsDelegacao() (+4 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "planExecutionE2E.integration.test.mjs"
Cohesion: 0.24
Nodes (5): agente(), ANDAR, calculadora(), coletor(), PREDIO

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "interactiveRoutes.integration.test.mjs"
Cohesion: 0.35
Nodes (10): comSessao(), comSite(), criarAgente(), documentosDe(), esperarCobranca(), esperarTurnos(), patch(), perguntar() (+2 more)

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "sectors.ts"
Cohesion: 0.12
Nodes (24): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+16 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "browserRenderer.ts"
Cohesion: 0.15
Nodes (17): BrowserRenderer, buscarPadrao(), ReaderPage, abrirNavegador(), esperarVaga(), fila, liberarVaga(), renderWithBrowser() (+9 more)

### Community 120 - "getSectorById"
Cohesion: 0.16
Nodes (17): listAgents(), bloqueiaSePrejudicaWidget(), resolveOwnedAgentId(), resolveOwnedSectorId(), resolverDestinoDoWidget(), getSectorById(), sectorReadiness, SectorReadinessInput (+9 more)

### Community 121 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.12
Nodes (21): countDocumentsFromSource(), countUnindexedFor(), createDocument(), createDocumentFor(), deleteDocument(), deleteDocumentFor(), findBySourceRef(), getDocument() (+13 more)

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

### Community 129 - "automations/engine.ts"
Cohesion: 0.11
Nodes (26): CANDLE_SWEEP_MS, CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, EVENT_BATCH, EVENT_POLL_MS (+18 more)

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

### Community 137 - "run.ts"
Cohesion: 0.15
Nodes (23): searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm (+15 more)

### Community 140 - "automations/types.ts"
Cohesion: 0.11
Nodes (24): findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, AutomationRun, SafeRunError, AI_STEP_TYPES, AutomationInput (+16 more)

### Community 146 - "automations/repository.ts"
Cohesion: 0.13
Nodes (13): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+5 more)

### Community 147 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 150 - "clarify.ts"
Cohesion: 0.27
Nodes (8): clarificationFrom(), CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarificationGuidance(), CLARIFY_LIMIT, clarifyBudgetSpent()

### Community 151 - "claude.ts"
Cohesion: 0.12
Nodes (24): anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), DEFAULT_MODEL, FALLBACK_MODELS, generateAgentReply(), planSectorResponse() (+16 more)

### Community 152 - "routineExecutorPaths.integration.test.mjs"
Cohesion: 0.29
Nodes (4): agente(), ANDAR, DE_FUNCAO(), PREDIO

### Community 153 - "config.ts"
Cohesion: 0.24
Nodes (9): auth, clientUrl, config, isProduction, originList(), port, stripTrailingSlash(), urlVar() (+1 more)

### Community 155 - "db.ts"
Cohesion: 0.15
Nodes (13): ensureAgentLiveStateIndexes(), db, mongoClient, AgentDoc, arg(), main(), SHOWCASE, aggregateSectorDecisions() (+5 more)

### Community 156 - "marketData/engine.ts"
Cohesion: 0.10
Nodes (38): DispatchDeps, ajustarPontas(), CANDLE_RETENTION_DAYS, candles, candlesCollection, chave(), closeCandle(), closedSeries() (+30 more)

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.22
Nodes (7): ANALISTA, COLETOR, COZINHA, EQUIPE, FINANCEIRO, JURIDICO, TIME

### Community 159 - "streamManager.integration.test.mjs"
Cohesion: 0.13
Nodes (10): ADAPTER, app(), conectar(), gerente(), MANIFESTO, publicados, publicarFalso(), relogioFalso() (+2 more)

### Community 160 - "runProcessor.ts"
Cohesion: 0.15
Nodes (25): findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact() (+17 more)

### Community 161 - "sourceCheckpoint.ts"
Cohesion: 0.14
Nodes (17): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), acquireSourceLease(), advanceCheckpoint(), beginCheck() (+9 more)

### Community 162 - "step.ts"
Cohesion: 0.18
Nodes (16): recordSearchEvent(), AGORA, limitar(), normalizeWebSearch(), respondeAoValorPedido(), SearchDecision, semAcento(), shouldSearch() (+8 more)

### Community 165 - "executionCenter.ts"
Cohesion: 0.07
Nodes (48): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+40 more)

### Community 166 - "internalEvents.ts"
Cohesion: 0.31
Nodes (10): asString(), buildTriggerInput(), chainOf(), DEFAULT_SERIES_LENGTH, dispatchInternalEvent(), internalTriggerOf(), matchesInternalTrigger(), MAX_EVENT_CHAIN (+2 more)

### Community 169 - "agentTools.ts"
Cohesion: 0.11
Nodes (23): AgentTool, legacyToolToExecutable(), MAX_TOOL_ITERATIONS, resolveHttpTool(), runResolvedTool(), toolInputSchema(), decrypt(), getKey() (+15 more)

### Community 171 - "webKnowledge.integration.test.mjs"
Cohesion: 0.23
Nodes (12): agenteComSite(), artigosNoFeed, comBootstrap(), comFeed(), criarAgente(), depsDoRuntime(), pedidos, rodar() (+4 more)

### Community 172 - "agentRuntime.ts"
Cohesion: 0.13
Nodes (25): enforceOutputContract(), AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+17 more)

### Community 175 - "executorAudit.integration.test.mjs"
Cohesion: 0.30
Nodes (11): agente(), ANDAR, CALCULADORA(), COLETOR(), ctx(), deps(), doTipo(), eventos() (+3 more)

### Community 177 - "delegationWiring.ts"
Cohesion: 0.13
Nodes (24): createLiveTracker(), resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), DelegationContext, TEAM_TOOL_NAMES, col, DelegationFinish (+16 more)

### Community 178 - "agentRoleRuntime.integration.test.mjs"
Cohesion: 0.52
Nodes (6): agenteCom(), bancada(), comBusca(), contexto(), nomes(), rodar()

### Community 182 - "internalEventTrigger.integration.test.mjs"
Cohesion: 0.18
Nodes (9): ACAO_ANALISE, AGENT, BUILDING, FLOOR, INSTALACAO, K, specComSinal(), specDeMercado() (+1 more)

### Community 183 - "llm.ts"
Cohesion: 0.14
Nodes (22): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, getWidgetConfigAgent(), inboundMediaToText(), askAux(), auxiliaryModel(), checkGuardrail(), defaultModel() (+14 more)

### Community 184 - "systemPrompt.ts"
Cohesion: 0.10
Nodes (18): checkGuardrail(), checkGuardrail(), buildClarificationInstruction(), buildGuardrailCheckPrompt(), buildIdentityCaptureInstruction(), buildLanguageInstruction(), buildProactivityInstruction(), buildResponseStyleInstruction() (+10 more)

### Community 185 - "dependenciasDeclaradas.test.mjs"
Cohesion: 0.25
Nodes (4): declaradas, nativos, pkg, raiz

### Community 187 - "validateAgainstSchema"
Cohesion: 0.20
Nodes (17): checkStageOutput(), assertRegistryIsSound(), finishStep(), prepareStepInput(), primeiros(), checkJsonText(), JsonCheck, parseJsonText() (+9 more)

### Community 188 - "alpaca/adapter.ts"
Cohesion: 0.23
Nodes (17): reportActionDetail(), AlpacaContext, alpacaTools(), buildAlpacaTools(), clientOrderId(), conta(), Contador, num() (+9 more)

### Community 189 - "eventTrigger.ts"
Cohesion: 0.19
Nodes (19): StepCondition, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), marketTriggerOf(), updateEventTrigger(), aiStepPlanned() (+11 more)

### Community 190 - "planCompiler.test.mjs"
Cohesion: 0.29
Nodes (4): CHEFE, COLETOR, EQUIPE, RISCO

### Community 196 - "client.ts"
Cohesion: 0.14
Nodes (14): alpacaProbe(), AlpacaClient, AlpacaCredentials, AlpacaError, ClientDeps, comQuery(), createAlpacaClient(), DATA_BASE (+6 more)

### Community 197 - "building.ts"
Cohesion: 0.12
Nodes (19): Building, BuildingPatch, buildings, DEFAULT_TIMEZONE, LANGUAGES, updateBuilding(), buildings, canCommunicate() (+11 more)

### Community 199 - "policyEnforcement.integration.test.mjs"
Cohesion: 0.11
Nodes (5): AGENTE, CONEXAO, CRED, ordemPadrao, OUTRA_CONEXAO

### Community 201 - "agentEvents.ts"
Cohesion: 0.16
Nodes (13): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, events, finalizeAgentEvent(), finalizeAgentEventSafe() (+5 more)

### Community 203 - "connectionProfile.integration.test.mjs"
Cohesion: 0.40
Nodes (4): app(), conectar(), MANIFESTO, semConexao

### Community 204 - "webSearch/budget.ts"
Cohesion: 0.15
Nodes (15): agentSearchStats, BRAVE_FREE_MONTHLY_REQUESTS, ensureWebSearchIndexes(), eventos, ligado(), orcamento, releaseSearchRequest(), searchBudgetConfig (+7 more)

### Community 205 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 207 - "state.ts"
Cohesion: 0.17
Nodes (14): ingestQuote(), ingestTrade(), num(), parseQuoteEvent(), parseTradeEvent(), registerMarketDataHandlers(), estados, filtroDe() (+6 more)

### Community 208 - "policies/repository.ts"
Cohesion: 0.18
Nodes (12): limite(), LIMITES, listPolicies(), normalizeRules(), policies, policiesCollection, PolicyFieldError, policyHistory() (+4 more)

### Community 209 - "toolExecutor.ts"
Cohesion: 0.42
Nodes (8): comLimite(), escolherAcao(), executeAgentTool(), falha(), normalizar(), TIMEOUT_PADRAO_MS, traduzirExcecao(), getToolsByIds()

### Community 210 - "sources.ts"
Cohesion: 0.25
Nodes (12): clean(), decodeEntities(), parseRssItems(), pick(), pickLink(), stripCdata(), stripTags(), feedFromHtml() (+4 more)

### Community 211 - "alpaca/manifest.ts"
Cohesion: 0.17
Nodes (7): adapters, ALPACA_DOMAINS, manifest, numeroOuNulo, ORDEM_SCHEMA, VELA_SCHEMA, alpacaStreamAdapter

### Community 212 - "manager.ts"
Cohesion: 0.18
Nodes (12): HEARTBEAT_MS, MAX_TENTATIVAS, PROBE_MS, SILENCIO_MS, SocketFactory, Vivo, MAX_STREAMS_PER_OWNER, MAX_SYMBOLS_PER_STREAM (+4 more)

### Community 214 - "events/types.ts"
Cohesion: 0.10
Nodes (12): FEED, publishEvent(), EventStepError, publishFromStep(), PublishStepContext, EVENT_TYPES, EventStatus, EventType (+4 more)

### Community 215 - "executeSectorTeam"
Cohesion: 0.18
Nodes (14): emitAgentEvent(), executeSectorTeam(), participationTelemetry(), recordChildRun(), runWithRetry(), stageInstruction(), assembleWithoutModel(), dedupeAgainst() (+6 more)

### Community 216 - "connectionProfile.ts"
Cohesion: 0.24
Nodes (12): AMBIENTES_BLOQUEADOS, ConnectionProblem, ConnectionRefusal, interpolar(), joinPath(), resolveConnection(), ResolvedConnection, decryptInstallationConfig() (+4 more)

### Community 217 - "webSearch/provider.ts"
Cohesion: 0.23
Nodes (10): reserveSearchRequest(), activeSearchProvider(), BraveResposta, configuredProviderName(), providerBrave(), providerHttp(), resolveProviderName(), SearchBudgetError (+2 more)

### Community 219 - "fluxoCompleto.integration.test.mjs"
Cohesion: 0.15
Nodes (7): AGENTE, BUILDING, CRED, FLOOR, semRelogio, SocketFalso, T0

### Community 220 - "autoModel.ts"
Cohesion: 0.29
Nodes (7): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), auxModelFor()

### Community 221 - "streams/registry.ts"
Cohesion: 0.39
Nodes (6): streamableAppKeys(), adapters, clearStreamAdapters(), hasStreamAdapter(), registerStreamAdapter(), streamAdapters()

### Community 222 - "offices.ts"
Cohesion: 0.33
Nodes (4): createOffice(), ensureDefaultOffice(), Office, offices

### Community 224 - "actionEvents.ts"
Cohesion: 0.33
Nodes (5): ACTION_DETAIL_KEY, ActionOutcomeDetail, AppActionEvent, appActionEvents, detalhes

### Community 225 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

### Community 226 - "ticks.ts"
Cohesion: 0.80
Nodes (4): ensureTickCollection(), rawTickLimit(), rawTicksEnabled(), recordTick()

### Community 227 - "tokensByModel.integration.test.mjs"
Cohesion: 0.40
Nodes (3): AGENTE, ANDAR, ONTEM

## Knowledge Gaps
- **874 isolated node(s):** `raiz`, `dirTestes`, `LIMITE_MONGO`, `arquivos`, `comBanco` (+869 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **31 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ensureAgentWebKnowledgeFresh()` connect `webKnowledge.ts` to `automations/engine.ts`, `agentRoutineRoutes.ts`, `automations/service.ts`?**
  _High betweenness centrality (0.146) - this node is a cross-community bridge._
- **Why does `site()` connect `webKnowledge.ts` to `sourceTool.integration.test.mjs`?**
  _High betweenness centrality (0.145) - this node is a cross-community bridge._
- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **What connects `raiz`, `dirTestes`, `LIMITE_MONGO` to the rest of the system?**
  _874 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `installations.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.070578231292517 - nodes in this community are weakly interconnected._
- **Should `agentRoutineRoutes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13768115942028986 - nodes in this community are weakly interconnected._
- **Should `whatsapp.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1380952380952381 - nodes in this community are weakly interconnected._