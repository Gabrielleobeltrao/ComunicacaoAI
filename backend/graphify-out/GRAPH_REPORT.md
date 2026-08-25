# Graph Report - backend  (2026-08-25)

## Corpus Check
- 383 files · ~453,122 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3419 nodes · 7945 edges · 204 communities (174 shown, 30 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 65 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f7f00e81`
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
- refreshMemoryAndIdentity
- routine.ts
- agentLiveState.ts
- delegation.ts
- mongoServer.mjs
- apps/types.ts
- googleCalendar.ts
- patterns.ts
- floorCommunication.ts
- alpaca/adapter.ts
- streams/service.ts
- dependencies
- agentEvents.ts
- runAgentTask
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- privateApps.ts
- runRepository.ts
- db
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
- manager.ts
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
- runService.ts
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
- modelDefaults.ts
- routineExecutorPaths.integration.test.mjs
- db.ts
- appGrantRoutes.ts
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
- toolsSecurity.test.mjs
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
- floorWork.ts
- dependenciasDeclaradas.test.mjs
- sectorBriefing.ts
- agentLiveState.test.mjs
- planCompiler.test.mjs
- sourceSsrf.test.mjs
- executionRoutes.ts
- executorHardening.test.mjs
- StreamAdapter
- hardening.integration.test.mjs
- connectionProfile.integration.test.mjs
- executorRegressions.integration.test.mjs
- migrationFixture.integration.test.mjs
- researcherWebResearch.integration.test.mjs

## God Nodes (most connected - your core abstractions)
1. `startMongo()` - 66 edges
2. `stopMongo()` - 66 edges
3. `respondWithAgentIfLinked()` - 60 edges
4. `db` - 59 edges
5. `executeSectorTeam()` - 44 edges
6. `buildDeps()` - 42 edges
7. `getAgentById()` - 36 edges
8. `productionDelegationDeps()` - 33 edges
9. `Agent` - 30 edges
10. `runMigrations()` - 28 edges

## Surprising Connections (you probably didn't know these)
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `ensureAgentWebKnowledgeFresh()` --indirect_call--> `site()`  [INFERRED]
  src/webKnowledge.ts → test/sourceTool.integration.test.mjs
- `PrivateAppDoc` --references--> `AppDefinition`  [EXTRACTED]
  src/apps/privateApps.ts → src/apps/types.ts
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (204 total, 30 thin omitted)

### Community 0 - "installations.ts"
Cohesion: 0.08
Nodes (41): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installationPublic(), installations, listInstallations(), markInstallationTested() (+33 more)

### Community 1 - "sourceChange.ts"
Cohesion: 0.11
Nodes (40): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), RoutineSource, STEP_SOURCE, executeStep() (+32 more)

### Community 2 - "agentRoutineRoutes.ts"
Cohesion: 0.13
Nodes (25): EventTriggerError, MarketTriggerPlan, SignalPlan, webhookEndpoint(), listAgentAutomations(), listRoutines(), readSourceFromDefinition(), RoutineError (+17 more)

### Community 3 - "whatsapp.ts"
Cohesion: 0.14
Nodes (18): ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter(), InboundMediaRef, InboundMessage (+10 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.05
Nodes (64): falha(), chunks, chunkText(), combineKnowledgeHits(), countDocumentsFromSource(), countUnindexedFor(), createDocument(), createDocumentFor() (+56 more)

### Community 5 - "voyage.ts"
Cohesion: 0.06
Nodes (46): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, BudgetDenial (+38 more)

### Community 6 - "src/index.ts"
Cohesion: 0.03
Nodes (69): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), app, AVATAR_MIME_TYPES (+61 more)

### Community 7 - "openai.ts"
Cohesion: 0.07
Nodes (67): runResolvedTool(), anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL, extractIdentity() (+59 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (51): roleUIConfigOf(), sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, agents, AgentSourceSettings, AgentTool, AgentToolHeader (+43 more)

### Community 9 - "grants.ts"
Cohesion: 0.13
Nodes (31): missingCapability(), AMBIENTES_BLOQUEADOS, ConnectionProblem, ConnectionRefusal, environmentOf(), interpolar(), resolveConnection(), ResolvedConnection (+23 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.08
Nodes (33): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetSpec(), suggestPresetForCapability(), agentReadiness(), AgentWiring (+25 more)

### Community 11 - "refreshMemoryAndIdentity"
Cohesion: 0.11
Nodes (27): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+19 more)

### Community 12 - "routine.ts"
Cohesion: 0.13
Nodes (50): StepCondition, buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), emptyMarketPlan(), emptySignalPlan(), EventTriggerSpec, getEventTriggerForAgent() (+42 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.08
Nodes (31): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentBubbleState, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail (+23 more)

### Community 14 - "delegation.ts"
Cohesion: 0.08
Nodes (42): AgentOutputFormat, ClarificationRequest, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, policyAllows() (+34 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.03
Nodes (29): FLOOR, PAGE, recebido, OPCOES, AGENTE, SETOR, ANDAR, PREDIO (+21 more)

### Community 16 - "apps/types.ts"
Cohesion: 0.09
Nodes (24): ALPACA_DOMAINS, manifest, native(), num(), schema(), str(), manifest, manifest (+16 more)

### Community 17 - "googleCalendar.ts"
Cohesion: 0.13
Nodes (20): adapters, manifest, buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), SCOPES (+12 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (55): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+47 more)

### Community 19 - "floorCommunication.ts"
Cohesion: 0.19
Nodes (13): buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode, FloorLink (+5 more)

### Community 20 - "alpaca/adapter.ts"
Cohesion: 0.13
Nodes (24): alpacaTools(), buildAlpacaTools(), conta(), num(), numeroOuNulo(), ordem(), ordemBase(), posicao() (+16 more)

### Community 21 - "streams/service.ts"
Cohesion: 0.12
Nodes (23): listEvents(), streamRouter, countStreams(), findStream(), listResumableStreams(), listStreams(), listStreamsForInstallation(), setStreamPaused() (+15 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentEvents.ts"
Cohesion: 0.09
Nodes (28): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, events, finalizeAgentEvent(), finalizeAgentEventSafe() (+20 more)

### Community 24 - "runAgentTask"
Cohesion: 0.10
Nodes (24): AgentRole, capabilitiesOf(), POR_PRESET, ROLE_LABEL, RoleCapabilities, roleOf(), RoleSection, RoleUIConfig (+16 more)

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

### Community 30 - "privateApps.ts"
Cohesion: 0.10
Nodes (32): describeManifestIssues(), exportableManifest(), FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest() (+24 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.14
Nodes (19): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+11 more)

### Community 32 - "db"
Cohesion: 0.12
Nodes (27): ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), ensureSourceCheckpointIndexes(), ensureBuildingIndexes() (+19 more)

### Community 33 - "connections/service.ts"
Cohesion: 0.21
Nodes (11): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, decryptConfig(), getConnection(), isNonEmpty(), normalizeName(), patchConnection() (+3 more)

### Community 35 - "connections/repository.ts"
Cohesion: 0.09
Nodes (18): chunkTelegram(), FetchImpl, MailTransport, maskDestination(), sendEmail(), sendTelegram(), connections, deliveries (+10 more)

### Community 36 - "validate.ts"
Cohesion: 0.17
Nodes (21): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), canonical() (+13 more)

### Community 37 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

### Community 38 - "tools.ts"
Cohesion: 0.06
Nodes (38): joinPath(), ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets() (+30 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.12
Nodes (20): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+12 more)

### Community 41 - "auditMiddleware.ts"
Cohesion: 0.15
Nodes (16): AuditAction, AuditEntityType, recordAudit(), safeMetadata(), entityLabelWithOwner(), MAX_LABEL_CHARS, normalizeLabel(), resolveEntityLabels() (+8 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.11
Nodes (13): acaoDeCandles, AGENT, APP_EM_BREVE, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO (+5 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "dispatcher.ts"
Cohesion: 0.07
Nodes (53): checkStageOutput(), conferirEntrada(), conferirSaida(), dispatchAgentExecution(), DispatchDeps, falha(), fromLlmResult(), LlmRunner (+45 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "bus.ts"
Cohesion: 0.11
Nodes (20): backoffMs(), completeEvent(), deadLetter(), EVENT_LEASE_MS, EVENT_TTL_MS, EventHandler, events, eventsCollection (+12 more)

### Community 47 - "routineExecution.ts"
Cohesion: 0.11
Nodes (24): RecordAgentEventInput, catalogIndex(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail(), ToolTrace, AgentExecutionRequest (+16 more)

### Community 48 - "builtinTools.ts"
Cohesion: 0.07
Nodes (32): adapters, manifest, MODULES, OFFICIAL_ADAPTERS, OFFICIAL_APPS, OfficialAppsError, OfficialModule, adapters (+24 more)

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

### Community 58 - "manager.ts"
Cohesion: 0.14
Nodes (13): HEARTBEAT_MS, MAX_TENTATIVAS, naoLoga(), SILENCIO_MS, SocketFactory, StreamManager, StreamSocket, Vivo (+5 more)

### Community 59 - "listRunTimeline"
Cohesion: 0.20
Nodes (16): agentConstraint(), agentIdsInSector(), automationFilter(), averageTokens(), decodeRunCursor(), encodeRunCursor(), listRunsForCenter(), listRunTimeline() (+8 more)

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

### Community 76 - "runService.ts"
Cohesion: 0.18
Nodes (18): createLiveTracker(), findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, advanceFrom(), catchUp(), nextFireAt() (+10 more)

### Community 77 - "executionTrace.ts"
Cohesion: 0.15
Nodes (13): CHAVES_SEGURAS, ExecutionTraceEvent, onTraceEvent(), readTrace(), recorte(), sanitize(), Sink, traceEvent() (+5 more)

### Community 78 - "seedRestaurantDemo.ts"
Cohesion: 0.24
Nodes (12): SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member(), OWNED_COLLECTIONS (+4 more)

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.07
Nodes (63): executeSectorTeam(), stageInstruction(), normalize(), adaptLegacyPlan(), assembleWithoutModel(), buildSynthesisContext(), clarificationFor(), CompiledPlan (+55 more)

### Community 85 - "webKnowledge.ts"
Cohesion: 0.06
Nodes (50): WatchedSource, browserRendererEnabled(), rendererAtivo(), feedFromHtml(), looksLikeContent(), DiscoveryPlan, DiscoveryProbe, ehFeed() (+42 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.19
Nodes (15): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+7 more)

### Community 97 - "adaptiveWebReader.ts"
Cohesion: 0.10
Nodes (38): aindaEsperando(), anotarEspera(), CABECALHOS, ehDocumentoXml(), emEspera, ExtractedLink, extrair(), linksDeXml() (+30 more)

### Community 98 - "floors.ts"
Cohesion: 0.12
Nodes (30): agentStatesForFloor(), buildingOverview(), floorMetrics, Building, BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE (+22 more)

### Community 99 - "functionRegistry.ts"
Cohesion: 0.09
Nodes (11): adaptadores, CONFIG_CASAS, DOC_SAIDA, FunctionAdapter, FunctionHandler, listPublicFunctions(), NUMEROS_SCHEMA, PublicFunction (+3 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "migration.ts"
Cohesion: 0.12
Nodes (27): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+19 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.10
Nodes (29): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+21 more)

### Community 103 - "automations/service.ts"
Cohesion: 0.12
Nodes (33): ensureActivationMode(), getAgentById(), createRoutine(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation() (+25 more)

### Community 104 - "Agent"
Cohesion: 0.12
Nodes (27): Agent, AgentModelFields, parseAgentModelFields(), GateTarget, AgentContract, AgentContractInput, agentContractOf(), contractFromFunction() (+19 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

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
Nodes (45): serializeSector(), AgentDoc, accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds() (+37 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "browserRenderer.ts"
Cohesion: 0.16
Nodes (16): BrowserRenderer, buscarPadrao(), ReaderPage, abrirNavegador(), esperarVaga(), fila, liberarVaga(), renderWithBrowser() (+8 more)

### Community 120 - "getSectorById"
Cohesion: 0.27
Nodes (11): listAgents(), bloqueiaSePrejudicaWidget(), resolveOwnedAgentId(), resolveOwnedSectorId(), resolverDestinoDoWidget(), getSectorById(), resolveWidgetDestination(), resolveRuntimeDestination() (+3 more)

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
Cohesion: 0.09
Nodes (31): adapters, manifest, alpacaStreamAdapter, CANDLE_SWEEP_MS, CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions (+23 more)

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
Cohesion: 0.17
Nodes (17): ABREV_EN, ABREV_PT, expandirData(), extractTerms(), extractWindow(), LexicalTerm, MES_EN, MES_PT (+9 more)

### Community 140 - "runner.ts"
Cohesion: 0.08
Nodes (30): AgentCall, delay(), DeliverCall, FetchResult, MemoryOps, runDefinition(), RunOutcome, SourceHalt (+22 more)

### Community 146 - "automations/repository.ts"
Cohesion: 0.13
Nodes (13): automations, findAutomation(), findByWebhookKey(), listActiveAutomations(), listActivePublished(), ListAutomationsQuery, versions, backfillSourceFingerprints() (+5 more)

### Community 147 - "audit.ts"
Cohesion: 0.12
Nodes (19): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditActorType, AuditEvent, AuditEventPublic, AuditFilters, AuditResult (+11 more)

### Community 150 - "clarify.ts"
Cohesion: 0.31
Nodes (7): CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarificationGuidance(), CLARIFY_LIMIT, clarifyBudgetSpent()

### Community 151 - "modelDefaults.ts"
Cohesion: 0.33
Nodes (4): ANTHROPIC_AUX_MODEL, ANTHROPIC_DEFAULT_MODEL, OPENAI_AUX_MODEL, OPENAI_DEFAULT_MODEL

### Community 152 - "routineExecutorPaths.integration.test.mjs"
Cohesion: 0.29
Nodes (4): agente(), ANDAR, DE_FUNCAO(), PREDIO

### Community 153 - "db.ts"
Cohesion: 0.09
Nodes (22): auth, clientUrl, config, isProduction, originList(), port, stripTrailingSlash(), urlVar() (+14 more)

### Community 155 - "appGrantRoutes.ts"
Cohesion: 0.15
Nodes (12): AgentAppGrant, AutomationVersion, ValidationError, appGrantRouter, automationRouter, connectionRouter, parseFilters(), fail() (+4 more)

### Community 156 - "marketData/engine.ts"
Cohesion: 0.07
Nodes (50): FEED, Candle, publishEvent(), CANDLE_RETENTION_DAYS, candles, candlesCollection, chave(), closeCandle() (+42 more)

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.22
Nodes (7): ANALISTA, COLETOR, COZINHA, EQUIPE, FINANCEIRO, JURIDICO, TIME

### Community 159 - "streamManager.integration.test.mjs"
Cohesion: 0.14
Nodes (10): ADAPTER, app(), conectar(), gerente(), MANIFESTO, publicados, publicarFalso(), relogioFalso() (+2 more)

### Community 160 - "runProcessor.ts"
Cohesion: 0.12
Nodes (29): runEventKey(), publishedSourceFingerprint(), RunnerDeps, agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped() (+21 more)

### Community 161 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 162 - "webSearch/budget.ts"
Cohesion: 0.07
Nodes (41): agentSearchStats, BRAVE_FREE_MONTHLY_REQUESTS, ensureWebSearchIndexes(), eventos, ligado(), orcamento, recordSearchEvent(), releaseSearchRequest() (+33 more)

### Community 165 - "executionCenter.ts"
Cohesion: 0.11
Nodes (26): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, AgentRef, agents, AutomationDoc, automations, ExecutionPage (+18 more)

### Community 166 - "internalEvents.ts"
Cohesion: 0.29
Nodes (11): asString(), buildTriggerInput(), chainOf(), DEFAULT_SERIES_LENGTH, DispatchDeps, dispatchInternalEvent(), internalTriggerOf(), matchesInternalTrigger() (+3 more)

### Community 171 - "webKnowledge.integration.test.mjs"
Cohesion: 0.23
Nodes (12): agenteComSite(), artigosNoFeed, comBootstrap(), comFeed(), criarAgente(), depsDoRuntime(), pedidos, rodar() (+4 more)

### Community 172 - "agentRuntime.ts"
Cohesion: 0.12
Nodes (26): enforceOutputContract(), AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+18 more)

### Community 175 - "executorAudit.integration.test.mjs"
Cohesion: 0.30
Nodes (11): agente(), ANDAR, CALCULADORA(), COLETOR(), ctx(), deps(), doTipo(), eventos() (+3 more)

### Community 177 - "delegationWiring.ts"
Cohesion: 0.07
Nodes (45): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), resolveAgentTools(), formatOptions() (+37 more)

### Community 178 - "agentRoleRuntime.integration.test.mjs"
Cohesion: 0.52
Nodes (6): agenteCom(), bancada(), comBusca(), contexto(), nomes(), rodar()

### Community 182 - "internalEventTrigger.integration.test.mjs"
Cohesion: 0.18
Nodes (9): ACAO_ANALISE, AGENT, BUILDING, FLOOR, INSTALACAO, K, specComSinal(), specDeMercado() (+1 more)

### Community 183 - "llm.ts"
Cohesion: 0.09
Nodes (30): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, getWidgetConfigAgent(), inboundMediaToText(), askAux(), auxiliaryModel(), checkGuardrail(), defaultModel() (+22 more)

### Community 184 - "floorWork.ts"
Cohesion: 0.31
Nodes (8): DELEGATION_MAX_DEPTH, Floor, agents, competencyOf(), effectiveTargets(), FloorTarget, floorWorkOverview, sectors

### Community 185 - "dependenciasDeclaradas.test.mjs"
Cohesion: 0.25
Nodes (4): declaradas, nativos, pkg, raiz

### Community 187 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

### Community 190 - "planCompiler.test.mjs"
Cohesion: 0.29
Nodes (4): CHEFE, COLETOR, EQUIPE, RISCO

### Community 196 - "executionRoutes.ts"
Cohesion: 0.20
Nodes (7): EXECUTION_TABS, ExecutionFilters, ExecutionTab, RunTimelineFilters, AnalyticsPeriod, ANALYTICS_PERIODS, executionRouter

### Community 203 - "connectionProfile.integration.test.mjs"
Cohesion: 0.40
Nodes (4): app(), conectar(), MANIFESTO, semConexao

### Community 204 - "executorRegressions.integration.test.mjs"
Cohesion: 0.16
Nodes (6): ANDAR, PREDIO, ANDAR, ESPERADO, PREDIO, VALORES

### Community 205 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

## Knowledge Gaps
- **839 isolated node(s):** `AppActionEvent`, `appActionEvents`, `installations`, `CreateInstallationInput`, `TRADING_BASE` (+834 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `site()` connect `webKnowledge.ts` to `sourceTool.integration.test.mjs`?**
  _High betweenness centrality (0.125) - this node is a cross-community bridge._
- **Why does `ensureAgentWebKnowledgeFresh()` connect `webKnowledge.ts` to `delegationWiring.ts`, `agentRoutineRoutes.ts`, `automations/service.ts`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **What connects `AppActionEvent`, `appActionEvents`, `installations` to the rest of the system?**
  _839 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `installations.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0783673469387755 - nodes in this community are weakly interconnected._
- **Should `sourceChange.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1072463768115942 - nodes in this community are weakly interconnected._
- **Should `agentRoutineRoutes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12535612535612536 - nodes in this community are weakly interconnected._