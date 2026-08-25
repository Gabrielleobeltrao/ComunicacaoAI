# Graph Report - backend  (2026-08-25)

## Corpus Check
- 414 files · ~493,691 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3709 nodes · 8681 edges · 222 communities (189 shown, 33 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ff6d9f28`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- installations.ts
- websocketRoutes.ts
- agentRoutineRoutes.ts
- whatsapp.ts
- knowledge.ts
- voyage.ts
- src/index.ts
- openai.ts
- agents.ts
- grants.ts
- agentReadiness.ts
- refreshMemoryAndIdentity
- eventTrigger.ts
- agentLiveState.ts
- delegation.ts
- mongoServer.mjs
- AppDefinition
- googleCalendar.ts
- patterns.ts
- floorWork.ts
- guard.ts
- streams/service.ts
- dependencies
- agentEvents.ts
- sourceChange.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- privateApps.ts
- runRepository.ts
- migrate.ts
- claude.ts
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
- functionRegistry.ts
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
- webSearch/budget.ts
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
- sources.ts
- entrypointParity.test.mjs
- migration.ts
- modelDefaults.ts
- automations/service.ts
- Agent
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
- webSearch/provider.ts
- marketData/engine.ts
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
- src/config.ts
- ChatTurn
- sourceTool.integration.test.mjs
- timeoutCancellation.test.mjs
- run.ts
- widgetDestination.test.mjs
- socket.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- automations/types.ts
- audit.ts
- appRoutes.integration.test.mjs
- clarify.ts
- actionEvents.ts
- routineExecutorPaths.integration.test.mjs
- db.ts
- websocketIntegration.test.mjs
- executorRegressions.integration.test.mjs
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
- toolExecution.ts
- webSourcePolicy.test.mjs
- webKnowledge.integration.test.mjs
- agentRuntime.ts
- alpaca.test.mjs
- marketData.integration.test.mjs
- delegationWiring.ts
- agentRoleRuntime.integration.test.mjs
- executorDispatcher.test.mjs
- internalEventTrigger.integration.test.mjs
- llm.ts
- systemPrompt.ts
- dependenciasDeclaradas.test.mjs
- buildGuardrailCheckPrompt
- alpaca/adapter.ts
- websocket/config.ts
- planCompiler.test.mjs
- sourceSsrf.test.mjs
- client.ts
- building.ts
- policyEnforcement.integration.test.mjs
- executorHardening.test.mjs
- buildStageTransitionPrompt
- widgetRuntimeDestination.integration.test.mjs
- connectionProfile.integration.test.mjs
- official/index.ts
- migrationFixture.integration.test.mjs
- researcherWebResearch.integration.test.mjs
- state.ts
- policies/repository.ts
- modelCache.ts
- manager.ts
- tradingPolicy.test.mjs
- websocket/service.ts
- safeWebSocket.ts
- fluxoCompleto.integration.test.mjs
- toolsSecurity.test.mjs
- safeError.ts
- sectorBriefing.ts
- express
- nodemailer
- pdf-parse

## God Nodes (most connected - your core abstractions)
1. `startMongo()` - 71 edges
2. `stopMongo()` - 71 edges
3. `db` - 62 edges
4. `respondWithAgentIfLinked()` - 60 edges
5. `executeSectorTeam()` - 44 edges
6. `buildDeps()` - 43 edges
7. `getAgentById()` - 40 edges
8. `productionDelegationDeps()` - 33 edges
9. `validateAgainstSchema()` - 31 edges
10. `Agent` - 30 edges

## Surprising Connections (you probably didn't know these)
- `ensureAgentWebKnowledgeFresh()` --indirect_call--> `site()`  [INFERRED]
  src/webKnowledge.ts → test/sourceTool.integration.test.mjs
- `novoGerente()` --indirect_call--> `websocketAdapterFor()`  [INFERRED]
  test/websocketIntegration.test.mjs → src/integrations/websocket/service.ts
- `novoGerente()` --indirect_call--> `streamCredentials()`  [INFERRED]
  test/websocketIntegration.test.mjs → src/streams/service.ts
- `closeDueCandles()` --indirect_call--> `vela()`  [INFERRED]
  src/marketData/engine.ts → test/candleAnalyzer.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (222 total, 33 thin omitted)

### Community 0 - "installations.ts"
Cohesion: 0.07
Nodes (41): connectionProbeFor(), runProbe(), createInstallation(), CreateInstallationInput, deleteInstallation(), installationPublic(), installations, listInstallations() (+33 more)

### Community 1 - "websocketRoutes.ts"
Cohesion: 0.08
Nodes (32): WsFilter, ParsedMessage, deleteSubscription(), findSubscription(), insertSubscription(), listLogs(), listMessages(), listSubscriptions() (+24 more)

### Community 2 - "agentRoutineRoutes.ts"
Cohesion: 0.11
Nodes (41): ensureActivationMode(), EventTriggerError, EventTriggerSpec, MarketTriggerPlan, SignalPlan, webhookEndpoint(), AppActionPlan, MemoryPlan (+33 more)

### Community 3 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (57): chunks, chunkText(), combineKnowledgeHits(), countDocumentsFromSource(), countUnindexedFor(), createDocument(), createDocumentFor(), CreateDocumentInput (+49 more)

### Community 5 - "voyage.ts"
Cohesion: 0.06
Nodes (46): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, BudgetDenial (+38 more)

### Community 6 - "src/index.ts"
Cohesion: 0.03
Nodes (76): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), app, AVATAR_MIME_TYPES (+68 more)

### Community 7 - "openai.ts"
Cohesion: 0.18
Nodes (19): runResolvedTool(), extractIdentity(), extractStructuredOutput(), updateStructuredMemory(), askAux(), AUXILIARY_MODEL, buildClient(), DEFAULT_MODEL (+11 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (57): AgentRole, POR_PRESET, ROLE_LABEL, RoleCapabilities, roleOf(), RoleSection, RoleUIConfig, roleUIConfigOf() (+49 more)

### Community 9 - "grants.ts"
Cohesion: 0.14
Nodes (32): missingCapability(), recordActionEvent(), takeActionDetail(), AMBIENTES_BLOQUEADOS, ConnectionProblem, ConnectionRefusal, environmentOf(), interpolar() (+24 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (29): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+21 more)

### Community 11 - "refreshMemoryAndIdentity"
Cohesion: 0.11
Nodes (27): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+19 more)

### Community 12 - "eventTrigger.ts"
Cohesion: 0.18
Nodes (32): buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), emptyMarketPlan(), emptySignalPlan(), getEventTriggerForAgent(), isEventTrigger(), listEventTriggers() (+24 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.08
Nodes (32): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+24 more)

### Community 14 - "delegation.ts"
Cohesion: 0.07
Nodes (53): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, ClarificationRequest, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable() (+45 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.03
Nodes (36): FLOOR, PAGE, recebido, OPCOES, AGENTE, SETOR, ANDAR, PREDIO (+28 more)

### Community 16 - "AppDefinition"
Cohesion: 0.18
Nodes (12): adapters, ALPACA_DOMAINS, manifest, numeroOuNulo, ORDEM_SCHEMA, VELA_SCHEMA, alpacaStreamAdapter, native() (+4 more)

### Community 17 - "googleCalendar.ts"
Cohesion: 0.13
Nodes (21): adapters, manifest, buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), googleConfigured() (+13 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "floorWork.ts"
Cohesion: 0.33
Nodes (6): DELEGATION_MAX_DEPTH, agents, competencyOf(), effectiveTargets(), FloorTarget, sectors

### Community 20 - "guard.ts"
Cohesion: 0.14
Nodes (24): countActionsSince(), definido(), dinheiro(), evaluatePolicy(), localParts(), looksLikeOption(), minutesOfDay(), needsContext() (+16 more)

### Community 21 - "streams/service.ts"
Cohesion: 0.12
Nodes (31): streamRouter, streamableAppKeys(), adapters, clearStreamAdapters(), hasStreamAdapter(), registerStreamAdapter(), streamAdapters(), countStreams() (+23 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, cron-parser, dotenv, mongodb, multer, openai (+13 more)

### Community 23 - "agentEvents.ts"
Cohesion: 0.09
Nodes (26): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, events, finalizeAgentEvent(), finalizeAgentEventSafe() (+18 more)

### Community 24 - "sourceChange.ts"
Cohesion: 0.19
Nodes (21): RoutineSource, chaveDoItem(), contentHashOf(), detectHttpChange(), detectRssChange(), HttpChange, INITIAL_WINDOWS, InitialWindow (+13 more)

### Community 25 - "records.ts"
Cohesion: 0.07
Nodes (52): readPath(), clarificationKey(), ClarifyMemoryTarget, recallClarifications(), rememberClarification(), assertAgentMayWrite(), floors, MemoryAccessError (+44 more)

### Community 26 - "devDependencies"
Cohesion: 0.11
Nodes (19): mongodb-memory-server, devDependencies, mongodb-memory-server, tsx, @types/cors, @types/express, @types/multer, @types/node (+11 more)

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
Cohesion: 0.09
Nodes (30): describeManifestIssues(), exportableManifest(), archivePrivateApp(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listAppsForOwner() (+22 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.11
Nodes (26): findVersion(), artifacts, findRun(), insertRunIdempotent(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS (+18 more)

### Community 32 - "migrate.ts"
Cohesion: 0.11
Nodes (29): ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes(), ensureBuildingIndexes() (+21 more)

### Community 33 - "claude.ts"
Cohesion: 0.14
Nodes (20): MAX_TOOL_ITERATIONS, anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), DEFAULT_MODEL, FALLBACK_MODELS, generateAgentReply() (+12 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.10
Nodes (18): connections, deliveries, listDeliveries(), sentDeliveriesByAgent(), CONNECTION_CATALOG, createConnection(), CreateConnectionInput, isNonEmpty() (+10 more)

### Community 36 - "validate.ts"
Cohesion: 0.17
Nodes (21): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), StepCondition (+13 more)

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
Cohesion: 0.12
Nodes (20): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+12 more)

### Community 41 - "apps/types.ts"
Cohesion: 0.09
Nodes (30): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+22 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.11
Nodes (13): acaoDeCandles, AGENT, APP_EM_BREVE, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO (+5 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "functionRegistry.ts"
Cohesion: 0.05
Nodes (60): checkStageOutput(), conferirEntrada(), conferirSaida(), dispatchAgentExecution(), DispatchDeps, falha(), fromLlmResult(), LlmRunner (+52 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "bus.ts"
Cohesion: 0.09
Nodes (26): backoffMs(), claimNextEvent(), completeEvent(), deadLetter(), devolverHandler(), EVENT_LEASE_MS, EVENT_TTL_MS, EventHandler (+18 more)

### Community 47 - "routineExecution.ts"
Cohesion: 0.10
Nodes (31): RecordAgentEventInput, AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail() (+23 more)

### Community 48 - "builtinTools.ts"
Cohesion: 0.08
Nodes (27): adapters, manifest, adapters, manifest, adapters, manifest, adapters, manifest (+19 more)

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
Cohesion: 0.20
Nodes (5): contextOf(), naoLoga(), StreamManager, setStreamError(), setStreamState()

### Community 59 - "runner.ts"
Cohesion: 0.11
Nodes (23): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, MemoryOps, runDefinition(), RunnerDeps (+15 more)

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

### Community 75 - "webSearch/budget.ts"
Cohesion: 0.15
Nodes (15): agentSearchStats, BRAVE_FREE_MONTHLY_REQUESTS, ensureWebSearchIndexes(), eventos, ligado(), orcamento, releaseSearchRequest(), searchBudgetConfig (+7 more)

### Community 76 - "scheduler.ts"
Cohesion: 0.24
Nodes (12): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes(), planSchedules() (+4 more)

### Community 77 - "executionTrace.ts"
Cohesion: 0.15
Nodes (13): CHAVES_SEGURAS, ExecutionTraceEvent, onTraceEvent(), readTrace(), recorte(), sanitize(), Sink, traceEvent() (+5 more)

### Community 78 - "seedRestaurantDemo.ts"
Cohesion: 0.23
Nodes (13): createAgent(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member() (+5 more)

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.07
Nodes (65): emitAgentEvent(), executeSectorTeam(), participationTelemetry(), recordChildRun(), stageInstruction(), adaptLegacyPlan(), assembleWithoutModel(), buildSynthesisContext() (+57 more)

### Community 85 - "webKnowledge.ts"
Cohesion: 0.08
Nodes (40): WatchedSource, looksLikeContent(), urlsFromFeed(), urlsFromListing(), urlsFromSitemap(), agents, atualizarFonte(), Descoberta (+32 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.21
Nodes (14): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+6 more)

### Community 97 - "adaptiveWebReader.ts"
Cohesion: 0.10
Nodes (42): aindaEsperando(), anotarEspera(), buscarPadrao(), CABECALHOS, ehDocumentoXml(), emEspera, ExtractedLink, extrair() (+34 more)

### Community 98 - "floors.ts"
Cohesion: 0.14
Nodes (26): agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, ensureDefaultBuilding(), isValidTimezone(), collection, createFloor() (+18 more)

### Community 99 - "sources.ts"
Cohesion: 0.25
Nodes (12): clean(), decodeEntities(), parseRssItems(), pick(), pickLink(), stripCdata(), stripTags(), feedFromHtml() (+4 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "migration.ts"
Cohesion: 0.12
Nodes (28): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+20 more)

### Community 102 - "modelDefaults.ts"
Cohesion: 0.29
Nodes (5): ANTHROPIC_AUX_MODEL, ANTHROPIC_DEFAULT_MODEL, auxModelOf(), OPENAI_AUX_MODEL, OPENAI_DEFAULT_MODEL

### Community 103 - "automations/service.ts"
Cohesion: 0.12
Nodes (31): getAgentById(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), defaultDefinition(), getAutomation() (+23 more)

### Community 104 - "Agent"
Cohesion: 0.11
Nodes (29): Agent, AgentModelFields, parseAgentModelFields(), AgentContract, AgentContractInput, agentContractOf(), contractFromFunction(), ContractParseResult (+21 more)

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
Cohesion: 0.06
Nodes (54): listAgents(), resolveOwnedAgentId(), resolveOwnedSectorId(), resolverDestinoDoWidget(), serializeSector(), requireSector(), accessConfigOf(), accessImpact (+46 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "browserRenderer.ts"
Cohesion: 0.15
Nodes (16): BrowserRenderer, ReaderPage, abrirNavegador(), browserRendererEnabled(), esperarVaga(), fila, liberarVaga(), rendererAtivo() (+8 more)

### Community 120 - "webSearch/provider.ts"
Cohesion: 0.26
Nodes (9): reserveSearchRequest(), activeSearchProvider(), BraveResposta, configuredProviderName(), providerBrave(), providerHttp(), resolveProviderName(), SearchBudgetError (+1 more)

### Community 121 - "marketData/engine.ts"
Cohesion: 0.11
Nodes (36): DispatchDeps, ajustarPontas(), CANDLE_RETENTION_DAYS, candles, candlesCollection, chave(), closeCandle(), closedSeries() (+28 more)

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
Cohesion: 0.13
Nodes (22): CANDLE_SWEEP_MS, CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, EVENT_BATCH, EVENT_POLL_MS (+14 more)

### Community 131 - "sourceCheckpoint.integration.test.mjs"
Cohesion: 0.25
Nodes (5): agora, AUTOMACAO, FONTE, OUTRA_FONTE, QUANDO

### Community 132 - "src/config.ts"
Cohesion: 0.32
Nodes (7): clientUrl, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig()

### Community 133 - "ChatTurn"
Cohesion: 0.27
Nodes (9): cache, chaveDe(), Entrada, normalizar(), rememberedScope(), rememberScope(), checkScope(), ScopeVerdict (+1 more)

### Community 134 - "sourceTool.integration.test.mjs"
Cohesion: 0.20
Nodes (7): AGENTE, agenteFalso, ANDAR, FEED(), itensDoFeed, servidor, site()

### Community 135 - "timeoutCancellation.test.mjs"
Cohesion: 0.40
Nodes (4): AnthropicFalso, comportamento, contadora(), espera()

### Community 137 - "run.ts"
Cohesion: 0.14
Nodes (24): naoVencido(), searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData(), extractTerms(), extractWindow() (+16 more)

### Community 140 - "socket.ts"
Cohesion: 0.25
Nodes (6): StreamSocket, createRealSocket(), HANDSHAKE_TIMEOUT_MS, SocketOptions, ligar(), novoGerente()

### Community 146 - "automations/types.ts"
Cohesion: 0.07
Nodes (33): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, CreateAutomationInput (+25 more)

### Community 147 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 150 - "clarify.ts"
Cohesion: 0.27
Nodes (8): clarificationFrom(), CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarificationGuidance(), CLARIFY_LIMIT, clarifyBudgetSpent()

### Community 151 - "actionEvents.ts"
Cohesion: 0.29
Nodes (6): ACTION_DETAIL_KEY, ActionOutcomeDetail, AppActionEvent, appActionEvents, detalhes, ensureAppActionIndexes()

### Community 152 - "routineExecutorPaths.integration.test.mjs"
Cohesion: 0.29
Nodes (4): agente(), ANDAR, DE_FUNCAO(), PREDIO

### Community 153 - "db.ts"
Cohesion: 0.14
Nodes (13): auth, config, db, mongoClient, AgentDoc, aggregateSectorDecisions(), listSectorDecisionsForConversation(), SectorDecision (+5 more)

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.22
Nodes (7): ANALISTA, COLETOR, COZINHA, EQUIPE, FINANCEIRO, JURIDICO, TIME

### Community 159 - "streamManager.integration.test.mjs"
Cohesion: 0.13
Nodes (10): ADAPTER, app(), conectar(), gerente(), MANIFESTO, publicados, publicarFalso(), relogioFalso() (+2 more)

### Community 160 - "runProcessor.ts"
Cohesion: 0.13
Nodes (31): runEventKey(), createLiveTracker(), findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor() (+23 more)

### Community 161 - "sourceCheckpoint.ts"
Cohesion: 0.14
Nodes (18): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), normalizeSourceUrl(), sourceFingerprint(), acquireSourceLease() (+10 more)

### Community 162 - "step.ts"
Cohesion: 0.18
Nodes (17): recordSearchEvent(), AGORA, limitar(), normalizeWebSearch(), respondeAoValorPedido(), SearchDecision, semAcento(), shouldSearch() (+9 more)

### Community 165 - "executionCenter.ts"
Cohesion: 0.07
Nodes (49): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+41 more)

### Community 166 - "internalEvents.ts"
Cohesion: 0.16
Nodes (21): asString(), buildTriggerInput(), chainOf(), DEFAULT_SERIES_LENGTH, dispatchInternalEvent(), internalTriggerOf(), matchesInternalTrigger(), MAX_EVENT_CHAIN (+13 more)

### Community 169 - "toolExecution.ts"
Cohesion: 0.15
Nodes (16): joinPath(), ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets() (+8 more)

### Community 171 - "webKnowledge.integration.test.mjs"
Cohesion: 0.13
Nodes (23): agente(), ANDAR, CALCULADORA(), COLETOR(), ctx(), deps(), doTipo(), eventos() (+15 more)

### Community 172 - "agentRuntime.ts"
Cohesion: 0.05
Nodes (60): AgentDefinition, composeAgentPrompt(), definitionOf(), enforceOutputContract(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache() (+52 more)

### Community 177 - "delegationWiring.ts"
Cohesion: 0.09
Nodes (36): capabilitiesOf(), recordAgentEvent(), recordAgentEventSafe(), resolveAgentTools(), formatOptions(), resolveChoice(), semAcento(), agentCanDelegate() (+28 more)

### Community 178 - "agentRoleRuntime.integration.test.mjs"
Cohesion: 0.52
Nodes (6): agenteCom(), bancada(), comBusca(), contexto(), nomes(), rodar()

### Community 182 - "internalEventTrigger.integration.test.mjs"
Cohesion: 0.18
Nodes (9): ACAO_ANALISE, AGENT, BUILDING, FLOOR, INSTALACAO, K, specComSinal(), specDeMercado() (+1 more)

### Community 183 - "llm.ts"
Cohesion: 0.10
Nodes (28): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, askAux(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput() (+20 more)

### Community 184 - "systemPrompt.ts"
Cohesion: 0.14
Nodes (12): buildSystemPrompt(), buildSystemPromptParts(), DETAIL_INSTRUCTIONS, GUARDRAIL_CHECK_SYSTEM_PROMPT, GUARDRAIL_REFUSAL_MESSAGE, GUARDRAIL_SCOPE_INSTRUCTION, HANDOFF_INSTRUCTION, HANDOFF_MARKER (+4 more)

### Community 185 - "dependenciasDeclaradas.test.mjs"
Cohesion: 0.25
Nodes (4): declaradas, nativos, pkg, raiz

### Community 187 - "buildGuardrailCheckPrompt"
Cohesion: 0.67
Nodes (4): checkGuardrail(), checkGuardrail(), buildGuardrailCheckPrompt(), parseInScopeResult()

### Community 188 - "alpaca/adapter.ts"
Cohesion: 0.23
Nodes (17): reportActionDetail(), AlpacaContext, alpacaTools(), buildAlpacaTools(), clientOrderId(), conta(), Contador, num() (+9 more)

### Community 189 - "websocket/config.ts"
Cohesion: 0.16
Nodes (15): buildWebSocketAdapter(), WEBSOCKET_EVENT, WsFrames, WsIngest, connectionConfigPublic(), fillToken(), mensagem(), normalizeConnectionConfig() (+7 more)

### Community 190 - "planCompiler.test.mjs"
Cohesion: 0.29
Nodes (4): CHEFE, COLETOR, EQUIPE, RISCO

### Community 196 - "client.ts"
Cohesion: 0.10
Nodes (18): ConnectionProbe, PROBE_TIMEOUT_MS, probes, registerConnectionProbe(), alpacaProbe(), AlpacaClient, AlpacaCredentials, AlpacaError (+10 more)

### Community 197 - "building.ts"
Cohesion: 0.12
Nodes (19): Building, BuildingPatch, buildings, DEFAULT_TIMEZONE, LANGUAGES, updateBuilding(), buildings, canCommunicate() (+11 more)

### Community 199 - "policyEnforcement.integration.test.mjs"
Cohesion: 0.11
Nodes (5): AGENTE, CONEXAO, CRED, ordemPadrao, OUTRA_CONEXAO

### Community 201 - "buildStageTransitionPrompt"
Cohesion: 0.67
Nodes (4): planStageTransition(), planStageTransition(), buildStageTransitionPrompt(), parseStageTransition()

### Community 203 - "connectionProfile.integration.test.mjs"
Cohesion: 0.40
Nodes (4): app(), conectar(), MANIFESTO, semConexao

### Community 204 - "official/index.ts"
Cohesion: 0.11
Nodes (10): manifest, MODULES, OFFICIAL_ADAPTERS, OFFICIAL_APPS, OfficialAppsError, OfficialModule, manifest, manifest (+2 more)

### Community 205 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 207 - "state.ts"
Cohesion: 0.13
Nodes (20): SeriesKey, estados, filtroDe(), guardar(), marketStateCollection, readState(), rememberQuote(), rememberTrade() (+12 more)

### Community 208 - "policies/repository.ts"
Cohesion: 0.18
Nodes (13): activePolicyFor(), limite(), LIMITES, listPolicies(), normalizeRules(), policies, policiesCollection, PolicyFieldError (+5 more)

### Community 210 - "modelCache.ts"
Cohesion: 0.29
Nodes (9): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), humanizeModelId(), isChatModel() (+1 more)

### Community 212 - "manager.ts"
Cohesion: 0.07
Nodes (18): FEED, PublishInput, HEARTBEAT_MS, ManagerDeps, MAX_INTERVAL_MS, MAX_TENTATIVAS, PROBE_MS, SILENCIO_MS (+10 more)

### Community 214 - "websocket/service.ts"
Cohesion: 0.14
Nodes (28): readAt(), WsConnectionConfig, asTexto(), camposDoErro(), dataDe(), dedupeKeyOf(), janelas, matchesFilters() (+20 more)

### Community 215 - "safeWebSocket.ts"
Cohesion: 0.31
Nodes (9): isPrivateIp(), assertPublicWebSocketUrl(), CheckedTarget, checkWebSocketUrl(), ehLoopback(), emProducao(), HOSTS_PROIBIDOS, loopbackLiberado() (+1 more)

### Community 219 - "fluxoCompleto.integration.test.mjs"
Cohesion: 0.15
Nodes (7): AGENTE, BUILDING, CRED, FLOOR, semRelogio, SocketFalso, T0

### Community 224 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 225 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

## Knowledge Gaps
- **899 isolated node(s):** `WEBSOCKET_EVENT`, `WsIngest`, `WsFrames`, `TEST_TIMEOUT_MS`, `WsDestinationKind` (+894 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **33 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `novoGerente()` connect `socket.ts` to `grants.ts`, `websocketIntegration.test.mjs`, `websocket/service.ts`, `streamManager.integration.test.mjs`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `ensureAgentWebKnowledgeFresh()` connect `automations/service.ts` to `automations/engine.ts`, `agentRoutineRoutes.ts`, `sourceTool.integration.test.mjs`, `delegationWiring.ts`, `webKnowledge.ts`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `sourceCheckpoint.integration.test.mjs`, `sourceTool.integration.test.mjs`, `appRoutes.integration.test.mjs`, `routineExecutorPaths.integration.test.mjs`, `websocketIntegration.test.mjs`, `executorRegressions.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `streamManager.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `publicWidgetRoutes.integration.test.mjs`, `executionModes.integration.test.mjs`, `webKnowledge.integration.test.mjs`, `marketData.integration.test.mjs`, `agentRoleRuntime.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `internalEventTrigger.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `memoryStore.integration.test.mjs`, `policyEnforcement.integration.test.mjs`, `widgetRuntimeDestination.integration.test.mjs`, `connectionProfile.integration.test.mjs`, `migrationFixture.integration.test.mjs`, `researcherWebResearch.integration.test.mjs`, `fluxoCompleto.integration.test.mjs`, `toolsSecurity.test.mjs`, `agentLiveState.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sourceStaleRun.integration.test.mjs`, `planExecutionE2E.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `interactiveRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `floorWork.integration.test.mjs`, `gateWiring.integration.test.mjs`, `sectorTeam.integration.test.mjs`, `channelApps.integration.test.mjs`, `channelOverview.integration.test.mjs`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **What connects `WEBSOCKET_EVENT`, `WsIngest`, `WsFrames` to the rest of the system?**
  _899 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `installations.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07183673469387755 - nodes in this community are weakly interconnected._
- **Should `websocketRoutes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07823613086770982 - nodes in this community are weakly interconnected._
- **Should `agentRoutineRoutes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1109936575052854 - nodes in this community are weakly interconnected._