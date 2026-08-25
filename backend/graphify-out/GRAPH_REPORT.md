# Graph Report - backend  (2026-08-24)

## Corpus Check
- 358 files · ~427,871 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3141 nodes · 7280 edges · 214 communities (181 shown, 33 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6e5191df`
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
- eventTrigger.ts
- agentLiveState.ts
- delegation.ts
- mongoServer.mjs
- apps/types.ts
- googleCalendar.ts
- patterns.ts
- floorCommunication.ts
- connections/service.ts
- privateApps.ts
- dependencies
- agentMetrics.ts
- agentEvents.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- getAgentById
- runRepository.ts
- migrate.ts
- modelCache.ts
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
- toolExecutor.ts
- package.json
- sectorAccess.ts
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
- systemPrompt.ts
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
- agentTools.ts
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
- builtinTools.ts
- routineExecutorPaths.integration.test.mjs
- config.ts
- appInstallationRoutes.ts
- connections/repository.ts
- sectorPlanner.test.mjs
- scopeGate.test.mjs
- webSourcePolicy.ts
- official/index.ts
- safeError.ts
- webSearch/budget.ts
- adaptiveWebReader.test.mjs
- executionCenter.ts
- publicWidgetRoutes.integration.test.mjs
- toolsSecurity.test.mjs
- webSourcePolicy.test.mjs
- webKnowledge.integration.test.mjs
- agentRuntime.ts
- browserRenderer.ts
- executorAudit.integration.test.mjs
- delegationWiring.ts
- agentRoleRuntime.integration.test.mjs
- executorDispatcher.test.mjs
- migrationFixture.integration.test.mjs
- llm.ts
- researcherWebResearch.integration.test.mjs
- dependenciasDeclaradas.test.mjs
- sectorBriefing.ts
- validateAgainstSchema
- executorIntegrationGaps.integration.test.mjs
- planCompiler.test.mjs
- sourceSsrf.test.mjs
- sourceCheckpoint.ts
- Agent
- executionTrace.ts
- executorHardening.test.mjs
- logRoutes.ts
- AppDefinition
- dispatcher.ts
- sectorMembership.ts
- delegationLog.ts
- playgroundSession.ts
- connectionProfile.integration.test.mjs
- functionAgentLifecycle.e2e.test.mjs
- hubspot/adapter.ts
- slack/adapter.ts
- email/manifest.ts
- web-chat/manifest.ts
- whatsapp/manifest.ts

## God Nodes (most connected - your core abstractions)
1. `startMongo()` - 62 edges
2. `stopMongo()` - 62 edges
3. `respondWithAgentIfLinked()` - 60 edges
4. `db` - 54 edges
5. `executeSectorTeam()` - 44 edges
6. `buildDeps()` - 40 edges
7. `getAgentById()` - 36 edges
8. `productionDelegationDeps()` - 33 edges
9. `Agent` - 30 edges
10. `validateAgainstSchema()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `ensureAgentWebKnowledgeFresh()` --indirect_call--> `site()`  [INFERRED]
  src/webKnowledge.ts → test/sourceTool.integration.test.mjs
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `PrivateAppDoc` --references--> `AppDefinition`  [EXTRACTED]
  src/apps/privateApps.ts → src/apps/types.ts
- `resolveAgentTools()` --indirect_call--> `resolveHttpTool()`  [INFERRED]
  src/builtinTools.ts → src/agentTools.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (214 total, 33 thin omitted)

### Community 0 - "installations.ts"
Cohesion: 0.09
Nodes (33): createInstallation(), CreateInstallationInput, deleteInstallation(), installationPublic(), installations, LEGACY_APP_VERSION, listInstallations(), markInstallationTested() (+25 more)

### Community 1 - "sourceChange.ts"
Cohesion: 0.12
Nodes (35): listAgentAutomations(), listRoutines(), RoutineSource, STEP_SOURCE, executeStep(), strip(), templateVars(), chaveDoItem() (+27 more)

### Community 2 - "agentRoutineRoutes.ts"
Cohesion: 0.14
Nodes (34): StepCondition, EventTriggerError, EventTriggerSpec, webhookEndpoint(), AppActionPlan, MemoryPlan, createRoutine(), normalizeSource() (+26 more)

### Community 3 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.05
Nodes (61): falha(), chunks, chunkText(), combineKnowledgeHits(), countDocumentsFromSource(), countUnindexedFor(), createDocument(), createDocumentFor() (+53 more)

### Community 5 - "voyage.ts"
Cohesion: 0.06
Nodes (46): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, BudgetDenial (+38 more)

### Community 6 - "src/index.ts"
Cohesion: 0.04
Nodes (41): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), formatOptions(), resolveChoice() (+33 more)

### Community 7 - "openai.ts"
Cohesion: 0.08
Nodes (53): runResolvedTool(), anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL, extractIdentity() (+45 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (66): AgentRole, POR_PRESET, ROLE_LABEL, RoleCapabilities, roleOf(), RoleSection, RoleUIConfig, roleUIConfigOf() (+58 more)

### Community 9 - "grants.ts"
Cohesion: 0.12
Nodes (34): missingCapability(), AMBIENTES_BLOQUEADOS, ConnectionProblem, ConnectionRefusal, environmentOf(), interpolar(), joinPath(), resolveConnection() (+26 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.11
Nodes (24): agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate, EMPTY_WIRING, ISSUE, normalizeActivation(), NormalizedActivation (+16 more)

### Community 11 - "refreshMemoryAndIdentity"
Cohesion: 0.11
Nodes (27): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+19 more)

### Community 12 - "eventTrigger.ts"
Cohesion: 0.19
Nodes (29): buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), normalizeCondition(), readEventTriggerConfig() (+21 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.09
Nodes (28): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+20 more)

### Community 14 - "delegation.ts"
Cohesion: 0.08
Nodes (42): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, ClarificationRequest, checkCollaboration(), agentCard(), asOutputFormat(), buildCapabilityMissing() (+34 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.04
Nodes (25): FLOOR, PAGE, recebido, OPCOES, AGENTE, SETOR, CRIADORES, startMongo() (+17 more)

### Community 16 - "apps/types.ts"
Cohesion: 0.11
Nodes (15): manifest, APP_ACTIVATIONS, APP_AVAILABILITIES, APP_ENVIRONMENTS, AppActionExecution, AppAuthDefinition, AppAuthField, AppAuthKind (+7 more)

### Community 17 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (14): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse, deleteIntegration() (+6 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "floorCommunication.ts"
Cohesion: 0.18
Nodes (14): Building, buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode (+6 more)

### Community 20 - "connections/service.ts"
Cohesion: 0.11
Nodes (23): chunkTelegram(), FetchImpl, MailTransport, maskDestination(), sendEmail(), sendTelegram(), CONNECTION_CATALOG, createConnection() (+15 more)

### Community 21 - "privateApps.ts"
Cohesion: 0.11
Nodes (30): describeManifestIssues(), exportableManifest(), FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest() (+22 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "agentEvents.ts"
Cohesion: 0.16
Nodes (13): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow (+5 more)

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

### Community 30 - "getAgentById"
Cohesion: 0.20
Nodes (14): getAgentById(), bloqueiaSePrejudicaWidget(), resolveOwnedAgentId(), resolveOwnedSectorId(), resolverDestinoDoWidget(), resolveSectorMembers(), resolveSectorTeamFields(), requireAgent() (+6 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.15
Nodes (16): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+8 more)

### Community 32 - "migrate.ts"
Cohesion: 0.12
Nodes (26): ensureAgentLiveStateIndexes(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), findAutomation(), ensureRunIndexes() (+18 more)

### Community 33 - "modelCache.ts"
Cohesion: 0.43
Nodes (6): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels()

### Community 35 - "runProcessor.ts"
Cohesion: 0.24
Nodes (16): agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact(), insertStepRun(), updateRun() (+8 more)

### Community 36 - "validate.ts"
Cohesion: 0.17
Nodes (20): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), STEP_TYPES (+12 more)

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
Cohesion: 0.12
Nodes (21): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+13 more)

### Community 41 - "widgets.ts"
Cohesion: 0.07
Nodes (31): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "toolExecutor.ts"
Cohesion: 0.15
Nodes (17): comLimite(), escolherAcao(), executeAgentTool(), falha(), normalizar(), TIMEOUT_PADRAO_MS, traduzirExcecao(), AgentExecutor (+9 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "sectorAccess.ts"
Cohesion: 0.22
Nodes (12): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+4 more)

### Community 47 - "routineExecution.ts"
Cohesion: 0.13
Nodes (21): capabilitiesOf(), AgentBubbleState, instrumentTools(), LiveTracker, executarPassoPorDespacho(), executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry() (+13 more)

### Community 48 - "providerApps.ts"
Cohesion: 0.25
Nodes (10): adapters, manifest, hubspotTools(), mercadoPagoTools(), num(), nuvemshopTools(), objectSchema(), rdStationTools() (+2 more)

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

### Community 58 - "systemPrompt.ts"
Cohesion: 0.11
Nodes (17): buildClarificationInstruction(), buildIdentityCaptureInstruction(), buildLanguageInstruction(), buildProactivityInstruction(), buildResponseStyleInstruction(), buildSystemPrompt(), buildSystemPromptParts(), DETAIL_INSTRUCTIONS (+9 more)

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
Cohesion: 0.25
Nodes (12): findVersion(), advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, planSchedules() (+4 more)

### Community 77 - "autoModel.ts"
Cohesion: 0.29
Nodes (7): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), auxModelFor()

### Community 78 - "seedRestaurantDemo.ts"
Cohesion: 0.24
Nodes (12): SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member(), OWNED_COLLECTIONS (+4 more)

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.07
Nodes (64): executeSectorTeam(), runWithRetry(), stageInstruction(), normalize(), adaptLegacyPlan(), assembleWithoutModel(), buildSynthesisContext(), clarificationFor() (+56 more)

### Community 85 - "webKnowledge.ts"
Cohesion: 0.10
Nodes (29): aindaEsperando(), anotarEspera(), readWebPage(), WatchedSource, feedFromHtml(), looksLikeContent(), DiscoveryPlan, DiscoveryProbe (+21 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.21
Nodes (14): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+6 more)

### Community 97 - "adaptiveWebReader.ts"
Cohesion: 0.11
Nodes (36): CABECALHOS, ehDocumentoXml(), emEspera, ExtractedLink, extrair(), linksDeXml(), READ_MODES, ReadMode (+28 more)

### Community 98 - "floors.ts"
Cohesion: 0.12
Nodes (30): agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE, ensureDefaultBuilding() (+22 more)

### Community 99 - "functionRegistry.ts"
Cohesion: 0.08
Nodes (19): comLimite(), executeRegisteredFunction(), falha(), TEXTO_NAO_PRODUZIDO, adaptadores, CONFIG_CASAS, DOC_SAIDA, ErroDeFuncao (+11 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "migration.ts"
Cohesion: 0.10
Nodes (33): catalogIndex(), LiveTrackerContext, NOOP_TRACKER, toolDetail(), ToolTrace, AgentBuiltinTool, agents, AppMigrationReport (+25 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.10
Nodes (30): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+22 more)

### Community 103 - "automations/service.ts"
Cohesion: 0.12
Nodes (31): ensureActivationMode(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition() (+23 more)

### Community 104 - "contract.ts"
Cohesion: 0.11
Nodes (26): AgentModelFields, AgentContract, AgentContractInput, agentContractOf(), contractFromFunction(), ContractParseResult, DEFAULT_EXECUTOR, EXECUTOR_KINDS (+18 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.17
Nodes (18): TokenUsage, dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage() (+10 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "sectorExecutions.ts"
Cohesion: 0.11
Nodes (23): PERIODS, requireSector(), sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions (+15 more)

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
Cohesion: 0.14
Nodes (22): createSector(), deleteSector(), enforceSingleMembership(), membersFromStages(), normalizeMembers(), normalizeSectorMode(), normalizeStages(), SECTOR_MODE_LABEL (+14 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "agentTools.ts"
Cohesion: 0.11
Nodes (22): AgentTool, legacyToolToExecutable(), MAX_TOOL_ITERATIONS, resolveHttpTool(), toolInputSchema(), decrypt(), getKey(), ExecutableTool (+14 more)

### Community 120 - "db.ts"
Cohesion: 0.11
Nodes (17): auth, db, mongoClient, AgentDoc, arg(), main(), SHOWCASE, aggregateSectorDecisions() (+9 more)

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
Cohesion: 0.17
Nodes (16): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+8 more)

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
Nodes (21): searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm (+13 more)

### Community 140 - "runner.ts"
Cohesion: 0.08
Nodes (29): AgentCall, delay(), DeliverCall, FetchResult, MemoryOps, runDefinition(), RunnerDeps, RunOutcome (+21 more)

### Community 146 - "automations/repository.ts"
Cohesion: 0.10
Nodes (19): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, insertRunIdempotent() (+11 more)

### Community 147 - "audit.ts"
Cohesion: 0.14
Nodes (22): AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditEvent, AuditEventPublic, decodeAuditCursor(), encodeAuditCursor(), events, listAuditEvents() (+14 more)

### Community 150 - "clarify.ts"
Cohesion: 0.27
Nodes (8): clarificationFrom(), CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarificationGuidance(), CLARIFY_LIMIT, clarifyBudgetSpent()

### Community 151 - "builtinTools.ts"
Cohesion: 0.18
Nodes (13): adapters, manifest, APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField (+5 more)

### Community 152 - "routineExecutorPaths.integration.test.mjs"
Cohesion: 0.29
Nodes (4): agente(), ANDAR, DE_FUNCAO(), PREDIO

### Community 153 - "config.ts"
Cohesion: 0.21
Nodes (11): clientUrl, config, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig() (+3 more)

### Community 155 - "appInstallationRoutes.ts"
Cohesion: 0.12
Nodes (15): dropPinsForApp(), ValidationError, appGrantRouter, appInstallationRouter, cleanUpPins(), auditEntity(), auditTargetFor(), matches() (+7 more)

### Community 156 - "connections/repository.ts"
Cohesion: 0.17
Nodes (6): connections, deliveries, insertDeliveryIdempotent(), listDeliveries(), sentDeliveriesByAgent(), updateDelivery()

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.22
Nodes (7): ANALISTA, COLETOR, COZINHA, EQUIPE, FINANCEIRO, JURIDICO, TIME

### Community 159 - "webSourcePolicy.ts"
Cohesion: 0.11
Nodes (22): DEFAULT_ARTICLES_PER_RUN, DEFAULT_INTERVAL_MINUTES, DEFAULT_STALENESS_MINUTES, DISCOVERY_MODES, DiscoveryMode, emMs(), limitar(), MAX_ARTICLES_PER_RUN (+14 more)

### Community 160 - "official/index.ts"
Cohesion: 0.15
Nodes (11): MODULES, OFFICIAL_ADAPTERS, OfficialAppsError, OfficialModule, adapters, manifest, adapters, manifest (+3 more)

### Community 161 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 162 - "webSearch/budget.ts"
Cohesion: 0.07
Nodes (42): traceEvent(), agentSearchStats, BRAVE_FREE_MONTHLY_REQUESTS, ensureWebSearchIndexes(), eventos, ligado(), orcamento, recordSearchEvent() (+34 more)

### Community 165 - "executionCenter.ts"
Cohesion: 0.07
Nodes (50): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+42 more)

### Community 171 - "webKnowledge.integration.test.mjs"
Cohesion: 0.23
Nodes (12): agenteComSite(), artigosNoFeed, comBootstrap(), comFeed(), criarAgente(), depsDoRuntime(), pedidos, rodar() (+4 more)

### Community 172 - "agentRuntime.ts"
Cohesion: 0.13
Nodes (26): AgentExecutionRequest, AgentExecutionResult, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), inputToText(), ReplyFn (+18 more)

### Community 174 - "browserRenderer.ts"
Cohesion: 0.14
Nodes (18): BrowserRenderer, buscarPadrao(), ReaderPage, abrirNavegador(), browserRendererEnabled(), esperarVaga(), fila, liberarVaga() (+10 more)

### Community 175 - "executorAudit.integration.test.mjs"
Cohesion: 0.30
Nodes (11): agente(), ANDAR, CALCULADORA(), COLETOR(), ctx(), deps(), doTipo(), eventos() (+3 more)

### Community 177 - "delegationWiring.ts"
Cohesion: 0.21
Nodes (20): createLiveTracker(), executeAgentTask(), resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), finishDelegation(), startDelegation(), playgroundDelegationDeps() (+12 more)

### Community 178 - "agentRoleRuntime.integration.test.mjs"
Cohesion: 0.52
Nodes (6): agenteCom(), bancada(), comBusca(), contexto(), nomes(), rodar()

### Community 182 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 183 - "llm.ts"
Cohesion: 0.16
Nodes (20): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, askAux(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput() (+12 more)

### Community 185 - "dependenciasDeclaradas.test.mjs"
Cohesion: 0.25
Nodes (4): declaradas, nativos, pkg, raiz

### Community 187 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

### Community 188 - "validateAgainstSchema"
Cohesion: 0.16
Nodes (20): enforceOutputContract(), checkJson(), parseJsonOutput(), checkStageOutput(), assertRegistryIsSound(), finishStep(), prepareStepInput(), primeiros() (+12 more)

### Community 190 - "planCompiler.test.mjs"
Cohesion: 0.29
Nodes (4): CHEFE, COLETOR, EQUIPE, RISCO

### Community 196 - "sourceCheckpoint.ts"
Cohesion: 0.13
Nodes (19): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), publishedSourceFingerprint(), normalizeSourceUrl(), sourceFingerprint() (+11 more)

### Community 197 - "Agent"
Cohesion: 0.15
Nodes (16): Agent, AgentAppGrant, CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows() (+8 more)

### Community 199 - "executionTrace.ts"
Cohesion: 0.14
Nodes (13): CHAVES_SEGURAS, ExecutionTraceEvent, onTraceEvent(), preview(), readTrace(), recorte(), sanitize(), Sink (+5 more)

### Community 201 - "logRoutes.ts"
Cohesion: 0.16
Nodes (9): AUDIT_ACTIONS, AuditAction, AuditActorType, AuditEntityType, AuditFilters, AuditResult, AuditTarget, Rule (+1 more)

### Community 202 - "AppDefinition"
Cohesion: 0.53
Nodes (5): native(), num(), schema(), str(), AppDefinition

### Community 203 - "dispatcher.ts"
Cohesion: 0.33
Nodes (9): executarPorDespacho(), conferirEntrada(), conferirSaida(), dispatchAgentExecution(), DispatchDeps, falha(), fromLlmResult(), LlmRunner (+1 more)

### Community 204 - "sectorMembership.ts"
Cohesion: 0.24
Nodes (9): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, MAX_SECTOR_MEMBERS, SectorMember (+1 more)

### Community 205 - "delegationLog.ts"
Cohesion: 0.22
Nodes (8): col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus, ensureDelegationIndexes(), listDelegationsForAgent(), succeededDelegationsByCaller()

### Community 206 - "playgroundSession.ts"
Cohesion: 0.25
Nodes (8): guardarTurnoDeTeste(), appendPlaygroundTurns(), clearPlaygroundTurns(), cortar(), loadPlaygroundTurns(), PlaygroundSession, PlaygroundTurn, sessions

### Community 207 - "connectionProfile.integration.test.mjs"
Cohesion: 0.40
Nodes (4): app(), conectar(), MANIFESTO, semConexao

### Community 208 - "functionAgentLifecycle.e2e.test.mjs"
Cohesion: 0.40
Nodes (4): ANDAR, ESPERADO, PREDIO, VALORES

## Knowledge Gaps
- **782 isolated node(s):** `ConnectionProblem`, `ConnectionRefusal`, `AMBIENTES_BLOQUEADOS`, `installations`, `CreateInstallationInput` (+777 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **33 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ensureAgentWebKnowledgeFresh()` connect `webKnowledge.ts` to `delegationWiring.ts`, `agentRoutineRoutes.ts`, `getAgentById`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **Why does `site()` connect `webKnowledge.ts` to `sourceTool.integration.test.mjs`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **What connects `ConnectionProblem`, `ConnectionRefusal`, `AMBIENTES_BLOQUEADOS` to the rest of the system?**
  _782 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `installations.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08502024291497975 - nodes in this community are weakly interconnected._
- **Should `sourceChange.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12010796221322537 - nodes in this community are weakly interconnected._
- **Should `agentRoutineRoutes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13663663663663664 - nodes in this community are weakly interconnected._