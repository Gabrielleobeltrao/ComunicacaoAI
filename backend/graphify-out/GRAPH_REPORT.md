# Graph Report - backend  (2026-08-25)

## Corpus Check
- 392 files · ~461,785 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3490 nodes · 8083 edges · 219 communities (186 shown, 33 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 65 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `96540fe6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- installations.ts
- runner.ts
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
- apps/types.ts
- googleCalendar.ts
- patterns.ts
- Agent
- alpaca/adapter.ts
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
- connections/service.ts
- sourceMonitoring.test.mjs
- connections/repository.ts
- validate.ts
- llmFake.ts
- tools.ts
- eventTrigger.integration.test.mjs
- executionRoots.ts
- auditMiddleware.ts
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
- listRunTimeline
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
- sectorAccess.ts
- sectorAccess.integration.test.mjs
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
- ChatTurn
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
- safeError.ts
- webSearch/budget.ts
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
- selectVisualStates
- executionPlan.ts
- planCompiler.test.mjs
- sourceSsrf.test.mjs
- executionRoutes.ts
- building.ts
- policyEnforcement.integration.test.mjs
- executorHardening.test.mjs
- agentEvents.ts
- hardening.integration.test.mjs
- connectionProfile.integration.test.mjs
- executorRegressions.integration.test.mjs
- migrationFixture.integration.test.mjs
- researcherWebResearch.integration.test.mjs
- floorRoutes.ts
- modelCache.ts
- toolExecutor.ts
- runService.ts
- alpaca/manifest.ts
- conversationTurns.ts
- tradingPolicy.test.mjs
- events/fromStep.ts
- marketData.integration.test.mjs
- braveSearch.integration.test.mjs
- sectorMembersFromStages.integration.test.mjs
- widgetRuntimeDestination.integration.test.mjs

## God Nodes (most connected - your core abstractions)
1. `startMongo()` - 68 edges
2. `stopMongo()` - 68 edges
3. `db` - 61 edges
4. `respondWithAgentIfLinked()` - 60 edges
5. `executeSectorTeam()` - 44 edges
6. `buildDeps()` - 42 edges
7. `getAgentById()` - 36 edges
8. `productionDelegationDeps()` - 33 edges
9. `Agent` - 30 edges
10. `runMigrations()` - 29 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `ensureAgentWebKnowledgeFresh()` --indirect_call--> `site()`  [INFERRED]
  src/webKnowledge.ts → test/sourceTool.integration.test.mjs
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `PrivateAppDoc` --references--> `AppDefinition`  [EXTRACTED]
  src/apps/privateApps.ts → src/apps/types.ts
- `resolveSectorMembers()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (219 total, 33 thin omitted)

### Community 0 - "installations.ts"
Cohesion: 0.09
Nodes (28): createInstallation(), CreateInstallationInput, deleteInstallation(), installationPublic(), installations, markInstallationTested(), normalizeConfig(), normalizeEnvironment() (+20 more)

### Community 1 - "runner.ts"
Cohesion: 0.05
Nodes (68): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), RoutineSource, AgentCall, delay() (+60 more)

### Community 2 - "agentRoutineRoutes.ts"
Cohesion: 0.13
Nodes (32): StepCondition, emptyMarketPlan(), emptySignalPlan(), EventTriggerError, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers() (+24 more)

### Community 3 - "whatsapp.ts"
Cohesion: 0.12
Nodes (21): extractTextFromFile(), getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia() (+13 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (55): chunks, chunkText(), combineKnowledgeHits(), countDocumentsFromSource(), countUnindexedFor(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent() (+47 more)

### Community 5 - "voyage.ts"
Cohesion: 0.07
Nodes (38): BudgetDenial, BudgetDoc, dia(), embeddingBudgetConfig, EmbeddingUsageEvent, embeddingUsageReport, ensureEmbeddingUsageIndexes(), estimateTokens() (+30 more)

### Community 6 - "src/index.ts"
Cohesion: 0.03
Nodes (78): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), clarificationGuidance(), CLARIFY_LIMIT (+70 more)

### Community 7 - "openai.ts"
Cohesion: 0.15
Nodes (24): MAX_TOOL_ITERATIONS, extractIdentity(), extractStructuredOutput(), planSectorResponse(), updateStructuredMemory(), askAux(), AUXILIARY_MODEL, buildClient() (+16 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (51): capabilitiesOf(), roleUIConfigOf(), sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, agents, AgentSourceSettings, AgentTool (+43 more)

### Community 9 - "grants.ts"
Cohesion: 0.14
Nodes (31): missingCapability(), recordActionEvent(), AMBIENTES_BLOQUEADOS, ConnectionProblem, ConnectionRefusal, environmentOf(), interpolar(), resolveConnection() (+23 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (30): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+22 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.10
Nodes (33): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+25 more)

### Community 12 - "routine.ts"
Cohesion: 0.15
Nodes (33): buildEventTriggerDefinition(), marketTriggerOf(), updateEventTrigger(), aiStepPlanned(), appStep(), emptyMemoryPlan(), memoryStep(), normalizeMemoryPlan() (+25 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.10
Nodes (26): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS, clearAgentState() (+18 more)

### Community 14 - "delegation.ts"
Cohesion: 0.06
Nodes (53): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, ClarificationRequest, agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools() (+45 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.03
Nodes (31): FLOOR, PAGE, OPCOES, AGENTE, SETOR, ANDAR, PREDIO, CRIADORES (+23 more)

### Community 16 - "apps/types.ts"
Cohesion: 0.06
Nodes (39): manifest, adapters, manifest, MODULES, OFFICIAL_ADAPTERS, OfficialAppsError, OfficialModule, adapters (+31 more)

### Community 17 - "googleCalendar.ts"
Cohesion: 0.13
Nodes (21): adapters, manifest, buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), googleConfigured() (+13 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (55): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+47 more)

### Community 19 - "Agent"
Cohesion: 0.11
Nodes (25): Agent, AgentAppGrant, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget (+17 more)

### Community 20 - "alpaca/adapter.ts"
Cohesion: 0.05
Nodes (62): AppActionEvent, appActionEvents, countActionsSince(), AlpacaContext, alpacaTools(), buildAlpacaTools(), conta(), num() (+54 more)

### Community 21 - "streams/service.ts"
Cohesion: 0.06
Nodes (36): FEED, PublishInput, HEARTBEAT_MS, ManagerDeps, MAX_TENTATIVAS, setStreamManager(), SILENCIO_MS, SocketFactory (+28 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

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
Cohesion: 0.12
Nodes (29): describeManifestIssues(), exportableManifest(), FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest() (+21 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.14
Nodes (18): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+10 more)

### Community 32 - "migrate.ts"
Cohesion: 0.16
Nodes (24): ensureAppActionIndexes(), backfillManagedChannelInstallations(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes() (+16 more)

### Community 33 - "connections/service.ts"
Cohesion: 0.20
Nodes (14): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, decryptConfig(), getConnection(), isNonEmpty(), normalizeName(), patchConnection() (+6 more)

### Community 35 - "connections/repository.ts"
Cohesion: 0.09
Nodes (18): chunkTelegram(), FetchImpl, MailTransport, maskDestination(), sendEmail(), sendTelegram(), connections, deliveries (+10 more)

### Community 36 - "validate.ts"
Cohesion: 0.27
Nodes (14): canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord(), MAX_TRIGGER_SERIES, MAX_TRIGGER_SYMBOLS (+6 more)

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
Cohesion: 0.12
Nodes (20): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+12 more)

### Community 41 - "auditMiddleware.ts"
Cohesion: 0.19
Nodes (11): AuditAction, recordAudit(), safeMetadata(), entityLabelWithOwner(), auditRequests(), AuditTarget, auditTargetFor(), matches() (+3 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.11
Nodes (13): acaoDeCandles, AGENT, APP_EM_BREVE, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO (+5 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "dispatcher.ts"
Cohesion: 0.13
Nodes (21): conferirEntrada(), conferirSaida(), dispatchAgentExecution(), DispatchDeps, falha(), fromLlmResult(), LlmRunner, semConfiguracao() (+13 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "bus.ts"
Cohesion: 0.15
Nodes (14): backoffMs(), completeEvent(), deadLetter(), EVENT_LEASE_MS, EVENT_TTL_MS, EventHandler, events, eventsCollection (+6 more)

### Community 47 - "routineExecution.ts"
Cohesion: 0.11
Nodes (27): AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail(), ToolTrace (+19 more)

### Community 48 - "builtinTools.ts"
Cohesion: 0.17
Nodes (16): adapters, manifest, APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField (+8 more)

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

### Community 59 - "listRunTimeline"
Cohesion: 0.23
Nodes (13): averageTokens(), decodeRunCursor(), encodeRunCursor(), listRunsForCenter(), listRunTimeline(), listScheduled(), listTriggers(), loadJoins() (+5 more)

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
Cohesion: 0.27
Nodes (10): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, planSchedules(), runDueSchedules() (+2 more)

### Community 77 - "executionTrace.ts"
Cohesion: 0.15
Nodes (12): CHAVES_SEGURAS, ExecutionTraceEvent, onTraceEvent(), readTrace(), recorte(), sanitize(), Sink, TraceEventType (+4 more)

### Community 78 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.07
Nodes (63): executeSectorTeam(), stageInstruction(), normalize(), adaptLegacyPlan(), assembleWithoutModel(), buildSynthesisContext(), clarificationFor(), CompiledPlan (+55 more)

### Community 85 - "webKnowledge.ts"
Cohesion: 0.06
Nodes (48): ReadMode, WatchedSource, feedFromHtml(), looksLikeContent(), DiscoveryPlan, DiscoveryProbe, ehFeed(), planDiscovery() (+40 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.22
Nodes (13): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+5 more)

### Community 97 - "adaptiveWebReader.ts"
Cohesion: 0.10
Nodes (41): aindaEsperando(), anotarEspera(), CABECALHOS, ehDocumentoXml(), emEspera, ExtractedLink, extrair(), falha() (+33 more)

### Community 98 - "floors.ts"
Cohesion: 0.20
Nodes (14): BuildingLanguage, collection, DeleteFloorResult, Floor, FLOOR_WORK_MODES, FloorDoc, FloorInput, FloorPatch (+6 more)

### Community 99 - "functionRegistry.ts"
Cohesion: 0.09
Nodes (12): adaptadores, CONFIG_CASAS, DOC_SAIDA, findAdapterFor(), FunctionAdapter, FunctionHandler, listPublicFunctions(), NUMEROS_SCHEMA (+4 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "migration.ts"
Cohesion: 0.08
Nodes (44): AgentBuiltinTool, LEGACY_APP_VERSION, listInstallations(), agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation() (+36 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.10
Nodes (29): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+21 more)

### Community 103 - "automations/service.ts"
Cohesion: 0.18
Nodes (22): ensureActivationMode(), getAgentById(), createEventTrigger(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation() (+14 more)

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
Cohesion: 0.11
Nodes (26): AgentDoc, assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector() (+18 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "browserRenderer.ts"
Cohesion: 0.18
Nodes (14): BrowserRenderer, ReaderPage, abrirNavegador(), esperarVaga(), fila, liberarVaga(), renderWithBrowser(), assertPublicUrl() (+6 more)

### Community 120 - "sectorAccess.ts"
Cohesion: 0.09
Nodes (31): listAgents(), bloqueiaSePrejudicaWidget(), resolveOwnedAgentId(), resolveOwnedSectorId(), resolverDestinoDoWidget(), serializeSector(), requireSector(), accessConfigOf() (+23 more)

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

### Community 129 - "automations/engine.ts"
Cohesion: 0.10
Nodes (29): CANDLE_SWEEP_MS, CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, EVENT_BATCH, EVENT_POLL_MS (+21 more)

### Community 131 - "sourceCheckpoint.integration.test.mjs"
Cohesion: 0.25
Nodes (5): agora, AUTOMACAO, FONTE, OUTRA_FONTE, QUANDO

### Community 133 - "ChatTurn"
Cohesion: 0.24
Nodes (10): InteractiveRunOptions, cache, chaveDe(), Entrada, normalizar(), rememberedScope(), rememberScope(), checkScope() (+2 more)

### Community 134 - "sourceTool.integration.test.mjs"
Cohesion: 0.22
Nodes (6): AGENTE, agenteFalso, ANDAR, FEED(), itensDoFeed, servidor

### Community 135 - "timeoutCancellation.test.mjs"
Cohesion: 0.40
Nodes (4): AnthropicFalso, comportamento, contadora(), espera()

### Community 137 - "run.ts"
Cohesion: 0.12
Nodes (26): browserRendererEnabled(), rendererAtivo(), naoVencido(), searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData() (+18 more)

### Community 140 - "automations/types.ts"
Cohesion: 0.10
Nodes (23): CreateAutomationInput, UpdateDraftPatch, AI_STEP_TYPES, Automation, AutomationDefinition, AutomationInput, AutomationLimits, AutomationVersion (+15 more)

### Community 146 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, signBody() (+4 more)

### Community 147 - "audit.ts"
Cohesion: 0.11
Nodes (24): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic, AuditFilters (+16 more)

### Community 150 - "clarify.ts"
Cohesion: 0.38
Nodes (6): clarificationFrom(), CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarifyBudgetSpent()

### Community 151 - "claude.ts"
Cohesion: 0.11
Nodes (24): anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), DEFAULT_MODEL, FALLBACK_MODELS, generateAgentReply(), planStageTransition() (+16 more)

### Community 152 - "routineExecutorPaths.integration.test.mjs"
Cohesion: 0.29
Nodes (4): agente(), ANDAR, DE_FUNCAO(), PREDIO

### Community 153 - "config.ts"
Cohesion: 0.21
Nodes (10): auth, clientUrl, config, isProduction, originList(), port, stripTrailingSlash(), urlVar() (+2 more)

### Community 155 - "db.ts"
Cohesion: 0.10
Nodes (18): db, guardarTurnoDeTeste(), createOffice(), ensureDefaultOffice(), Office, offices, appendPlaygroundTurns(), clearPlaygroundTurns() (+10 more)

### Community 156 - "marketData/engine.ts"
Cohesion: 0.08
Nodes (48): Candle, CANDLE_RETENTION_DAYS, candles, candlesCollection, chave(), closeCandle(), closedSeries(), dueCandles() (+40 more)

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.22
Nodes (7): ANALISTA, COLETOR, COZINHA, EQUIPE, FINANCEIRO, JURIDICO, TIME

### Community 159 - "streamManager.integration.test.mjs"
Cohesion: 0.14
Nodes (10): ADAPTER, app(), conectar(), gerente(), MANIFESTO, publicados, publicarFalso(), relogioFalso() (+2 more)

### Community 160 - "runProcessor.ts"
Cohesion: 0.22
Nodes (18): runEventKey(), findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped() (+10 more)

### Community 161 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 162 - "webSearch/budget.ts"
Cohesion: 0.07
Nodes (44): buscarPadrao(), traceEvent(), safeFetch(), agentSearchStats, BRAVE_FREE_MONTHLY_REQUESTS, ensureWebSearchIndexes(), eventos, ligado() (+36 more)

### Community 165 - "executionCenter.ts"
Cohesion: 0.12
Nodes (24): ACTIVE_RUN_STATUSES, AgentRef, agents, AutomationDoc, automations, ExecutionFilters, ExecutionPage, floors (+16 more)

### Community 166 - "internalEvents.ts"
Cohesion: 0.17
Nodes (17): asString(), buildTriggerInput(), chainOf(), DEFAULT_SERIES_LENGTH, DispatchDeps, dispatchInternalEvent(), internalTriggerOf(), matchesInternalTrigger() (+9 more)

### Community 169 - "agentTools.ts"
Cohesion: 0.13
Nodes (20): legacyToolToExecutable(), resolveHttpTool(), toolInputSchema(), joinPath(), ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate() (+12 more)

### Community 171 - "webKnowledge.integration.test.mjs"
Cohesion: 0.23
Nodes (12): agenteComSite(), artigosNoFeed, comBootstrap(), comFeed(), criarAgente(), depsDoRuntime(), pedidos, rodar() (+4 more)

### Community 172 - "agentRuntime.ts"
Cohesion: 0.13
Nodes (25): enforceOutputContract(), AgentExecutionResult, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson() (+17 more)

### Community 175 - "executorAudit.integration.test.mjs"
Cohesion: 0.30
Nodes (11): agente(), ANDAR, CALCULADORA(), COLETOR(), ctx(), deps(), doTipo(), eventos() (+3 more)

### Community 177 - "delegationWiring.ts"
Cohesion: 0.10
Nodes (31): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), resolveAgentTools(), agentCanDelegate() (+23 more)

### Community 178 - "agentRoleRuntime.integration.test.mjs"
Cohesion: 0.52
Nodes (6): agenteCom(), bancada(), comBusca(), contexto(), nomes(), rodar()

### Community 182 - "internalEventTrigger.integration.test.mjs"
Cohesion: 0.18
Nodes (9): ACAO_ANALISE, AGENT, BUILDING, FLOOR, INSTALACAO, K, specComSinal(), specDeMercado() (+1 more)

### Community 183 - "llm.ts"
Cohesion: 0.17
Nodes (19): SUPPORTED_IMAGE_TYPES, askAux(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput(), FAKE_LLM_ENABLED (+11 more)

### Community 184 - "systemPrompt.ts"
Cohesion: 0.10
Nodes (19): checkGuardrail(), checkGuardrail(), buildClarificationInstruction(), buildGuardrailCheckPrompt(), buildIdentityCaptureInstruction(), buildLanguageInstruction(), buildProactivityInstruction(), buildResponseStyleInstruction() (+11 more)

### Community 185 - "dependenciasDeclaradas.test.mjs"
Cohesion: 0.25
Nodes (4): declaradas, nativos, pkg, raiz

### Community 187 - "validateAgainstSchema"
Cohesion: 0.19
Nodes (18): runResolvedTool(), checkStageOutput(), assertRegistryIsSound(), finishStep(), prepareStepInput(), primeiros(), checkJsonText(), JsonCheck (+10 more)

### Community 188 - "selectVisualStates"
Cohesion: 0.33
Nodes (5): agentLiveStatesForFloor(), rank(), selectVisualStates(), NOW, row()

### Community 189 - "executionPlan.ts"
Cohesion: 0.16
Nodes (16): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), describeEventTriggerFlow() (+8 more)

### Community 190 - "planCompiler.test.mjs"
Cohesion: 0.29
Nodes (4): CHEFE, COLETOR, EQUIPE, RISCO

### Community 196 - "executionRoutes.ts"
Cohesion: 0.13
Nodes (13): clarificationsSince(), tokensByModelSince(), agentConstraint(), agentIdsInSector(), automationFilter(), EXECUTION_TABS, executionSummary, ExecutionTab (+5 more)

### Community 197 - "building.ts"
Cohesion: 0.17
Nodes (13): Building, BuildingPatch, buildings, DEFAULT_TIMEZONE, ensureDefaultBuilding(), isValidTimezone(), LANGUAGES, updateBuilding() (+5 more)

### Community 199 - "policyEnforcement.integration.test.mjs"
Cohesion: 0.14
Nodes (8): AGENTE, CONEXAO, CONTA, COTACAO, CRED, ORDEM_OK, ordemPadrao, OUTRA_CONEXAO

### Community 201 - "agentEvents.ts"
Cohesion: 0.18
Nodes (12): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow (+4 more)

### Community 203 - "connectionProfile.integration.test.mjs"
Cohesion: 0.40
Nodes (4): app(), conectar(), MANIFESTO, semConexao

### Community 205 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 207 - "floorRoutes.ts"
Cohesion: 0.31
Nodes (7): legacyWorkingMap(), agentStatesForFloor(), buildingOverview(), floorMetrics, deleteFloor(), getFloorActivity(), floorRouter

### Community 208 - "modelCache.ts"
Cohesion: 0.29
Nodes (9): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), humanizeModelId(), isChatModel() (+1 more)

### Community 209 - "toolExecutor.ts"
Cohesion: 0.36
Nodes (9): comLimite(), escolherAcao(), executeAgentTool(), falha(), normalizar(), TIMEOUT_PADRAO_MS, traduzirExcecao(), ToolExecutorConfig (+1 more)

### Community 210 - "runService.ts"
Cohesion: 0.39
Nodes (8): createLiveTracker(), findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, TriggerType, runExecutionKey(), startExecutionRoot()

### Community 211 - "alpaca/manifest.ts"
Cohesion: 0.25
Nodes (4): adapters, ALPACA_DOMAINS, manifest, alpacaStreamAdapter

### Community 212 - "conversationTurns.ts"
Cohesion: 0.28
Nodes (8): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText()

### Community 214 - "events/fromStep.ts"
Cohesion: 0.50
Nodes (4): publishEvent(), EventStepError, publishFromStep(), PublishStepContext

## Knowledge Gaps
- **855 isolated node(s):** `appActionEvents`, `ORDER_ACTION_KEYS`, `AlpacaContext`, `AppAuthKind`, `APP_ACTIVATIONS` (+850 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **33 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ensureAgentWebKnowledgeFresh()` connect `webKnowledge.ts` to `delegationWiring.ts`, `agentRoutineRoutes.ts`, `automations/service.ts`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._
- **Why does `site()` connect `webKnowledge.ts` to `sourceTool.integration.test.mjs`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._
- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **What connects `appActionEvents`, `ORDER_ACTION_KEYS`, `AlpacaContext` to the rest of the system?**
  _855 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `installations.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09446693657219973 - nodes in this community are weakly interconnected._
- **Should `runner.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05387861084063616 - nodes in this community are weakly interconnected._
- **Should `agentRoutineRoutes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1319073083778966 - nodes in this community are weakly interconnected._