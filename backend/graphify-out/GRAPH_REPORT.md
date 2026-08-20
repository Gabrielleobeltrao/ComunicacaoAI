# Graph Report - backend  (2026-08-19)

## Corpus Check
- 302 files · ~332,760 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2669 nodes · 6167 edges · 180 communities (160 shown, 20 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `879ae38e`
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
- refreshMemoryAndIdentity
- systemPrompt.ts
- agentLiveState.ts
- delegation.ts
- mongoServer.mjs
- widgets.ts
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
- installations.ts
- runRepository.ts
- sectorExecutions.ts
- openai.ts
- sourceMonitoring.test.mjs
- connections/service.ts
- floorWork.ts
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
- runService.ts
- entrypointParity.test.mjs
- automations/types.ts
- agentDefinition.ts
- automations/service.ts
- runner.ts
- tokenUsage.ts
- run-tests.mjs
- floorCommunication.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- sectorAccess.ts
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- sectors.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- eventTrigger.ts
- clarify.ts
- floorRoutes.ts
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
- db.ts
- lexicalRetrieval.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- executionTrace.ts
- AutomationDefinition
- appRoutes.integration.test.mjs
- sectorMembership.ts
- safeError.ts
- hardening.integration.test.mjs
- webContent.ts
- builtinTools.ts
- toolsSecurity.test.mjs
- ownerFilter
- sectorPlanner.test.mjs
- scopeGate.test.mjs
- embedText
- sectorAccess.integration.test.mjs
- agentTools.ts
- sources.ts
- automationRoutes.ts
- executionCenter.ts
- agentCapabilities.ts
- safeHttp.ts
- googleTools.ts
- selectVisualStates
- webSourcePolicy.test.mjs
- webKnowledge.integration.test.mjs
- config.ts
- sectorBriefing.ts

## God Nodes (most connected - your core abstractions)
1. `respondWithAgentIfLinked()` - 56 edges
2. `db` - 52 edges
3. `startMongo()` - 42 edges
4. `stopMongo()` - 42 edges
5. `buildDeps()` - 39 edges
6. `getAgentById()` - 33 edges
7. `productionDelegationDeps()` - 32 edges
8. `executeSectorTeam()` - 30 edges
9. `encrypt()` - 26 edges
10. `Agent` - 25 edges

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

## Communities (180 total, 20 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.16
Nodes (20): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, askAux(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput() (+12 more)

### Community 1 - "floors.ts"
Cohesion: 0.15
Nodes (20): BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE, isValidTimezone(), LANGUAGES, updateBuilding(), collection (+12 more)

### Community 2 - "apps/types.ts"
Cohesion: 0.11
Nodes (21): manifest, native(), num(), schema(), str(), manifest, manifest, manifest (+13 more)

### Community 3 - "agentRuntime.ts"
Cohesion: 0.12
Nodes (26): enforceOutputContract(), AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+18 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.08
Nodes (26): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), DocumentPage, DocumentQuery (+18 more)

### Community 5 - "sourceCheckpoint.ts"
Cohesion: 0.15
Nodes (18): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), contentHashOf(), sourceFingerprint(), acquireSourceLease() (+10 more)

### Community 6 - "src/index.ts"
Cohesion: 0.04
Nodes (50): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), clarificationGuidance(), CLARIFY_LIMIT (+42 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (50): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentToolHeader, AgentToolParam (+42 more)

### Community 9 - "grants.ts"
Cohesion: 0.14
Nodes (25): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+17 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (32): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+24 more)

### Community 11 - "refreshMemoryAndIdentity"
Cohesion: 0.11
Nodes (27): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+19 more)

### Community 12 - "systemPrompt.ts"
Cohesion: 0.11
Nodes (16): buildClarificationInstruction(), buildIdentityCaptureInstruction(), buildLanguageInstruction(), buildProactivityInstruction(), buildResponseStyleInstruction(), DETAIL_INSTRUCTIONS, formatStructuredMemory(), GUARDRAIL_REFUSAL_MESSAGE (+8 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.11
Nodes (25): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS, clearAgentState() (+17 more)

### Community 14 - "delegation.ts"
Cohesion: 0.08
Nodes (41): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, ClarificationRequest, agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools() (+33 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.06
Nodes (17): FLOOR, PAGE, OPCOES, AGENTE, SETOR, startMongo(), stopMongo(), A (+9 more)

### Community 16 - "widgets.ts"
Cohesion: 0.07
Nodes (31): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.09
Nodes (32): RecordAgentEventInput, AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail() (+24 more)

### Community 20 - "runProcessor.ts"
Cohesion: 0.13
Nodes (30): runEventKey(), createLiveTracker(), findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor() (+22 more)

### Community 21 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (14): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse, deleteIntegration() (+6 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentEvents.ts"
Cohesion: 0.09
Nodes (26): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, events, finalizeAgentEvent(), finalizeAgentEventSafe() (+18 more)

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

### Community 30 - "installations.ts"
Cohesion: 0.09
Nodes (34): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installationPublic(), installations, LEGACY_APP_VERSION, listInstallations() (+26 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.13
Nodes (20): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+12 more)

### Community 32 - "sectorExecutions.ts"
Cohesion: 0.13
Nodes (19): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+11 more)

### Community 33 - "openai.ts"
Cohesion: 0.10
Nodes (47): MAX_TOOL_ITERATIONS, anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL, extractIdentity() (+39 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.10
Nodes (18): connections, deliveries, listDeliveries(), sentDeliveriesByAgent(), CONNECTION_CATALOG, CreateConnectionInput, isNonEmpty(), normalizeName() (+10 more)

### Community 36 - "floorWork.ts"
Cohesion: 0.19
Nodes (14): Agent, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows() (+6 more)

### Community 37 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

### Community 38 - "tools.ts"
Cohesion: 0.09
Nodes (21): clamp(), createTool(), deleteTool(), getTool(), getToolsByIds(), listTools(), normalize(), TOOL_AUTH_KINDS (+13 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.12
Nodes (20): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+12 more)

### Community 41 - "jsonSchema.ts"
Cohesion: 0.23
Nodes (14): runResolvedTool(), checkStageOutput(), checkJsonText(), JsonCheck, parseJsonText(), describeErrors(), join(), matchesType() (+6 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "validate.ts"
Cohesion: 0.17
Nodes (20): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), STEP_TYPES (+12 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "webKnowledge.ts"
Cohesion: 0.08
Nodes (41): WatchedSource, looksLikeContent(), urlsFromListing(), urlsFromSitemap(), agents, atualizarFonte(), Descoberta, descobrir() (+33 more)

### Community 48 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.20
Nodes (9): chunkText(), createDocument(), createDocumentFor(), indexDocumentChunks(), KnowledgeDocument, reindexDocumentFor(), updateDocument(), updateDocumentFor() (+1 more)

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
Cohesion: 0.13
Nodes (25): backfillManagedChannelInstallations(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), backfillSourceFingerprints() (+17 more)

### Community 59 - "privateApps.ts"
Cohesion: 0.11
Nodes (30): describeManifestIssues(), exportableManifest(), FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest() (+22 more)

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

### Community 76 - "sourceChange.ts"
Cohesion: 0.17
Nodes (23): RoutineSource, executeStep(), chaveDoItem(), detectHttpChange(), detectRssChange(), HttpChange, INITIAL_WINDOWS, InitialWindow (+15 more)

### Community 77 - "delegationWiring.ts"
Cohesion: 0.10
Nodes (32): recordAgentEvent(), recordAgentEventSafe(), AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel() (+24 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, signBody() (+4 more)

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.11
Nodes (35): executeSectorTeam(), stageInstruction(), assembleWithoutModel(), buildSynthesisContext(), dedupeAgainst(), describeMember(), describePlan(), ExecutionTask (+27 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.24
Nodes (12): SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member(), OWNED_COLLECTIONS (+4 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.20
Nodes (14): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+6 more)

### Community 97 - "toolExecution.ts"
Cohesion: 0.20
Nodes (12): decrypt(), getKey(), executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets() (+4 more)

### Community 98 - "agentRoutineRoutes.ts"
Cohesion: 0.13
Nodes (36): getAgentById(), EventTriggerError, webhookEndpoint(), appStep(), memoryStep(), resolveConditionSource(), buildRoutineDefinition(), createRoutine() (+28 more)

### Community 99 - "runService.ts"
Cohesion: 0.19
Nodes (16): findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, advanceFrom(), catchUp(), nextFireAt(), automations (+8 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "automations/types.ts"
Cohesion: 0.15
Nodes (18): StepCondition, EventTriggerSpec, AppActionPlan, MemoryPlan, RoutineSpec, AI_STEP_TYPES, AutomationInput, AutomationLimits (+10 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.08
Nodes (33): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+25 more)

### Community 103 - "automations/service.ts"
Cohesion: 0.16
Nodes (24): ensureActivationMode(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), defaultDefinition(), normalizeName() (+16 more)

### Community 104 - "runner.ts"
Cohesion: 0.10
Nodes (21): AgentCall, delay(), DeliverCall, FetchResult, MemoryOps, runDefinition(), RunnerDeps, RunOutcome (+13 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): TokenUsage, dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

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

### Community 111 - "sectorAccess.ts"
Cohesion: 0.22
Nodes (14): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+6 more)

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
Cohesion: 0.16
Nodes (17): createSector(), deleteSector(), enforceSingleMembership(), membersFromStages(), normalizeMembers(), normalizeStages(), SECTOR_MODE_LABEL, SECTOR_MODES (+9 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "eventTrigger.ts"
Cohesion: 0.21
Nodes (25): buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), normalizeCondition(), readEventTriggerConfig() (+17 more)

### Community 120 - "clarify.ts"
Cohesion: 0.38
Nodes (6): clarificationFrom(), CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarifyBudgetSpent()

### Community 121 - "floorRoutes.ts"
Cohesion: 0.21
Nodes (11): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, deleteFloor(), Floor, getFloorActivity() (+3 more)

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
Nodes (21): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+13 more)

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

### Community 137 - "modelCache.ts"
Cohesion: 0.29
Nodes (9): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), humanizeModelId(), isChatModel() (+1 more)

### Community 139 - "db.ts"
Cohesion: 0.07
Nodes (27): auth, ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, db (+19 more)

### Community 140 - "lexicalRetrieval.ts"
Cohesion: 0.20
Nodes (17): searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm (+9 more)

### Community 146 - "executionTrace.ts"
Cohesion: 0.15
Nodes (12): ExecutionTraceEvent, onTraceEvent(), preview(), readTrace(), sanitize(), Sink, traceEvent(), TraceEventType (+4 more)

### Community 147 - "AutomationDefinition"
Cohesion: 0.31
Nodes (10): CreateAutomationInput, UpdateDraftPatch, Automation, AutomationDefinition, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent() (+2 more)

### Community 149 - "sectorMembership.ts"
Cohesion: 0.22
Nodes (10): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, MAX_SECTOR_MEMBERS, Sector (+2 more)

### Community 150 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 152 - "webContent.ts"
Cohesion: 0.32
Nodes (11): canonicalFromHtml(), canonicalizeUrl(), domainOf(), extractPageMeta(), extractReadableText(), iso(), metaContent(), pageFacts() (+3 more)

### Community 153 - "builtinTools.ts"
Cohesion: 0.07
Nodes (32): adapters, manifest, MODULES, OFFICIAL_ADAPTERS, OFFICIAL_APPS, OfficialAppsError, OfficialModule, adapters (+24 more)

### Community 156 - "ownerFilter"
Cohesion: 0.22
Nodes (9): countDocumentsFromSource(), deleteDocument(), deleteDocumentFor(), escaparRegex(), getDocument(), getDocumentFor(), listDocumentsFor(), listDocumentsPage() (+1 more)

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.22
Nodes (7): ANALISTA, COLETOR, COZINHA, EQUIPE, FINANCEIRO, JURIDICO, TIME

### Community 159 - "embedText"
Cohesion: 0.29
Nodes (7): recordTurn(), metadataFilter(), searchKnowledge(), searchKnowledgeForOwners(), embedText(), embedTexts(), VoyageEmbeddingResponse

### Community 160 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 161 - "agentTools.ts"
Cohesion: 0.38
Nodes (6): AgentTool, legacyToolToExecutable(), resolveHttpTool(), toolInputSchema(), ExecutableTool, TOOL_DEFAULTS

### Community 162 - "sources.ts"
Cohesion: 0.23
Nodes (13): clean(), decodeEntities(), parseRssItems(), pick(), pickLink(), stripCdata(), stripTags(), feedFromHtml() (+5 more)

### Community 164 - "automationRoutes.ts"
Cohesion: 0.25
Nodes (4): AutomationVersion, ValidationError, automationRouter, fail()

### Community 165 - "executionCenter.ts"
Cohesion: 0.07
Nodes (50): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+42 more)

### Community 166 - "agentCapabilities.ts"
Cohesion: 0.29
Nodes (6): AgentRole, capabilitiesOf(), POR_PRESET, ROLE_LABEL, RoleCapabilities, roleOf()

### Community 167 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 168 - "googleTools.ts"
Cohesion: 0.33
Nodes (7): adapters, manifest, getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 169 - "selectVisualStates"
Cohesion: 0.33
Nodes (5): agentLiveStatesForFloor(), rank(), selectVisualStates(), NOW, row()

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
- **664 isolated node(s):** `name`, `version`, `type`, `main`, `dev` (+659 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ensureAgentWebKnowledgeFresh()` connect `webKnowledge.ts` to `agentRoutineRoutes.ts`, `delegationWiring.ts`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Why does `site()` connect `webKnowledge.ts` to `sourceTool.integration.test.mjs`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `type` to the rest of the system?**
  _664 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14624505928853754 - nodes in this community are weakly interconnected._
- **Should `apps/types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11201079622132254 - nodes in this community are weakly interconnected._