# Graph Report - backend  (2026-08-19)

## Corpus Check
- 300 files · ~329,930 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2653 nodes · 6132 edges · 180 communities (158 shown, 22 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2d6069df`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- floors.ts
- apps/types.ts
- agentRuntime.ts
- knowledge.ts
- sourceCheckpoint.ts
- src/index.ts
- audit.ts
- agents.ts
- grants.ts
- agentReadiness.ts
- respondWithAgentIfLinked
- AppDefinition
- agentLiveState.ts
- delegation.ts
- mongoServer.mjs
- routine.ts
- whatsapp.ts
- patterns.ts
- routineExecution.ts
- runProcessor.ts
- googleCalendar.ts
- dependencies
- agentEvents.ts
- migration.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- navigation.ts
- runRepository.ts
- sectorExecutions.ts
- openai.ts
- sourceMonitoring.test.mjs
- connections/repository.ts
- floorWork.ts
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
- webKnowledge.ts
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
- sourceChange.ts
- delegationWiring.ts
- automations/repository.ts
- routine.test.mjs
- seedGuard.test.mjs
- sectorPlanner.ts
- seedRestaurantDemo.ts
- channelApps.ts
- toolExecution.ts
- agentRoutineRoutes.ts
- scheduler.ts
- entrypointParity.test.mjs
- automations/service.ts
- agentDefinition.ts
- installations.ts
- runner.ts
- tokenUsage.ts
- run-tests.mjs
- floorCommunication.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- listRunTimeline
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- sectors.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- eventTrigger.ts
- clarify.ts
- sourceTool.ts
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
- modelCache.ts
- conversationTurns.ts
- lexicalRetrieval.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- executeSectorTeam
- db.ts
- appRoutes.integration.test.mjs
- builtinTools.ts
- safeError.ts
- hardening.integration.test.mjs
- webContent.ts
- official/index.ts
- toolsSecurity.test.mjs
- executionRoutes.ts
- sectorPlanner.test.mjs
- scopeGate.test.mjs
- connections/service.ts
- sectorAccess.integration.test.mjs
- runService.ts
- webDiscovery.ts
- offices.ts
- appGrantRoutes.ts
- executionCenter.ts
- executionSummary
- safeHttp.ts
- googleTools.ts
- agentLiveState.test.mjs
- webSourcePolicy.test.mjs
- webKnowledge.integration.test.mjs
- config.ts
- sectorBriefing.ts
- sourceSsrf.test.mjs

## God Nodes (most connected - your core abstractions)
1. `respondWithAgentIfLinked()` - 56 edges
2. `db` - 52 edges
3. `startMongo()` - 42 edges
4. `stopMongo()` - 42 edges
5. `buildDeps()` - 39 edges
6. `getAgentById()` - 33 edges
7. `productionDelegationDeps()` - 32 edges
8. `executeSectorTeam()` - 29 edges
9. `encrypt()` - 26 edges
10. `refreshMemoryAndIdentity()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `ensureAgentWebKnowledgeFresh()` --indirect_call--> `site()`  [INFERRED]
  src/webKnowledge.ts → test/sourceTool.integration.test.mjs
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `executeSectorTeam()` --indirect_call--> `parseSufficiency()`  [INFERRED]
  src/delegation.ts → src/sectorPlanner.ts
- `resolveOwnedAgentId()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (180 total, 22 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.16
Nodes (20): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, askAux(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput() (+12 more)

### Community 1 - "floors.ts"
Cohesion: 0.11
Nodes (34): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, BuildingPatch, buildings (+26 more)

### Community 2 - "apps/types.ts"
Cohesion: 0.09
Nodes (27): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+19 more)

### Community 3 - "agentRuntime.ts"
Cohesion: 0.12
Nodes (26): enforceOutputContract(), AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson() (+18 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.07
Nodes (31): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), DocumentPage, DocumentQuery (+23 more)

### Community 5 - "sourceCheckpoint.ts"
Cohesion: 0.14
Nodes (18): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), normalizeSourceUrl(), sourceFingerprint(), acquireSourceLease() (+10 more)

### Community 6 - "src/index.ts"
Cohesion: 0.04
Nodes (65): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), app, AVATAR_MIME_TYPES, channelWebhookUrl() (+57 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (52): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentTool, AgentToolHeader (+44 more)

### Community 9 - "grants.ts"
Cohesion: 0.19
Nodes (18): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+10 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (32): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+24 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.08
Nodes (39): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+31 more)

### Community 12 - "AppDefinition"
Cohesion: 0.23
Nodes (9): manifest, adapters, manifest, native(), num(), schema(), str(), manifest (+1 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.10
Nodes (28): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+20 more)

### Community 14 - "delegation.ts"
Cohesion: 0.09
Nodes (34): presetSpec(), suggestPresetForCapability(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing, checkDelegation() (+26 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.06
Nodes (17): FLOOR, PAGE, OPCOES, AGENTE, SETOR, startMongo(), stopMongo(), A (+9 more)

### Community 16 - "routine.ts"
Cohesion: 0.19
Nodes (18): StepCondition, EventTriggerSpec, AppActionPlan, MemoryPlan, MODE_LABELS, STEP_APP, STEP_MEMORY, getRoutineForAgent() (+10 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): inboundMediaToText(), getProviderApiKey(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.10
Nodes (28): RecordAgentEventInput, AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail() (+20 more)

### Community 20 - "runProcessor.ts"
Cohesion: 0.15
Nodes (27): runEventKey(), createLiveTracker(), findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor() (+19 more)

### Community 21 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (14): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse, deleteIntegration() (+6 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentEvents.ts"
Cohesion: 0.09
Nodes (28): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, events, finalizeAgentEvent(), finalizeAgentEventSafe() (+20 more)

### Community 24 - "migration.ts"
Cohesion: 0.12
Nodes (27): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+19 more)

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

### Community 30 - "navigation.ts"
Cohesion: 0.16
Nodes (18): installationPublic(), listInstallations(), buildNavigation(), dropPinsForApp(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus (+10 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.14
Nodes (17): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+9 more)

### Community 32 - "sectorExecutions.ts"
Cohesion: 0.12
Nodes (20): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+12 more)

### Community 33 - "openai.ts"
Cohesion: 0.08
Nodes (58): MAX_TOOL_ITERATIONS, runResolvedTool(), anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL (+50 more)

### Community 35 - "connections/repository.ts"
Cohesion: 0.11
Nodes (14): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), connections, deliveries, listDeliveries(), sentDeliveriesByAgent() (+6 more)

### Community 36 - "floorWork.ts"
Cohesion: 0.17
Nodes (16): Agent, AgentAppGrant, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget (+8 more)

### Community 37 - "agentTools.ts"
Cohesion: 0.12
Nodes (8): legacyToolToExecutable(), ToolCallRecord, toolInputSchema(), AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply()

### Community 38 - "tools.ts"
Cohesion: 0.10
Nodes (17): deleteTool(), getTool(), listTools(), TOOL_AUTH_KINDS, TOOL_DEFAULTS, TOOL_LIMITS, TOOL_METHODS, TOOL_NAME_PATTERN (+9 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.12
Nodes (20): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+12 more)

### Community 41 - "jsonSchema.ts"
Cohesion: 0.25
Nodes (13): checkStageOutput(), checkJsonText(), JsonCheck, parseJsonText(), describeErrors(), join(), matchesType(), Schema (+5 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "validate.ts"
Cohesion: 0.21
Nodes (17): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), hasCycle() (+9 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "webKnowledge.ts"
Cohesion: 0.08
Nodes (38): WatchedSource, looksLikeContent(), urlsFromFeed(), urlsFromSitemap(), agents, atualizarFonte(), Descoberta, descobrir() (+30 more)

### Community 48 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.15
Nodes (14): chunkText(), countDocumentsFromSource(), deleteDocument(), deleteDocumentFor(), getDocument(), getDocumentFor(), indexDocumentChunks(), KnowledgeDocument (+6 more)

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
Cohesion: 0.19
Nodes (20): backfillManagedChannelInstallations(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes() (+12 more)

### Community 59 - "privateApps.ts"
Cohesion: 0.18
Nodes (18): describeManifestIssues(), exportableManifest(), archivePrivateApp(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), isUsableManifest() (+10 more)

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

### Community 76 - "sourceChange.ts"
Cohesion: 0.23
Nodes (17): detectRssChange(), HttpChange, INITIAL_WINDOWS, InitialWindow, pareceFeed(), RssChange, SourcePreview, clean() (+9 more)

### Community 77 - "delegationWiring.ts"
Cohesion: 0.08
Nodes (33): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), agentCanDelegate(), capabilityMissingTool() (+25 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.17
Nodes (8): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.11
Nodes (29): buildSynthesisContext(), describeMember(), describePlan(), ExecutionTask, fallbackPlan(), inputFromDependencies(), INSTRUCOES_DE_SINTESE, limitationNote() (+21 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.21
Nodes (14): createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main() (+6 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.20
Nodes (14): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+6 more)

### Community 97 - "toolExecution.ts"
Cohesion: 0.21
Nodes (11): ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets(), ToolExecutionResult (+3 more)

### Community 98 - "agentRoutineRoutes.ts"
Cohesion: 0.13
Nodes (30): getAgentById(), normalizeCondition(), readEventTriggerConfig(), webhookEndpoint(), emptyMemoryPlan(), normalizeMemoryPlan(), listAgentAutomations(), listRoutines() (+22 more)

### Community 99 - "scheduler.ts"
Cohesion: 0.25
Nodes (12): findVersion(), advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, planSchedules() (+4 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "automations/service.ts"
Cohesion: 0.08
Nodes (42): assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName() (+34 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.08
Nodes (33): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+25 more)

### Community 103 - "installations.ts"
Cohesion: 0.11
Nodes (25): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installations, markInstallationTested(), normalizeConfig(), normalizeName() (+17 more)

### Community 104 - "runner.ts"
Cohesion: 0.11
Nodes (22): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, MemoryOps, runDefinition(), RunnerDeps (+14 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.20
Nodes (16): dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce(), settlePendingCharges() (+8 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "floorCommunication.ts"
Cohesion: 0.18
Nodes (14): Building, buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode (+6 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.16
Nodes (12): AGENT, agentDoc(), ALVO, alvoDoc(), base, call, ctx, depsDelegacao() (+4 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "listRunTimeline"
Cohesion: 0.20
Nodes (16): agentConstraint(), agentIdsInSector(), automationFilter(), averageTokens(), decodeRunCursor(), encodeRunCursor(), listRunsForCenter(), listRunTimeline() (+8 more)

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
Cohesion: 0.08
Nodes (40): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+32 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "eventTrigger.ts"
Cohesion: 0.21
Nodes (25): ensureActivationMode(), buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), EventTriggerError, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers() (+17 more)

### Community 120 - "clarify.ts"
Cohesion: 0.27
Nodes (8): ClarificationRequest, CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarificationGuidance(), CLARIFY_LIMIT, clarifyBudgetSpent()

### Community 121 - "sourceTool.ts"
Cohesion: 0.33
Nodes (11): RoutineSource, chaveDoItem(), contentHashOf(), detectHttpChange(), getCheckpoint(), previewSource(), FonteDoAgente, j() (+3 more)

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
Cohesion: 0.13
Nodes (22): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+14 more)

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

### Community 137 - "modelCache.ts"
Cohesion: 0.29
Nodes (9): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), humanizeModelId(), isChatModel() (+1 more)

### Community 139 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 140 - "lexicalRetrieval.ts"
Cohesion: 0.20
Nodes (17): searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm (+9 more)

### Community 146 - "executeSectorTeam"
Cohesion: 0.10
Nodes (25): clarificationFrom(), childContext(), emitAgentEvent(), executeSectorTeam(), participationTelemetry(), recordChildRun(), runAgentTask(), runWithRetry() (+17 more)

### Community 147 - "db.ts"
Cohesion: 0.06
Nodes (30): auth, db, mongoClient, guardarTurnoDeTeste(), appendPlaygroundTurns(), clearPlaygroundTurns(), cortar(), loadPlaygroundTurns() (+22 more)

### Community 149 - "builtinTools.ts"
Cohesion: 0.23
Nodes (11): resolveHttpTool(), resolveAppGrantTools(), APP_GUIDES, BUILTIN_APPS, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, getBuiltinApp() (+3 more)

### Community 150 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 152 - "webContent.ts"
Cohesion: 0.32
Nodes (11): canonicalFromHtml(), canonicalizeUrl(), domainOf(), extractPageMeta(), extractReadableText(), iso(), metaContent(), pageFacts() (+3 more)

### Community 153 - "official/index.ts"
Cohesion: 0.09
Nodes (25): adapters, manifest, MODULES, OFFICIAL_ADAPTERS, OfficialAppsError, OfficialModule, adapters, manifest (+17 more)

### Community 156 - "executionRoutes.ts"
Cohesion: 0.18
Nodes (8): EXECUTION_TABS, ExecutionFilters, ExecutionTab, RunTimelineFilters, AnalyticsPeriod, ANALYTICS_PERIODS, executionRouter, parseFilters()

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.33
Nodes (4): COZINHA, EQUIPE, FINANCEIRO, JURIDICO

### Community 159 - "connections/service.ts"
Cohesion: 0.29
Nodes (8): createConnection(), CreateConnectionInput, isNonEmpty(), normalizeName(), patchConnection(), PROVIDERS, validateConfig(), ConnectionProvider

### Community 160 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 161 - "runService.ts"
Cohesion: 0.39
Nodes (7): insertRunIdempotent(), createRun(), CreateRunInput, AutomationRun, TriggerType, canonical(), computeDefinitionHash()

### Community 162 - "webDiscovery.ts"
Cohesion: 0.32
Nodes (6): feedFromHtml(), DiscoveryPlan, DiscoveryProbe, ehFeed(), planDiscovery(), urlsFromListing()

### Community 163 - "offices.ts"
Cohesion: 0.33
Nodes (4): createOffice(), ensureDefaultOffice(), Office, offices

### Community 164 - "appGrantRoutes.ts"
Cohesion: 0.18
Nodes (10): isUsableApp(), ValidationError, CONNECTION_CATALOG, appGrantRouter, validateGrant(), automationRouter, connectionRouter, fail() (+2 more)

### Community 165 - "executionCenter.ts"
Cohesion: 0.13
Nodes (21): ACTIVE_RUN_STATUSES, AgentRef, agents, AutomationDoc, automations, ExecutionPage, floors, HISTORY_RUN_STATUSES (+13 more)

### Community 166 - "executionSummary"
Cohesion: 0.50
Nodes (4): clarificationsSince(), tokensByModelSince(), executionSummary, windowStart()

### Community 167 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 168 - "googleTools.ts"
Cohesion: 0.50
Nodes (5): getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 171 - "webKnowledge.integration.test.mjs"
Cohesion: 0.23
Nodes (12): agenteComSite(), artigosNoFeed, comBootstrap(), comFeed(), criarAgente(), depsDoRuntime(), pedidos, rodar() (+4 more)

### Community 174 - "config.ts"
Cohesion: 0.32
Nodes (7): clientUrl, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig()

### Community 175 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

## Knowledge Gaps
- **661 isolated node(s):** `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget`, `DelegationDenyCode`, `DelegationCheck`, `OPEN_COMMUNICATION` (+656 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ensureAgentWebKnowledgeFresh()` connect `agentRoutineRoutes.ts` to `engine.ts`, `delegationWiring.ts`, `sourceTool.integration.test.mjs`, `webKnowledge.ts`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Why does `site()` connect `sourceTool.integration.test.mjs` to `agentRoutineRoutes.ts`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget`, `DelegationDenyCode` to the rest of the system?**
  _661 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11153846153846154 - nodes in this community are weakly interconnected._
- **Should `apps/types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0855614973262032 - nodes in this community are weakly interconnected._