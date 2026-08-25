# Graph Report - backend  (2026-08-25)

## Corpus Check
- 411 files · ~488,270 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3681 nodes · 8571 edges · 239 communities (204 shown, 35 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 80 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5d0f4fef`
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
- routine.ts
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
- connections/repository.ts
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
- providerApps.ts
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
- collaborationGate.ts
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
- getSectorById
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
- appGrantRoutes.ts
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
- connections/service.ts
- routineExecutorPaths.integration.test.mjs
- db.ts
- sectorDecisions.ts
- candleStore.ts
- sectorPlanner.test.mjs
- scopeGate.test.mjs
- streamManager.integration.test.mjs
- runProcessor.ts
- sourceCheckpoint.ts
- webSearch/budget.ts
- adaptiveWebReader.test.mjs
- executionCenter.ts
- internalEvents.ts
- publicWidgetRoutes.integration.test.mjs
- builtinTools.ts
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
- websocket/config.ts
- planCompiler.test.mjs
- sourceSsrf.test.mjs
- client.ts
- building.ts
- policyEnforcement.integration.test.mjs
- executorHardening.test.mjs
- agentEvents.ts
- hardening.integration.test.mjs
- connectionProfile.integration.test.mjs
- official/index.ts
- migrationFixture.integration.test.mjs
- researcherWebResearch.integration.test.mjs
- state.ts
- policies/repository.ts
- apps/manifest.ts
- modelCache.ts
- alpaca/manifest.ts
- manager.ts
- tradingPolicy.test.mjs
- websocket/service.ts
- safeWebSocket.ts
- conversationTurns.ts
- delegationLog.ts
- destinations.ts
- fluxoCompleto.integration.test.mjs
- autoModel.ts
- stream.ts
- connectionTests.ts
- toolsSecurity.test.mjs
- safeError.ts
- sectorBriefing.ts
- sectorAccess.integration.test.mjs
- tokensByModel.integration.test.mjs
- mercado-pago/adapter.ts
- stripe/adapter.ts
- scheduler.integration.test.mjs
- email/manifest.ts
- web-chat/manifest.ts
- websocket/manifest.ts
- whatsapp/manifest.ts
- express
- nodemailer
- pdf-parse

## God Nodes (most connected - your core abstractions)
1. `startMongo()` - 70 edges
2. `stopMongo()` - 70 edges
3. `db` - 62 edges
4. `respondWithAgentIfLinked()` - 60 edges
5. `executeSectorTeam()` - 44 edges
6. `buildDeps()` - 43 edges
7. `getAgentById()` - 38 edges
8. `productionDelegationDeps()` - 33 edges
9. `validateAgainstSchema()` - 31 edges
10. `Agent` - 30 edges

## Surprising Connections (you probably didn't know these)
- `novoGerente()` --indirect_call--> `websocketAdapterFor()`  [INFERRED]
  test/websocketIntegration.test.mjs → src/integrations/websocket/service.ts
- `novoGerente()` --indirect_call--> `streamCredentials()`  [INFERRED]
  test/websocketIntegration.test.mjs → src/streams/service.ts
- `novoGerente()` --indirect_call--> `createRealSocket()`  [INFERRED]
  test/websocketIntegration.test.mjs → src/streams/socket.ts
- `closeDueCandles()` --indirect_call--> `vela()`  [INFERRED]
  src/marketData/engine.ts → test/candleAnalyzer.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (239 total, 35 thin omitted)

### Community 0 - "installations.ts"
Cohesion: 0.08
Nodes (38): createInstallation(), CreateInstallationInput, deleteInstallation(), installationPublic(), installations, listInstallations(), markInstallationTested(), normalizeConfig() (+30 more)

### Community 1 - "websocketRoutes.ts"
Cohesion: 0.09
Nodes (28): WsFilter, deleteSubscription(), findSubscription(), insertSubscription(), listLogs(), listMessages(), listSubscriptions(), LOG_RETENTION_DAYS (+20 more)

### Community 2 - "agentRoutineRoutes.ts"
Cohesion: 0.10
Nodes (35): EventTriggerError, MarketTriggerPlan, SignalPlan, webhookEndpoint(), listAgentAutomations(), listRoutines(), readSourceFromDefinition(), RoutineError (+27 more)

### Community 3 - "whatsapp.ts"
Cohesion: 0.14
Nodes (18): ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter(), InboundMediaRef, InboundMessage (+10 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (57): chunks, chunkText(), combineKnowledgeHits(), countDocumentsFromSource(), countUnindexedFor(), createDocument(), createDocumentFor(), CreateDocumentInput (+49 more)

### Community 5 - "voyage.ts"
Cohesion: 0.07
Nodes (38): BudgetDenial, BudgetDoc, dia(), embeddingBudgetConfig, EmbeddingUsageEvent, embeddingUsageReport, ensureEmbeddingUsageIndexes(), estimateTokens() (+30 more)

### Community 6 - "src/index.ts"
Cohesion: 0.03
Nodes (58): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), builtinAppsCatalog(), getBuiltinApp(), formatOptions() (+50 more)

### Community 7 - "openai.ts"
Cohesion: 0.10
Nodes (44): MAX_TOOL_ITERATIONS, anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL, extractIdentity() (+36 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (47): roleUIConfigOf(), sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, agents, AgentSourceSettings, AgentTool, AgentToolHeader (+39 more)

### Community 9 - "grants.ts"
Cohesion: 0.14
Nodes (32): missingCapability(), recordActionEvent(), takeActionDetail(), AMBIENTES_BLOQUEADOS, ConnectionProblem, ConnectionRefusal, environmentOf(), interpolar() (+24 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (29): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+21 more)

### Community 11 - "refreshMemoryAndIdentity"
Cohesion: 0.11
Nodes (27): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+19 more)

### Community 12 - "routine.ts"
Cohesion: 0.13
Nodes (50): StepCondition, buildEventTriggerDefinition(), describeEventTriggerFlow(), emptyMarketPlan(), emptySignalPlan(), EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger() (+42 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.09
Nodes (30): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+22 more)

### Community 14 - "delegation.ts"
Cohesion: 0.07
Nodes (40): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, ClarificationRequest, buildCapabilityMissing(), CapabilityMissing, DEFAULT_DELEGATION_TOKEN_BUDGET, DelegationBudget (+32 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.04
Nodes (24): FLOOR, PAGE, recebido, OPCOES, AGENTE, SETOR, CRIADORES, startMongo() (+16 more)

### Community 16 - "AppDefinition"
Cohesion: 0.38
Nodes (7): adapters, manifest, native(), num(), schema(), str(), AppDefinition

### Community 17 - "googleCalendar.ts"
Cohesion: 0.15
Nodes (18): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), googleConfigured(), SCOPES, TokenResponse, googleCalendarTools() (+10 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "floorWork.ts"
Cohesion: 0.22
Nodes (12): deriveCallerPolicy(), deriveDelegationPolicy(), withAgentDefaults(), DELEGATION_MAX_DEPTH, Floor, agents, competencyOf(), effectiveTargets() (+4 more)

### Community 20 - "guard.ts"
Cohesion: 0.14
Nodes (24): countActionsSince(), definido(), dinheiro(), evaluatePolicy(), localParts(), looksLikeOption(), minutesOfDay(), needsContext() (+16 more)

### Community 21 - "streams/service.ts"
Cohesion: 0.13
Nodes (27): setStreamManager(), countStreams(), deleteStream(), findStream(), listResumableStreams(), listStreams(), listStreamsForInstallation(), markStreamEvent() (+19 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, cron-parser, dotenv, mongodb, multer, openai (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "agentCapabilities.ts"
Cohesion: 0.22
Nodes (8): AgentRole, POR_PRESET, ROLE_LABEL, RoleCapabilities, roleOf(), RoleSection, RoleUIConfig, SECOES

### Community 25 - "records.ts"
Cohesion: 0.07
Nodes (54): readPath(), clarificationKey(), ClarifyMemoryTarget, recallClarifications(), rememberClarification(), assertAgentMayWrite(), floors, MemoryAccessError (+46 more)

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
Cohesion: 0.20
Nodes (16): describeManifestIssues(), exportableManifest(), archivePrivateApp(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listAppsForOwner() (+8 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.10
Nodes (25): artifacts, claimNextRun(), findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, recoverRun() (+17 more)

### Community 32 - "migrate.ts"
Cohesion: 0.13
Nodes (23): ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes(), ensureBuildingIndexes(), ensureConnectionIndexes() (+15 more)

### Community 33 - "widgets.ts"
Cohesion: 0.07
Nodes (31): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 35 - "connections/repository.ts"
Cohesion: 0.10
Nodes (16): chunkTelegram(), FetchImpl, MailTransport, maskDestination(), sendEmail(), sendTelegram(), connections, deliveries (+8 more)

### Community 36 - "validate.ts"
Cohesion: 0.17
Nodes (20): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), canonical() (+12 more)

### Community 37 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

### Community 38 - "tools.ts"
Cohesion: 0.10
Nodes (21): clamp(), createTool(), deleteTool(), getTool(), headersDe(), listTools(), normalize(), TOOL_AUTH_KINDS (+13 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.11
Nodes (25): findVersion(), insertRunIdempotent(), createRun(), analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow (+17 more)

### Community 41 - "apps/types.ts"
Cohesion: 0.11
Nodes (15): manifest, APP_ACTIVATIONS, APP_AVAILABILITIES, APP_ENVIRONMENTS, AppActionExecution, AppAuthDefinition, AppAuthField, AppAuthKind (+7 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.11
Nodes (13): acaoDeCandles, AGENT, APP_EM_BREVE, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO (+5 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "dispatcher.ts"
Cohesion: 0.11
Nodes (27): executarPorDespacho(), conferirEntrada(), conferirSaida(), dispatchAgentExecution(), DispatchDeps, falha(), fromLlmResult(), LlmRunner (+19 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "bus.ts"
Cohesion: 0.11
Nodes (20): backoffMs(), completeEvent(), deadLetter(), devolverHandler(), EVENT_LEASE_MS, EVENT_TTL_MS, EventHandler, events (+12 more)

### Community 47 - "routineExecution.ts"
Cohesion: 0.09
Nodes (33): capabilitiesOf(), RecordAgentEventInput, AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER (+25 more)

### Community 48 - "providerApps.ts"
Cohesion: 0.19
Nodes (12): adapters, manifest, adapters, manifest, hubspotTools(), mercadoPagoTools(), num(), nuvemshopTools() (+4 more)

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
Cohesion: 0.24
Nodes (4): naoLoga(), StreamManager, setStreamError(), setStreamState()

### Community 59 - "runner.ts"
Cohesion: 0.09
Nodes (44): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, MemoryOps, runDefinition(), RunnerDeps (+36 more)

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

### Community 75 - "collaborationGate.ts"
Cohesion: 0.15
Nodes (23): checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows(), agentCard() (+15 more)

### Community 76 - "scheduler.ts"
Cohesion: 0.27
Nodes (11): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, planSchedules(), runDueSchedules() (+3 more)

### Community 77 - "executionTrace.ts"
Cohesion: 0.14
Nodes (13): CHAVES_SEGURAS, ExecutionTraceEvent, onTraceEvent(), preview(), readTrace(), recorte(), sanitize(), Sink (+5 more)

### Community 78 - "seedRestaurantDemo.ts"
Cohesion: 0.22
Nodes (14): createAgent(), createFloor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main() (+6 more)

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.08
Nodes (51): normalize(), adaptLegacyPlan(), buildSynthesisContext(), clarificationFor(), CompiledPlan, CompileOptions, compilePlan(), describeMember() (+43 more)

### Community 85 - "webKnowledge.ts"
Cohesion: 0.06
Nodes (51): ReadMode, WatchedSource, browserRendererEnabled(), rendererAtivo(), feedFromHtml(), looksLikeContent(), DiscoveryPlan, DiscoveryProbe (+43 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.21
Nodes (14): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+6 more)

### Community 97 - "adaptiveWebReader.ts"
Cohesion: 0.10
Nodes (40): aindaEsperando(), anotarEspera(), CABECALHOS, ehDocumentoXml(), emEspera, ExtractedLink, extrair(), falha() (+32 more)

### Community 98 - "floors.ts"
Cohesion: 0.14
Nodes (25): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, ensureDefaultBuilding(), collection (+17 more)

### Community 99 - "functionRegistry.ts"
Cohesion: 0.08
Nodes (19): comLimite(), executeRegisteredFunction(), falha(), TEXTO_NAO_PRODUZIDO, adaptadores, CONFIG_CASAS, DOC_SAIDA, ErroDeFuncao (+11 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "migration.ts"
Cohesion: 0.12
Nodes (27): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+19 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.09
Nodes (31): AgentDefinition, definitionOf(), OutputCheck, resolveAgentRun(), resolveCache(), ResolvedAgentRun, ResolveRunOptions, ActionRisk (+23 more)

### Community 103 - "automations/service.ts"
Cohesion: 0.13
Nodes (31): ensureActivationMode(), getAgentById(), createEventTrigger(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation() (+23 more)

### Community 104 - "Agent"
Cohesion: 0.14
Nodes (23): Agent, parseAgentModelFields(), AgentAppGrant, AgentContract, AgentContractInput, agentContractOf(), contractFromFunction(), ContractParseResult (+15 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.17
Nodes (18): TokenUsage, attemptChargeKey(), dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage() (+10 more)

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
Cohesion: 0.07
Nodes (44): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+36 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "browserRenderer.ts"
Cohesion: 0.18
Nodes (13): BrowserRenderer, ReaderPage, abrirNavegador(), esperarVaga(), fila, liberarVaga(), renderWithBrowser(), assertPublicUrl() (+5 more)

### Community 120 - "getSectorById"
Cohesion: 0.20
Nodes (14): listAgents(), bloqueiaSePrejudicaWidget(), getWidgetConfigAgent(), inboundMediaToText(), resolveOwnedAgentId(), resolveOwnedSectorId(), resolverDestinoDoWidget(), requireSector() (+6 more)

### Community 121 - "marketData/engine.ts"
Cohesion: 0.17
Nodes (21): DispatchDeps, closeCandle(), closedSeries(), dueCandles(), foldChild(), isDue(), markFolded(), markPublished() (+13 more)

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

### Community 132 - "appGrantRoutes.ts"
Cohesion: 0.20
Nodes (10): ValidationError, appGrantRouter, auditEntity(), automationRouter, connectionRouter, fail(), notFound(), oid() (+2 more)

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
Cohesion: 0.13
Nodes (23): naoVencido(), searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData(), extractTerms(), extractWindow() (+15 more)

### Community 140 - "automations/types.ts"
Cohesion: 0.14
Nodes (13): AI_STEP_TYPES, AutomationInput, AutomationLimits, AutomationTrigger, DEFAULT_LIMITS, DeliveryTarget, EXECUTION_MODES, InternalEventTrigger (+5 more)

### Community 146 - "automations/repository.ts"
Cohesion: 0.14
Nodes (11): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), ListAutomationsQuery, versions, AutomationVersion, signBody() (+3 more)

### Community 147 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 150 - "clarify.ts"
Cohesion: 0.27
Nodes (8): clarificationFrom(), CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarificationGuidance(), CLARIFY_LIMIT, clarifyBudgetSpent()

### Community 151 - "connections/service.ts"
Cohesion: 0.20
Nodes (14): revokeInstallation(), CONNECTION_CATALOG, createConnection(), CreateConnectionInput, decryptConfig(), isNonEmpty(), normalizeName(), patchConnection() (+6 more)

### Community 152 - "routineExecutorPaths.integration.test.mjs"
Cohesion: 0.29
Nodes (4): agente(), ANDAR, DE_FUNCAO(), PREDIO

### Community 153 - "db.ts"
Cohesion: 0.15
Nodes (15): auth, clientUrl, config, isProduction, originList(), port, stripTrailingSlash(), urlVar() (+7 more)

### Community 155 - "sectorDecisions.ts"
Cohesion: 0.29
Nodes (5): aggregateSectorDecisions(), listSectorDecisionsForConversation(), SectorDecision, SectorDecisionAggregate, sectorDecisions

### Community 156 - "candleStore.ts"
Cohesion: 0.20
Nodes (15): ajustarPontas(), CANDLE_RETENTION_DAYS, candles, candlesCollection, chave(), dobrarUma(), findCandle(), foldTrade() (+7 more)

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.22
Nodes (7): ANALISTA, COLETOR, COZINHA, EQUIPE, FINANCEIRO, JURIDICO, TIME

### Community 159 - "streamManager.integration.test.mjs"
Cohesion: 0.09
Nodes (14): startFakeWs(), ADAPTER, app(), conectar(), gerente(), MANIFESTO, publicados, publicarFalso() (+6 more)

### Community 160 - "runProcessor.ts"
Cohesion: 0.15
Nodes (23): findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact() (+15 more)

### Community 161 - "sourceCheckpoint.ts"
Cohesion: 0.14
Nodes (17): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), acquireSourceLease(), advanceCheckpoint(), beginCheck() (+9 more)

### Community 162 - "webSearch/budget.ts"
Cohesion: 0.07
Nodes (45): buscarPadrao(), AgentModelFields, traceEvent(), safeFetch(), agentSearchStats, BRAVE_FREE_MONTHLY_REQUESTS, ensureWebSearchIndexes(), eventos (+37 more)

### Community 165 - "executionCenter.ts"
Cohesion: 0.07
Nodes (49): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+41 more)

### Community 166 - "internalEvents.ts"
Cohesion: 0.22
Nodes (14): asString(), buildTriggerInput(), chainOf(), DEFAULT_SERIES_LENGTH, dispatchInternalEvent(), internalTriggerOf(), matchesInternalTrigger(), MAX_EVENT_CHAIN (+6 more)

### Community 167 - "publicWidgetRoutes.integration.test.mjs"
Cohesion: 0.14
Nodes (4): ANDAR, PREDIO, ANDAR, gravadas

### Community 169 - "builtinTools.ts"
Cohesion: 0.10
Nodes (29): legacyToolToExecutable(), ResolvedTool, resolveHttpTool(), toolInputSchema(), joinPath(), resolveAppGrantTools(), APP_GUIDES, BUILTIN_APPS (+21 more)

### Community 171 - "webKnowledge.integration.test.mjs"
Cohesion: 0.23
Nodes (12): agenteComSite(), artigosNoFeed, comBootstrap(), comFeed(), criarAgente(), depsDoRuntime(), pedidos, rodar() (+4 more)

### Community 172 - "agentRuntime.ts"
Cohesion: 0.11
Nodes (27): composeAgentPrompt(), enforceOutputContract(), outputDirective(), AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective() (+19 more)

### Community 175 - "executorAudit.integration.test.mjs"
Cohesion: 0.30
Nodes (11): agente(), ANDAR, CALCULADORA(), COLETOR(), ctx(), deps(), doTipo(), eventos() (+3 more)

### Community 177 - "delegationWiring.ts"
Cohesion: 0.25
Nodes (17): createLiveTracker(), executeAgentTask(), agentCanDelegate(), capabilityMissingTool(), finishDelegation(), startDelegation(), playgroundDelegationDeps(), productionDelegationDeps() (+9 more)

### Community 178 - "agentRoleRuntime.integration.test.mjs"
Cohesion: 0.52
Nodes (6): agenteCom(), bancada(), comBusca(), contexto(), nomes(), rodar()

### Community 182 - "internalEventTrigger.integration.test.mjs"
Cohesion: 0.18
Nodes (9): ACAO_ANALISE, AGENT, BUILDING, FLOOR, INSTALACAO, K, specComSinal(), specDeMercado() (+1 more)

### Community 183 - "llm.ts"
Cohesion: 0.17
Nodes (19): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, askAux(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput() (+11 more)

### Community 184 - "systemPrompt.ts"
Cohesion: 0.10
Nodes (19): planSectorResponse(), planSectorResponse(), buildClarificationInstruction(), buildIdentityCaptureInstruction(), buildLanguageInstruction(), buildProactivityInstruction(), buildResponseStyleInstruction(), buildSectorPlannerPrompt() (+11 more)

### Community 185 - "dependenciasDeclaradas.test.mjs"
Cohesion: 0.25
Nodes (4): declaradas, nativos, pkg, raiz

### Community 187 - "validateAgainstSchema"
Cohesion: 0.14
Nodes (22): runResolvedTool(), checkStageOutput(), assertRegistryIsSound(), describeStepError(), finishStep(), prepareStepInput(), primeiros(), PROIBIDOS (+14 more)

### Community 188 - "alpaca/adapter.ts"
Cohesion: 0.15
Nodes (23): ACTION_DETAIL_KEY, ActionOutcomeDetail, AppActionEvent, appActionEvents, detalhes, ensureAppActionIndexes(), reportActionDetail(), AlpacaContext (+15 more)

### Community 189 - "websocket/config.ts"
Cohesion: 0.17
Nodes (15): buildWebSocketAdapter(), WEBSOCKET_EVENT, WsIngest, connectionConfigPublic(), fillToken(), mensagem(), normalizeConnectionConfig(), normalizePath() (+7 more)

### Community 190 - "planCompiler.test.mjs"
Cohesion: 0.29
Nodes (4): CHEFE, COLETOR, EQUIPE, RISCO

### Community 196 - "client.ts"
Cohesion: 0.15
Nodes (13): alpacaProbe(), AlpacaClient, AlpacaCredentials, AlpacaError, ClientDeps, comQuery(), createAlpacaClient(), DATA_BASE (+5 more)

### Community 197 - "building.ts"
Cohesion: 0.13
Nodes (18): Building, BuildingPatch, buildings, DEFAULT_TIMEZONE, isValidTimezone(), LANGUAGES, updateBuilding(), buildings (+10 more)

### Community 199 - "policyEnforcement.integration.test.mjs"
Cohesion: 0.11
Nodes (5): AGENTE, CONEXAO, CRED, ordemPadrao, OUTRA_CONEXAO

### Community 201 - "agentEvents.ts"
Cohesion: 0.18
Nodes (12): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow (+4 more)

### Community 203 - "connectionProfile.integration.test.mjs"
Cohesion: 0.40
Nodes (4): app(), conectar(), MANIFESTO, semConexao

### Community 204 - "official/index.ts"
Cohesion: 0.17
Nodes (9): adapters, manifest, MODULES, OFFICIAL_ADAPTERS, OfficialAppsError, OfficialModule, adapters, manifest (+1 more)

### Community 205 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 206 - "researcherWebResearch.integration.test.mjs"
Cohesion: 0.11
Nodes (8): ANDAR, PREDIO, ANDAR, ESPERADO, PREDIO, VALORES, pedidosPorRota, respostaDoRitmo

### Community 207 - "state.ts"
Cohesion: 0.14
Nodes (19): SeriesKey, ingestTrade(), estados, filtroDe(), guardar(), marketStateCollection, readState(), rememberTrade() (+11 more)

### Community 208 - "policies/repository.ts"
Cohesion: 0.16
Nodes (14): activePolicyFor(), limite(), LIMITES, listPolicies(), normalizeRules(), policies, policiesCollection, PolicyFieldError (+6 more)

### Community 209 - "apps/manifest.ts"
Cohesion: 0.23
Nodes (13): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+5 more)

### Community 210 - "modelCache.ts"
Cohesion: 0.29
Nodes (9): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), humanizeModelId(), isChatModel() (+1 more)

### Community 211 - "alpaca/manifest.ts"
Cohesion: 0.22
Nodes (4): ALPACA_DOMAINS, numeroOuNulo, ORDEM_SCHEMA, VELA_SCHEMA

### Community 212 - "manager.ts"
Cohesion: 0.09
Nodes (18): HEARTBEAT_MS, ManagerDeps, MAX_TENTATIVAS, PROBE_MS, SILENCIO_MS, SocketFactory, StreamSocket, Vivo (+10 more)

### Community 214 - "websocket/service.ts"
Cohesion: 0.16
Nodes (23): readAt(), publishEvent(), asTexto(), camposDoErro(), dataDe(), dedupeKeyOf(), janelas, matchesFilters() (+15 more)

### Community 215 - "safeWebSocket.ts"
Cohesion: 0.31
Nodes (9): isPrivateIp(), assertPublicWebSocketUrl(), CheckedTarget, checkWebSocketUrl(), ehLoopback(), emProducao(), HOSTS_PROIBIDOS, loopbackLiberado() (+1 more)

### Community 216 - "conversationTurns.ts"
Cohesion: 0.28
Nodes (8): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText()

### Community 217 - "delegationLog.ts"
Cohesion: 0.22
Nodes (8): col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus, ensureDelegationIndexes(), listDelegationsForAgent(), succeededDelegationsByCaller()

### Community 218 - "destinations.ts"
Cohesion: 0.42
Nodes (8): onEvent(), deliverWebSocketEvent(), idValido(), paraMemoria(), paraRotina(), registerWebSocketDestinations(), activeSubscriptions(), writeLog()

### Community 219 - "fluxoCompleto.integration.test.mjs"
Cohesion: 0.15
Nodes (7): AGENTE, BUILDING, CRED, FLOOR, semRelogio, SocketFalso, T0

### Community 220 - "autoModel.ts"
Cohesion: 0.29
Nodes (7): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), auxModelFor()

### Community 221 - "stream.ts"
Cohesion: 0.14
Nodes (12): adapters, manifest, alpacaStreamAdapter, FEED, PublishInput, MARKET_SCHEMA_VERSION, streamableAppKeys(), adapters (+4 more)

### Community 222 - "connectionTests.ts"
Cohesion: 0.25
Nodes (7): ConnectionProbe, connectionProbeFor(), PROBE_TIMEOUT_MS, probes, registerConnectionProbe(), runProbe(), AppEnvironment

### Community 224 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 225 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

### Community 226 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 227 - "tokensByModel.integration.test.mjs"
Cohesion: 0.40
Nodes (3): AGENTE, ANDAR, ONTEM

## Knowledge Gaps
- **896 isolated node(s):** `name`, `version`, `type`, `main`, `dev` (+891 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **35 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ensureAgentWebKnowledgeFresh()` connect `webKnowledge.ts` to `delegationWiring.ts`, `agentRoutineRoutes.ts`, `automations/service.ts`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Why does `site()` connect `webKnowledge.ts` to `sourceTool.integration.test.mjs`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Why does `novoGerente()` connect `streamManager.integration.test.mjs` to `grants.ts`, `streams/service.ts`, `websocket/service.ts`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **What connects `name`, `version`, `type` to the rest of the system?**
  _896 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `installations.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07729468599033816 - nodes in this community are weakly interconnected._
- **Should `websocketRoutes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0928030303030303 - nodes in this community are weakly interconnected._
- **Should `agentRoutineRoutes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09957325746799431 - nodes in this community are weakly interconnected._