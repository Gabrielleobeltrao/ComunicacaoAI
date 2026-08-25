# Graph Report - backend  (2026-08-25)

## Corpus Check
- 374 files · ~442,880 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3331 nodes · 7721 edges · 214 communities (181 shown, 33 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 59 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ee24a399`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- navigation.ts
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
- apps/types.ts
- googleCalendar.ts
- patterns.ts
- floorCommunication.ts
- connections/repository.ts
- streams/service.ts
- dependencies
- agentEvents.ts
- installations.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- privateApps.ts
- runRepository.ts
- migrate.ts
- modelCache.ts
- sourceMonitoring.test.mjs
- runProcessor.ts
- validate.ts
- agentTools.ts
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
- automations/engine.ts
- logHygiene.test.mjs
- sourceCheckpoint.integration.test.mjs
- cron-parser
- scopeCache.ts
- sourceTool.integration.test.mjs
- timeoutCancellation.test.mjs
- step.ts
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
- appInstallationRoutes.ts
- marketData/engine.ts
- sectorPlanner.test.mjs
- scopeGate.test.mjs
- streamManager.integration.test.mjs
- official/index.ts
- safeError.ts
- webSearch/budget.ts
- adaptiveWebReader.test.mjs
- executionCenter.ts
- AppDefinition
- publicWidgetRoutes.integration.test.mjs
- toolsSecurity.test.mjs
- webSourcePolicy.test.mjs
- webKnowledge.integration.test.mjs
- llm.ts
- browserRenderer.ts
- executorAudit.integration.test.mjs
- delegationWiring.ts
- agentRoleRuntime.integration.test.mjs
- executorDispatcher.test.mjs
- agentCapabilities.ts
- userSettings.ts
- sectorAccess.ts
- dependenciasDeclaradas.test.mjs
- sectorBriefing.ts
- validateAgainstSchema
- runService.ts
- planCompiler.test.mjs
- sourceSsrf.test.mjs
- executionRoutes.ts
- floorWork.ts
- knowledgeIsolation.integration.test.mjs
- executorHardening.test.mjs
- toolExecutor.ts
- playgroundSession.ts
- memory.ts
- jsonSchema.ts
- migrationFixture.integration.test.mjs
- researcherWebResearch.integration.test.mjs
- marketData.integration.test.mjs
- tokensByModel.integration.test.mjs
- audit.integration.test.mjs
- sectorMembersFromStages.integration.test.mjs
- email/manifest.ts
- telegram/manifest.ts
- web-chat/manifest.ts

## God Nodes (most connected - your core abstractions)
1. `startMongo()` - 65 edges
2. `stopMongo()` - 65 edges
3. `respondWithAgentIfLinked()` - 60 edges
4. `db` - 59 edges
5. `executeSectorTeam()` - 44 edges
6. `buildDeps()` - 40 edges
7. `getAgentById()` - 36 edges
8. `productionDelegationDeps()` - 33 edges
9. `Agent` - 30 edges
10. `runMigrations()` - 28 edges

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

## Communities (214 total, 33 thin omitted)

### Community 0 - "navigation.ts"
Cohesion: 0.12
Nodes (22): installationPublic(), listInstallations(), toInstallation(), buildNavigation(), dropPinsForApp(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp (+14 more)

### Community 1 - "sourceChange.ts"
Cohesion: 0.09
Nodes (47): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), RoutineSource, executeStep(), chaveDoItem() (+39 more)

### Community 2 - "agentRoutineRoutes.ts"
Cohesion: 0.14
Nodes (24): getAgentById(), normalizeCondition(), webhookEndpoint(), listAgentAutomations(), listRoutines(), readSourceFromDefinition(), RoutineError, STEP_SOURCE (+16 more)

### Community 3 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.06
Nodes (52): chunks, chunkText(), combineKnowledgeHits(), countDocumentsFromSource(), countUnindexedFor(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent() (+44 more)

### Community 5 - "voyage.ts"
Cohesion: 0.06
Nodes (46): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, BudgetDenial (+38 more)

### Community 6 - "src/index.ts"
Cohesion: 0.03
Nodes (76): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), aplicarContratoDeFerramenta(), app (+68 more)

### Community 7 - "openai.ts"
Cohesion: 0.09
Nodes (56): runResolvedTool(), anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL, extractIdentity() (+48 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (49): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, agents, AgentSourceSettings, AgentTool, AgentToolHeader, AgentToolParam (+41 more)

### Community 9 - "grants.ts"
Cohesion: 0.12
Nodes (34): missingCapability(), AMBIENTES_BLOQUEADOS, ConnectionProblem, ConnectionRefusal, environmentOf(), interpolar(), resolveConnection(), ResolvedConnection (+26 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (25): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetSpec(), suggestPresetForCapability(), agentReadiness(), AgentWiring (+17 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.06
Nodes (50): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+42 more)

### Community 12 - "routine.ts"
Cohesion: 0.12
Nodes (50): ensureActivationMode(), StepCondition, buildEventTriggerDefinition(), describeEventTriggerFlow(), EventTriggerError, EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger() (+42 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.08
Nodes (32): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+24 more)

### Community 14 - "delegation.ts"
Cohesion: 0.08
Nodes (48): AgentOutputFormat, ClarificationRequest, checkCollaboration(), agentCard(), asOutputFormat(), buildDelegationTools(), CapabilityMissing, checkDelegation() (+40 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.03
Nodes (31): FLOOR, recebido, OPCOES, AGENTE, SETOR, app(), conectar(), MANIFESTO (+23 more)

### Community 16 - "apps/types.ts"
Cohesion: 0.10
Nodes (27): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+19 more)

### Community 17 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (14): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse, deleteIntegration() (+6 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (55): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+47 more)

### Community 19 - "floorCommunication.ts"
Cohesion: 0.17
Nodes (13): Building, buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode (+5 more)

### Community 20 - "connections/repository.ts"
Cohesion: 0.11
Nodes (13): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), connections, deliveries, listDeliveries(), sentDeliveriesByAgent() (+5 more)

### Community 21 - "streams/service.ts"
Cohesion: 0.07
Nodes (34): listEvents(), streamRouter, HEARTBEAT_MS, ManagerDeps, MAX_TENTATIVAS, SILENCIO_MS, SocketFactory, Vivo (+26 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentEvents.ts"
Cohesion: 0.09
Nodes (28): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, events, finalizeAgentEvent(), finalizeAgentEventSafe() (+20 more)

### Community 24 - "installations.ts"
Cohesion: 0.12
Nodes (23): createInstallation(), CreateInstallationInput, installations, normalizeConfig(), normalizeEnvironment(), normalizeName(), patchInstallation(), PatchInstallationInput (+15 more)

### Community 25 - "records.ts"
Cohesion: 0.08
Nodes (50): readPath(), clarificationKey(), ClarifyMemoryTarget, recallClarifications(), rememberClarification(), assertAgentMayWrite(), floors, MemoryAccessError (+42 more)

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
Cohesion: 0.13
Nodes (23): describeManifestIssues(), exportableManifest(), archivePrivateApp(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listAppsForOwner() (+15 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.13
Nodes (18): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+10 more)

### Community 32 - "migrate.ts"
Cohesion: 0.11
Nodes (28): ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes() (+20 more)

### Community 33 - "modelCache.ts"
Cohesion: 0.29
Nodes (9): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), humanizeModelId(), isChatModel() (+1 more)

### Community 35 - "runProcessor.ts"
Cohesion: 0.17
Nodes (23): runEventKey(), findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped() (+15 more)

### Community 36 - "validate.ts"
Cohesion: 0.17
Nodes (20): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), STEP_TYPES (+12 more)

### Community 37 - "agentTools.ts"
Cohesion: 0.10
Nodes (11): legacyToolToExecutable(), MAX_TOOL_ITERATIONS, resolveHttpTool(), ToolCallRecord, toolInputSchema(), AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL (+3 more)

### Community 38 - "tools.ts"
Cohesion: 0.09
Nodes (22): clamp(), createTool(), deleteTool(), getTool(), headersDe(), listTools(), normalize(), TOOL_AUTH_KINDS (+14 more)

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
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "dispatcher.ts"
Cohesion: 0.16
Nodes (15): conferirEntrada(), conferirSaida(), dispatchAgentExecution(), DispatchDeps, falha(), fromLlmResult(), LlmRunner, semConfiguracao() (+7 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "bus.ts"
Cohesion: 0.11
Nodes (20): backoffMs(), claimNextEvent(), completeEvent(), deadLetter(), EVENT_LEASE_MS, EVENT_TTL_MS, EventHandler, events (+12 more)

### Community 47 - "routineExecution.ts"
Cohesion: 0.12
Nodes (25): RecordAgentEventInput, AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail() (+17 more)

### Community 48 - "builtinTools.ts"
Cohesion: 0.14
Nodes (18): adapters, manifest, adapters, manifest, APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide (+10 more)

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

### Community 76 - "scheduler.ts"
Cohesion: 0.24
Nodes (12): advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes(), planSchedules() (+4 more)

### Community 77 - "executionTrace.ts"
Cohesion: 0.15
Nodes (13): CHAVES_SEGURAS, ExecutionTraceEvent, onTraceEvent(), readTrace(), recorte(), sanitize(), Sink, traceEvent() (+5 more)

### Community 78 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.07
Nodes (59): executeSectorTeam(), stageInstruction(), RESPONSE_MODES, adaptLegacyPlan(), assembleWithoutModel(), buildSynthesisContext(), clarificationFor(), CompiledPlan (+51 more)

### Community 85 - "webKnowledge.ts"
Cohesion: 0.07
Nodes (45): WatchedSource, feedFromHtml(), looksLikeContent(), DiscoveryPlan, DiscoveryProbe, ehFeed(), planDiscovery(), urlsFromFeed() (+37 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.21
Nodes (14): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+6 more)

### Community 97 - "adaptiveWebReader.ts"
Cohesion: 0.10
Nodes (40): aindaEsperando(), anotarEspera(), buscarPadrao(), CABECALHOS, ehDocumentoXml(), emEspera, ExtractedLink, extrair() (+32 more)

### Community 98 - "floors.ts"
Cohesion: 0.12
Nodes (30): agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE, ensureDefaultBuilding() (+22 more)

### Community 99 - "functionRegistry.ts"
Cohesion: 0.07
Nodes (19): comLimite(), executeRegisteredFunction(), falha(), TEXTO_NAO_PRODUZIDO, adaptadores, CONFIG_CASAS, DOC_SAIDA, ErroDeFuncao (+11 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "migration.ts"
Cohesion: 0.16
Nodes (21): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+13 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.09
Nodes (29): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolveRunOptions (+21 more)

### Community 103 - "automations/service.ts"
Cohesion: 0.13
Nodes (27): createEventTrigger(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName() (+19 more)

### Community 104 - "Agent"
Cohesion: 0.15
Nodes (23): Agent, AgentModelFields, parseAgentModelFields(), AgentContract, AgentContractInput, agentContractOf(), contractFromFunction(), ContractParseResult (+15 more)

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
Cohesion: 0.07
Nodes (50): callerPolicyFromLegacy(), CollaboratorCandidate, reachableCollaborators(), SectorCandidate, listAgents(), collaboratorContext, collaboratorCountFor(), bloqueiaSePrejudicaWidget() (+42 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "toolExecution.ts"
Cohesion: 0.15
Nodes (16): joinPath(), ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets() (+8 more)

### Community 120 - "db.ts"
Cohesion: 0.18
Nodes (9): auth, db, mongoClient, AgentDoc, aggregateSectorDecisions(), listSectorDecisionsForConversation(), SectorDecision, SectorDecisionAggregate (+1 more)

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
Cohesion: 0.13
Nodes (22): CANDLE_SWEEP_MS, CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, EVENT_BATCH, EVENT_POLL_MS (+14 more)

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

### Community 137 - "step.ts"
Cohesion: 0.09
Nodes (37): ABREV_EN, ABREV_PT, expandirData(), extractTerms(), extractWindow(), LexicalTerm, MES_EN, MES_PT (+29 more)

### Community 140 - "runner.ts"
Cohesion: 0.07
Nodes (32): AgentCall, delay(), DeliverCall, FetchResult, MemoryOps, runDefinition(), RunnerDeps, RunOutcome (+24 more)

### Community 146 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+4 more)

### Community 147 - "audit.ts"
Cohesion: 0.12
Nodes (19): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditActorType, AuditEvent, AuditEventPublic, AuditFilters, AuditResult (+11 more)

### Community 150 - "clarify.ts"
Cohesion: 0.27
Nodes (8): clarificationFrom(), CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarificationGuidance(), CLARIFY_LIMIT, clarifyBudgetSpent()

### Community 151 - "googleTools.ts"
Cohesion: 0.33
Nodes (7): adapters, manifest, getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 152 - "routineExecutorPaths.integration.test.mjs"
Cohesion: 0.29
Nodes (4): agente(), ANDAR, DE_FUNCAO(), PREDIO

### Community 153 - "config.ts"
Cohesion: 0.21
Nodes (11): clientUrl, config, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig() (+3 more)

### Community 155 - "appInstallationRoutes.ts"
Cohesion: 0.12
Nodes (16): deleteInstallation(), markInstallationTested(), ValidationError, CONNECTION_CATALOG, Connection, appGrantRouter, appInstallationRouter, auditEntity() (+8 more)

### Community 156 - "marketData/engine.ts"
Cohesion: 0.07
Nodes (51): Candle, onEvent(), publishEvent(), CANDLE_RETENTION_DAYS, candles, candlesCollection, chave(), closeCandle() (+43 more)

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.22
Nodes (7): ANALISTA, COLETOR, COZINHA, EQUIPE, FINANCEIRO, JURIDICO, TIME

### Community 159 - "streamManager.integration.test.mjs"
Cohesion: 0.14
Nodes (10): ADAPTER, app(), conectar(), gerente(), MANIFESTO, publicados, publicarFalso(), relogioFalso() (+2 more)

### Community 160 - "official/index.ts"
Cohesion: 0.11
Nodes (14): adapters, manifest, MODULES, OFFICIAL_ADAPTERS, OfficialAppsError, OfficialModule, adapters, manifest (+6 more)

### Community 161 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 162 - "webSearch/budget.ts"
Cohesion: 0.10
Nodes (26): safeFetch(), agentSearchStats, BRAVE_FREE_MONTHLY_REQUESTS, eventos, ligado(), orcamento, recordSearchEvent(), releaseSearchRequest() (+18 more)

### Community 165 - "executionCenter.ts"
Cohesion: 0.11
Nodes (26): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, AgentRef, agents, AutomationDoc, automations, ExecutionPage (+18 more)

### Community 166 - "AppDefinition"
Cohesion: 0.53
Nodes (5): native(), num(), schema(), str(), AppDefinition

### Community 171 - "webKnowledge.integration.test.mjs"
Cohesion: 0.23
Nodes (12): agenteComSite(), artigosNoFeed, comBootstrap(), comFeed(), criarAgente(), depsDoRuntime(), pedidos, rodar() (+4 more)

### Community 172 - "llm.ts"
Cohesion: 0.11
Nodes (29): enforceOutputContract(), ResolvedAgentRun, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), executeAgentTask() (+21 more)

### Community 174 - "browserRenderer.ts"
Cohesion: 0.15
Nodes (17): BrowserRenderer, ReaderPage, abrirNavegador(), browserRendererEnabled(), esperarVaga(), fila, liberarVaga(), rendererAtivo() (+9 more)

### Community 175 - "executorAudit.integration.test.mjs"
Cohesion: 0.30
Nodes (11): agente(), ANDAR, CALCULADORA(), COLETOR(), ctx(), deps(), doTipo(), eventos() (+3 more)

### Community 177 - "delegationWiring.ts"
Cohesion: 0.08
Nodes (37): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), resolveAgentTools(), agentCanDelegate() (+29 more)

### Community 178 - "agentRoleRuntime.integration.test.mjs"
Cohesion: 0.52
Nodes (6): agenteCom(), bancada(), comBusca(), contexto(), nomes(), rodar()

### Community 182 - "agentCapabilities.ts"
Cohesion: 0.20
Nodes (10): AgentRole, capabilitiesOf(), POR_PRESET, ROLE_LABEL, RoleCapabilities, roleOf(), RoleSection, RoleUIConfig (+2 more)

### Community 183 - "userSettings.ts"
Cohesion: 0.15
Nodes (12): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, Provider, transcribeImage(), clearProviderApiKey(), FIELD_BY_PROVIDER, getMonthlyTokenCap(), getProviderKeyStatus() (+4 more)

### Community 184 - "sectorAccess.ts"
Cohesion: 0.22
Nodes (12): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+4 more)

### Community 185 - "dependenciasDeclaradas.test.mjs"
Cohesion: 0.25
Nodes (4): declaradas, nativos, pkg, raiz

### Community 187 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

### Community 188 - "validateAgainstSchema"
Cohesion: 0.17
Nodes (16): checkJson(), parseJsonOutput(), checkStageOutput(), assertRegistryIsSound(), describeStepError(), finishStep(), prepareStepInput(), primeiros() (+8 more)

### Community 189 - "runService.ts"
Cohesion: 0.36
Nodes (9): createLiveTracker(), findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, AutomationRun, TriggerType, runExecutionKey() (+1 more)

### Community 190 - "planCompiler.test.mjs"
Cohesion: 0.29
Nodes (4): CHEFE, COLETOR, EQUIPE, RISCO

### Community 196 - "executionRoutes.ts"
Cohesion: 0.20
Nodes (7): EXECUTION_TABS, ExecutionFilters, ExecutionTab, RunTimelineFilters, AnalyticsPeriod, ANALYTICS_PERIODS, executionRouter

### Community 197 - "floorWork.ts"
Cohesion: 0.16
Nodes (13): CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows(), DELEGATION_MAX_DEPTH, FloorCommunicationConfig (+5 more)

### Community 201 - "toolExecutor.ts"
Cohesion: 0.36
Nodes (9): comLimite(), escolherAcao(), executeAgentTool(), falha(), normalizar(), TIMEOUT_PADRAO_MS, traduzirExcecao(), ToolExecutorConfig (+1 more)

### Community 202 - "playgroundSession.ts"
Cohesion: 0.25
Nodes (8): guardarTurnoDeTeste(), appendPlaygroundTurns(), clearPlaygroundTurns(), cortar(), loadPlaygroundTurns(), PlaygroundSession, PlaygroundTurn, sessions

### Community 203 - "memory.ts"
Cohesion: 0.36
Nodes (8): findBySourceRef(), touchWebDocument(), updateDocument(), updateDocumentFor(), canonicalizeUrl(), RememberOutcome, rememberSearchPages(), searchDocRef()

### Community 204 - "jsonSchema.ts"
Cohesion: 0.39
Nodes (7): join(), matchesType(), Schema, SchemaError, typeOf(), validateNode(), ValidationResult

### Community 205 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 208 - "tokensByModel.integration.test.mjs"
Cohesion: 0.40
Nodes (3): AGENTE, ANDAR, ONTEM

## Knowledge Gaps
- **821 isolated node(s):** `RUN_POLL_MS`, `SCHEDULER_POLL_MS`, `CONCURRENCY`, `LEASE_RENEW_MS`, `EVENT_POLL_MS` (+816 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **33 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ensureAgentWebKnowledgeFresh()` connect `agentRoutineRoutes.ts` to `delegationWiring.ts`, `automations/engine.ts`, `webKnowledge.ts`, `sourceTool.integration.test.mjs`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **Why does `site()` connect `sourceTool.integration.test.mjs` to `agentRoutineRoutes.ts`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `mongoServer.mjs`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **What connects `RUN_POLL_MS`, `SCHEDULER_POLL_MS`, `CONCURRENCY` to the rest of the system?**
  _821 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `navigation.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12333333333333334 - nodes in this community are weakly interconnected._
- **Should `sourceChange.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08944793850454227 - nodes in this community are weakly interconnected._
- **Should `agentRoutineRoutes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13666666666666666 - nodes in this community are weakly interconnected._