# Graph Report - backend  (2026-08-25)

## Corpus Check
- 367 files · ~437,118 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3267 nodes · 7554 edges · 204 communities (173 shown, 31 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 58 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `75aad690`
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
- claude.ts
- agents.ts
- grants.ts
- agentReadiness.ts
- respondWithAgentIfLinked
- routine.ts
- agentLiveState.ts
- delegation.ts
- mongoServer.mjs
- apps/types.ts
- googleCalendar.ts
- patterns.ts
- building.ts
- connections/service.ts
- streams/service.ts
- dependencies
- agentMetrics.ts
- agentEvents.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- getSectorById
- runRepository.ts
- migrate.ts
- openai.ts
- sourceMonitoring.test.mjs
- runProcessor.ts
- validate.ts
- llmFake.ts
- tools.ts
- eventTrigger.integration.test.mjs
- executionRoots.ts
- widgets.ts
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
- executorRegressions.integration.test.mjs
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
- autoModel.ts
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
- toolExecution.ts
- db.ts
- sectorAccess.integration.test.mjs
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
- run.ts
- widgetDestination.test.mjs
- runner.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- automations/repository.ts
- audit.ts
- appRoutes.integration.test.mjs
- clarify.ts
- googleTools.ts
- routineExecutorPaths.integration.test.mjs
- config.ts
- appGrantRoutes.ts
- manager.ts
- sectorPlanner.test.mjs
- scopeGate.test.mjs
- streamManager.integration.test.mjs
- official/index.ts
- safeError.ts
- webSearch/budget.ts
- adaptiveWebReader.test.mjs
- executionCenter.ts
- hardening.integration.test.mjs
- publicWidgetRoutes.integration.test.mjs
- toolsSecurity.test.mjs
- webSourcePolicy.test.mjs
- webKnowledge.integration.test.mjs
- agentTools.ts
- browserRenderer.ts
- executorAudit.integration.test.mjs
- delegationWiring.ts
- agentRoleRuntime.integration.test.mjs
- executorDispatcher.test.mjs
- agentCapabilities.ts
- llm.ts
- conversationTurns.ts
- dependenciasDeclaradas.test.mjs
- sectorBriefing.ts
- agentRuntime.ts
- executorIntegrationGaps.integration.test.mjs
- planCompiler.test.mjs
- sourceSsrf.test.mjs
- modelDefaults.ts
- floorWork.ts
- knowledgeIsolation.integration.test.mjs
- executorHardening.test.mjs
- scheduler.integration.test.mjs
- webSearchAllPaths.integration.test.mjs
- connectionProfile.integration.test.mjs

## God Nodes (most connected - your core abstractions)
1. `startMongo()` - 64 edges
2. `stopMongo()` - 64 edges
3. `respondWithAgentIfLinked()` - 60 edges
4. `db` - 56 edges
5. `executeSectorTeam()` - 44 edges
6. `buildDeps()` - 40 edges
7. `getAgentById()` - 36 edges
8. `productionDelegationDeps()` - 33 edges
9. `Agent` - 30 edges
10. `validateAgainstSchema()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `ensureAgentWebKnowledgeFresh()` --indirect_call--> `site()`  [INFERRED]
  src/webKnowledge.ts → test/sourceTool.integration.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `resolveSectorMembers()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts
- `resolveSectorTeamFields()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (204 total, 31 thin omitted)

### Community 0 - "installations.ts"
Cohesion: 0.08
Nodes (37): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installationPublic(), installations, LEGACY_APP_VERSION, listInstallations() (+29 more)

### Community 1 - "sourceChange.ts"
Cohesion: 0.08
Nodes (52): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), listRoutines(), readSourceFromDefinition(), RoutineSource (+44 more)

### Community 2 - "agentRoutineRoutes.ts"
Cohesion: 0.12
Nodes (22): EventTriggerError, normalizeCondition(), webhookEndpoint(), getRoutineForAgent(), listAgentAutomations(), RoutineError, STEP_SOURCE, cronToRecurrence() (+14 more)

### Community 3 - "whatsapp.ts"
Cohesion: 0.14
Nodes (18): ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter(), InboundMediaRef, InboundMessage (+10 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (56): chunks, chunkText(), combineKnowledgeHits(), countDocumentsFromSource(), countUnindexedFor(), createDocument(), createDocumentFor(), CreateDocumentInput (+48 more)

### Community 5 - "voyage.ts"
Cohesion: 0.07
Nodes (38): BudgetDenial, BudgetDoc, dia(), embeddingBudgetConfig, EmbeddingUsageEvent, embeddingUsageReport, ensureEmbeddingUsageIndexes(), estimateTokens() (+30 more)

### Community 6 - "src/index.ts"
Cohesion: 0.03
Nodes (58): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), clarificationGuidance(), CLARIFY_LIMIT, aplicarContratoDeFerramenta() (+50 more)

### Community 7 - "claude.ts"
Cohesion: 0.09
Nodes (38): runResolvedTool(), anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL, extractIdentity() (+30 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (50): roleUIConfigOf(), sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, agents, AgentSourceSettings, AgentTool, AgentToolHeader (+42 more)

### Community 9 - "grants.ts"
Cohesion: 0.08
Nodes (47): missingCapability(), AMBIENTES_BLOQUEADOS, ConnectionProblem, ConnectionRefusal, environmentOf(), interpolar(), resolveConnection(), ResolvedConnection (+39 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (29): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+21 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.08
Nodes (38): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+30 more)

### Community 12 - "routine.ts"
Cohesion: 0.16
Nodes (42): StepCondition, buildEventTriggerDefinition(), describeEventTriggerFlow(), EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), readEventTriggerConfig() (+34 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.09
Nodes (30): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+22 more)

### Community 14 - "delegation.ts"
Cohesion: 0.06
Nodes (60): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, Agent, ClarificationRequest, checkCollaboration(), CollaborationDecision, CollaborationDenyCode (+52 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.03
Nodes (31): FLOOR, PAGE, recebido, OPCOES, AGENTE, SETOR, CRIADORES, ANDAR (+23 more)

### Community 16 - "apps/types.ts"
Cohesion: 0.10
Nodes (27): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+19 more)

### Community 17 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (14): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse, deleteIntegration() (+6 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "building.ts"
Cohesion: 0.12
Nodes (18): Building, BuildingPatch, buildings, DEFAULT_TIMEZONE, LANGUAGES, updateBuilding(), buildings, canCommunicate() (+10 more)

### Community 20 - "connections/service.ts"
Cohesion: 0.10
Nodes (18): connections, deliveries, listDeliveries(), sentDeliveriesByAgent(), CONNECTION_CATALOG, createConnection(), CreateConnectionInput, isNonEmpty() (+10 more)

### Community 21 - "streams/service.ts"
Cohesion: 0.12
Nodes (23): streamRouter, countStreams(), findStream(), listResumableStreams(), listStreams(), listStreamsForInstallation(), markStreamEvent(), setStreamPaused() (+15 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "agentEvents.ts"
Cohesion: 0.22
Nodes (9): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow (+1 more)

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

### Community 30 - "getSectorById"
Cohesion: 0.16
Nodes (17): listAgents(), bloqueiaSePrejudicaWidget(), resolveOwnedAgentId(), resolveOwnedSectorId(), resolverDestinoDoWidget(), getSectorById(), sectorReadiness, SectorReadinessInput (+9 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.12
Nodes (25): findVersion(), artifacts, findRun(), insertRunIdempotent(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS (+17 more)

### Community 32 - "migrate.ts"
Cohesion: 0.17
Nodes (22): ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes() (+14 more)

### Community 33 - "openai.ts"
Cohesion: 0.12
Nodes (27): listAvailableModels(), TokenUsage, cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), askAux() (+19 more)

### Community 35 - "runProcessor.ts"
Cohesion: 0.13
Nodes (30): runEventKey(), createLiveTracker(), findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor() (+22 more)

### Community 36 - "validate.ts"
Cohesion: 0.19
Nodes (19): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), canonical() (+11 more)

### Community 37 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

### Community 38 - "tools.ts"
Cohesion: 0.09
Nodes (22): clamp(), createTool(), deleteTool(), getTool(), headersDe(), listTools(), normalize(), TOOL_AUTH_KINDS (+14 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.09
Nodes (25): EXECUTION_TABS, ExecutionTab, AnalyticsPeriod, analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow (+17 more)

### Community 41 - "widgets.ts"
Cohesion: 0.07
Nodes (31): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "dispatcher.ts"
Cohesion: 0.08
Nodes (47): checkStageOutput(), conferirEntrada(), conferirSaida(), dispatchAgentExecution(), DispatchDeps, falha(), fromLlmResult(), LlmRunner (+39 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "bus.ts"
Cohesion: 0.10
Nodes (21): backoffMs(), claimNextEvent(), completeEvent(), deadLetter(), EVENT_LEASE_MS, EVENT_TTL_MS, EventHandler, events (+13 more)

### Community 47 - "routineExecution.ts"
Cohesion: 0.12
Nodes (25): RecordAgentEventInput, AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail() (+17 more)

### Community 48 - "builtinTools.ts"
Cohesion: 0.14
Nodes (19): capabilitiesOf(), joinPath(), resolveAppGrantTools(), APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog() (+11 more)

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
Cohesion: 0.22
Nodes (5): naoLoga(), StreamManager, StreamSocket, setStreamError(), setStreamState()

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

### Community 77 - "autoModel.ts"
Cohesion: 0.29
Nodes (7): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), auxModelFor()

### Community 78 - "seedRestaurantDemo.ts"
Cohesion: 0.23
Nodes (13): createAgent(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member() (+5 more)

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.07
Nodes (63): executeSectorTeam(), stageInstruction(), normalize(), adaptLegacyPlan(), assembleWithoutModel(), buildSynthesisContext(), clarificationFor(), CompiledPlan (+55 more)

### Community 85 - "webKnowledge.ts"
Cohesion: 0.06
Nodes (50): ReadMode, WatchedSource, browserRendererEnabled(), rendererAtivo(), feedFromHtml(), looksLikeContent(), DiscoveryPlan, DiscoveryProbe (+42 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.21
Nodes (14): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+6 more)

### Community 97 - "adaptiveWebReader.ts"
Cohesion: 0.11
Nodes (37): aindaEsperando(), anotarEspera(), CABECALHOS, ehDocumentoXml(), emEspera, ExtractedLink, extrair(), falha() (+29 more)

### Community 98 - "floors.ts"
Cohesion: 0.13
Nodes (27): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, ensureDefaultBuilding(), isValidTimezone() (+19 more)

### Community 99 - "functionRegistry.ts"
Cohesion: 0.09
Nodes (12): adaptadores, CONFIG_CASAS, DOC_SAIDA, findAdapterFor(), FunctionAdapter, FunctionHandler, listPublicFunctions(), NUMEROS_SCHEMA (+4 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "migration.ts"
Cohesion: 0.13
Nodes (28): AgentBuiltinTool, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation(), ensureGoogleInstallations() (+20 more)

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
Cohesion: 0.20
Nodes (16): dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce(), settlePendingCharges() (+8 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "sectorExecutions.ts"
Cohesion: 0.12
Nodes (22): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listaDe() (+14 more)

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
Nodes (25): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+17 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "toolExecution.ts"
Cohesion: 0.18
Nodes (14): buscarPadrao(), resolveHttpTool(), decrypt(), getKey(), safeFetch(), executeToolCall(), ExecuteToolOptions, fillTemplate() (+6 more)

### Community 120 - "db.ts"
Cohesion: 0.12
Nodes (13): auth, db, mongoClient, createOffice(), ensureDefaultOffice(), Office, offices, AgentDoc (+5 more)

### Community 121 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

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
Cohesion: 0.10
Nodes (26): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, EVENT_BATCH, EVENT_POLL_MS, LEASE_RENEW_MS (+18 more)

### Community 131 - "sourceCheckpoint.integration.test.mjs"
Cohesion: 0.25
Nodes (5): agora, AUTOMACAO, FONTE, OUTRA_FONTE, QUANDO

### Community 133 - "scopeCache.ts"
Cohesion: 0.31
Nodes (8): cache, chaveDe(), Entrada, normalizar(), rememberedScope(), rememberScope(), checkScope(), ScopeVerdict

### Community 134 - "sourceTool.integration.test.mjs"
Cohesion: 0.20
Nodes (7): AGENTE, agenteFalso, ANDAR, FEED(), itensDoFeed, servidor, site()

### Community 135 - "timeoutCancellation.test.mjs"
Cohesion: 0.40
Nodes (4): AnthropicFalso, comportamento, contadora(), espera()

### Community 137 - "run.ts"
Cohesion: 0.12
Nodes (25): ReadResult, naoVencido(), searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData(), extractTerms() (+17 more)

### Community 140 - "runner.ts"
Cohesion: 0.07
Nodes (32): AgentCall, delay(), DeliverCall, FetchResult, MemoryOps, runDefinition(), RunnerDeps, RunOutcome (+24 more)

### Community 146 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+4 more)

### Community 147 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 150 - "clarify.ts"
Cohesion: 0.38
Nodes (6): clarificationFrom(), CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarifyBudgetSpent()

### Community 151 - "googleTools.ts"
Cohesion: 0.50
Nodes (5): getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 152 - "routineExecutorPaths.integration.test.mjs"
Cohesion: 0.29
Nodes (4): agente(), ANDAR, DE_FUNCAO(), PREDIO

### Community 153 - "config.ts"
Cohesion: 0.32
Nodes (7): clientUrl, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig()

### Community 155 - "appGrantRoutes.ts"
Cohesion: 0.15
Nodes (12): AgentAppGrant, ValidationError, appGrantRouter, auditEntity(), automationRouter, connectionRouter, parseFilters(), fail() (+4 more)

### Community 156 - "manager.ts"
Cohesion: 0.13
Nodes (11): publishEvent(), HEARTBEAT_MS, ManagerDeps, MAX_TENTATIVAS, SILENCIO_MS, SocketFactory, Vivo, StreamAdapter (+3 more)

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.22
Nodes (7): ANALISTA, COLETOR, COZINHA, EQUIPE, FINANCEIRO, JURIDICO, TIME

### Community 159 - "streamManager.integration.test.mjs"
Cohesion: 0.14
Nodes (10): ADAPTER, app(), conectar(), gerente(), MANIFESTO, publicados, publicarFalso(), relogioFalso() (+2 more)

### Community 160 - "official/index.ts"
Cohesion: 0.06
Nodes (36): manifest, adapters, manifest, adapters, manifest, MODULES, OFFICIAL_ADAPTERS, OfficialAppsError (+28 more)

### Community 161 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 162 - "webSearch/budget.ts"
Cohesion: 0.05
Nodes (54): CHAVES_SEGURAS, ExecutionTraceEvent, onTraceEvent(), readTrace(), recorte(), sanitize(), Sink, traceEvent() (+46 more)

### Community 165 - "executionCenter.ts"
Cohesion: 0.09
Nodes (44): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+36 more)

### Community 171 - "webKnowledge.integration.test.mjs"
Cohesion: 0.23
Nodes (12): agenteComSite(), artigosNoFeed, comBootstrap(), comFeed(), criarAgente(), depsDoRuntime(), pedidos, rodar() (+4 more)

### Community 172 - "agentTools.ts"
Cohesion: 0.14
Nodes (18): enforceOutputContract(), AgentRunError, legacyToolToExecutable(), MAX_TOOL_ITERATIONS, ToolCallRecord, toolInputSchema(), comPrazo(), describeDropped() (+10 more)

### Community 174 - "browserRenderer.ts"
Cohesion: 0.18
Nodes (14): BrowserRenderer, ReaderPage, abrirNavegador(), esperarVaga(), fila, liberarVaga(), renderWithBrowser(), assertPublicUrl() (+6 more)

### Community 175 - "executorAudit.integration.test.mjs"
Cohesion: 0.30
Nodes (11): agente(), ANDAR, CALCULADORA(), COLETOR(), ctx(), deps(), doTipo(), eventos() (+3 more)

### Community 177 - "delegationWiring.ts"
Cohesion: 0.08
Nodes (39): recordAgentEvent(), recordAgentEventSafe(), agentCanDelegate(), capabilityMissingTool(), col, DelegationFinish, DelegationRecord, DelegationStart (+31 more)

### Community 178 - "agentRoleRuntime.integration.test.mjs"
Cohesion: 0.52
Nodes (6): agenteCom(), bancada(), comBusca(), contexto(), nomes(), rodar()

### Community 182 - "agentCapabilities.ts"
Cohesion: 0.22
Nodes (8): AgentRole, POR_PRESET, ROLE_LABEL, RoleCapabilities, roleOf(), RoleSection, RoleUIConfig, SECOES

### Community 183 - "llm.ts"
Cohesion: 0.16
Nodes (20): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, askAux(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput() (+12 more)

### Community 184 - "conversationTurns.ts"
Cohesion: 0.28
Nodes (8): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText()

### Community 185 - "dependenciasDeclaradas.test.mjs"
Cohesion: 0.25
Nodes (4): declaradas, nativos, pkg, raiz

### Community 187 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

### Community 188 - "agentRuntime.ts"
Cohesion: 0.27
Nodes (11): AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask(), inputToText(), parseJsonOutput() (+3 more)

### Community 190 - "planCompiler.test.mjs"
Cohesion: 0.29
Nodes (4): CHEFE, COLETOR, EQUIPE, RISCO

### Community 196 - "modelDefaults.ts"
Cohesion: 0.33
Nodes (4): ANTHROPIC_AUX_MODEL, ANTHROPIC_DEFAULT_MODEL, OPENAI_AUX_MODEL, OPENAI_DEFAULT_MODEL

### Community 197 - "floorWork.ts"
Cohesion: 0.33
Nodes (6): DELEGATION_MAX_DEPTH, agents, competencyOf(), effectiveTargets(), FloorTarget, sectors

### Community 207 - "connectionProfile.integration.test.mjs"
Cohesion: 0.40
Nodes (4): app(), conectar(), MANIFESTO, semConexao

## Knowledge Gaps
- **807 isolated node(s):** `ConnectionProblem`, `ResolvedConnection`, `ConnectionRefusal`, `AMBIENTES_BLOQUEADOS`, `RUN_POLL_MS` (+802 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **31 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ensureAgentWebKnowledgeFresh()` connect `webKnowledge.ts` to `delegationWiring.ts`, `agentRoutineRoutes.ts`, `sourceTool.integration.test.mjs`, `automations/service.ts`?**
  _High betweenness centrality (0.125) - this node is a cross-community bridge._
- **Why does `site()` connect `sourceTool.integration.test.mjs` to `webKnowledge.ts`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **What connects `ConnectionProblem`, `ResolvedConnection`, `ConnectionRefusal` to the rest of the system?**
  _807 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `installations.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08383838383838384 - nodes in this community are weakly interconnected._
- **Should `sourceChange.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08065458796025717 - nodes in this community are weakly interconnected._
- **Should `agentRoutineRoutes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12318840579710146 - nodes in this community are weakly interconnected._