# Graph Report - backend  (2026-08-18)

## Corpus Check
- 272 files · ~278,140 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2398 nodes · 5571 edges · 162 communities (143 shown, 19 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 42 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7dc1aeaf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- automations/types.ts
- sectorAccess.ts
- interactiveRun.ts
- knowledge.ts
- executionCenter.ts
- src/index.ts
- audit.ts
- agents.ts
- grants.ts
- agentReadiness.ts
- respondWithAgentIfLinked
- runner.ts
- agentLiveState.ts
- delegation.ts
- mongoServer.mjs
- agentRoutineRoutes.ts
- whatsapp.ts
- patterns.ts
- routineExecution.ts
- automations/service.ts
- apps/types.ts
- dependencies
- agentEvents.ts
- migration.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- migrate.ts
- sectors.ts
- runRepository.ts
- sourceMonitoring.test.mjs
- sectorKnowledgeRoutes.ts
- webhookRoutes.ts
- agentDefinition.ts
- tools.ts
- eventTrigger.integration.test.mjs
- executionRoots.ts
- scheduler.ts
- executionModes.integration.test.mjs
- scripts
- validate.ts
- package.json
- migrationFixture.integration.test.mjs
- encrypt
- official/index.ts
- delegation.test.mjs
- runnerTimeout.test.mjs
- runtimeHardening.test.mjs
- schedulerPublish.integration.test.mjs
- providerPayload.test.mjs
- agentHistory.integration.test.mjs
- auditRouteMap.test.mjs
- routineDelivery.integration.test.mjs
- deployment.test.mjs
- builtinTools.ts
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
- config.ts
- delegationWiring.ts
- automations/repository.ts
- routine.test.mjs
- seedGuard.test.mjs
- floorRoutes.ts
- seedRestaurantDemo.ts
- channelApps.ts
- installations.ts
- sectorExecutions.ts
- toolExecution.ts
- entrypointParity.test.mjs
- offices.ts
- agentRuntime.ts
- eventTrigger.ts
- db.ts
- tokenUsage.ts
- run-tests.mjs
- runProcessor.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- floorWork.ts
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- jsonSchema.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- floorCommunication.ts
- sectorAccess.integration.test.mjs
- appRoutes.integration.test.mjs
- collaborationGate.test.mjs
- floorWork.integration.test.mjs
- gateWiring.integration.test.mjs
- seedAgentBubbles.ts
- channelApps.integration.test.mjs
- channelOverview.integration.test.mjs
- llmFakeGate.test.mjs
- engine.ts
- logHygiene.test.mjs
- sourceCheckpoint.integration.test.mjs
- cron-parser
- safeError.ts
- sourceTool.integration.test.mjs
- timeoutCancellation.test.mjs
- toolsSecurity.test.mjs
- sectorTeam.integration.test.mjs
- AppDefinition
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- getAgentById
- runConfig.ts
- openai.ts
- agentLiveTracker.ts
- googleTools.ts
- safeHttp.ts
- floors.ts
- conversationTurns.ts
- lexicalRetrieval.ts
- agentTools.ts
- connections/service.ts
- hardening.integration.test.mjs
- selectVisualStates

## God Nodes (most connected - your core abstractions)
1. `db` - 50 edges
2. `respondWithAgentIfLinked()` - 45 edges
3. `buildDeps()` - 39 edges
4. `startMongo()` - 39 edges
5. `stopMongo()` - 39 edges
6. `getAgentById()` - 31 edges
7. `productionDelegationDeps()` - 27 edges
8. `encrypt()` - 26 edges
9. `refreshMemoryAndIdentity()` - 24 edges
10. `ResolvedTool` - 23 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts
- `resolveAgentTools()` --indirect_call--> `resolveHttpTool()`  [INFERRED]
  src/builtinTools.ts → src/agentTools.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (162 total, 19 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.18
Nodes (17): SUPPORTED_IMAGE_TYPES, auxiliaryModel(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), FAKE_LLM_ENABLED, generateAgentReply(), listModelsForProvider() (+9 more)

### Community 1 - "automations/types.ts"
Cohesion: 0.13
Nodes (20): StepCondition, EventTriggerSpec, AppActionPlan, MemoryPlan, RoutineSpec, Recurrence, AI_STEP_TYPES, AutomationInput (+12 more)

### Community 2 - "sectorAccess.ts"
Cohesion: 0.21
Nodes (14): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+6 more)

### Community 3 - "interactiveRun.ts"
Cohesion: 0.24
Nodes (10): enforceOutputContract(), AgentRunError, comPrazo(), describeDropped(), espera(), InteractiveReply, runInteractive(), ToolRisk (+2 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.10
Nodes (23): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), documents, EMBEDDING_DIMENSIONS (+15 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (48): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+40 more)

### Community 6 - "src/index.ts"
Cohesion: 0.05
Nodes (33): backfillAgentEventAttempts(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), app, AVATAR_MIME_TYPES, channelWebhookUrl(), httpServer (+25 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (47): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentToolHeader, AgentToolParam (+39 more)

### Community 9 - "grants.ts"
Cohesion: 0.17
Nodes (21): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+13 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (32): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+24 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.08
Nodes (37): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+29 more)

### Community 12 - "runner.ts"
Cohesion: 0.06
Nodes (69): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), RoutineSource, AgentCall, delay() (+61 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.11
Nodes (23): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS, clearAgentState() (+15 more)

### Community 14 - "delegation.ts"
Cohesion: 0.09
Nodes (44): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, checkCollaboration(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools() (+36 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.08
Nodes (11): FLOOR, PAGE, startMongo(), stopMongo(), A, B, runs(), wipe() (+3 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.13
Nodes (34): EventTriggerError, webhookEndpoint(), appStep(), memoryStep(), resolveConditionSource(), buildRoutineDefinition(), createRoutine(), listAgentAutomations() (+26 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (21): extractTextFromFile(), getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia() (+13 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.14
Nodes (20): AgentEventStatus, RecordAgentEventInput, instrumentTools(), AgentExecutionRequest, AgentExecutionResult, ResolvedTool, executeRoutineStep(), KnowledgeUnavailableError (+12 more)

### Community 20 - "automations/service.ts"
Cohesion: 0.13
Nodes (30): assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition(), normalizeName() (+22 more)

### Community 21 - "apps/types.ts"
Cohesion: 0.11
Nodes (25): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+17 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentEvents.ts"
Cohesion: 0.09
Nodes (27): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentExecutionEvent, ensureAgentEventIndexes(), events, finalizeAgentEvent(), finalizeAgentEventSafe() (+19 more)

### Community 24 - "migration.ts"
Cohesion: 0.09
Nodes (40): AgentBuiltinTool, LEGACY_APP_VERSION, listInstallations(), agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation() (+32 more)

### Community 25 - "records.ts"
Cohesion: 0.08
Nodes (47): readPath(), assertAgentMayWrite(), floors, MemoryAccessError, ResolvedScope, resolveTarget(), scopesForAgent(), scopesForOwner() (+39 more)

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

### Community 30 - "widgets.ts"
Cohesion: 0.08
Nodes (32): ensureActivationMode(), addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel() (+24 more)

### Community 31 - "migrate.ts"
Cohesion: 0.19
Nodes (19): ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes() (+11 more)

### Community 32 - "sectors.ts"
Cohesion: 0.12
Nodes (25): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+17 more)

### Community 33 - "runRepository.ts"
Cohesion: 0.13
Nodes (22): artifacts, findRun(), insertRunIdempotent(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel() (+14 more)

### Community 35 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.14
Nodes (15): wiringForAgent(), chunkText(), deleteDocument(), deleteDocumentFor(), getDocument(), getDocumentFor(), indexDocumentChunks(), KnowledgeDocument (+7 more)

### Community 36 - "webhookRoutes.ts"
Cohesion: 0.43
Nodes (5): findByWebhookKey(), signBody(), verifySignature(), webhookIdempotencyKey(), webhookRouter

### Community 37 - "agentDefinition.ts"
Cohesion: 0.18
Nodes (17): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+9 more)

### Community 38 - "tools.ts"
Cohesion: 0.09
Nodes (23): parseAgentModelFields(), isValidToolSchema(), clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize() (+15 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.12
Nodes (21): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+13 more)

### Community 41 - "scheduler.ts"
Cohesion: 0.23
Nodes (13): findVersion(), advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes() (+5 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "validate.ts"
Cohesion: 0.19
Nodes (19): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), canonical() (+11 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "encrypt"
Cohesion: 0.18
Nodes (17): decrypt(), encrypt(), getKey(), buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), googleConfigured() (+9 more)

### Community 48 - "official/index.ts"
Cohesion: 0.06
Nodes (30): manifest, adapters, manifest, MODULES, OFFICIAL_ADAPTERS, OFFICIAL_APPS, OfficialAppsError, OfficialModule (+22 more)

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

### Community 58 - "builtinTools.ts"
Cohesion: 0.23
Nodes (11): resolveAppGrantTools(), APP_GUIDES, BUILTIN_APPS, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, getBuiltinApp(), resolveAgentTools() (+3 more)

### Community 59 - "privateApps.ts"
Cohesion: 0.20
Nodes (16): describeManifestIssues(), exportableManifest(), archivePrivateApp(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listAppsForOwner() (+8 more)

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "memoryStore.integration.test.mjs"
Cohesion: 0.22
Nodes (7): AGENTE, ANDAR, CHAVE_AGENTE, CHAVE_SETOR, noAgente, noSetor, SETOR

### Community 62 - "config.test.mjs"
Cohesion: 0.22
Nodes (5): here, PROD_SECRETS, PROD_URLS, PROIBIDOS, PROTOCOLOS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 76 - "config.ts"
Cohesion: 0.32
Nodes (7): clientUrl, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig()

### Community 77 - "delegationWiring.ts"
Cohesion: 0.22
Nodes (18): buildingOverview(), ensureDefaultBuilding(), agentCanDelegate(), capabilityMissingTool(), finishDelegation(), startDelegation(), playgroundDelegationDeps(), productionDelegationDeps() (+10 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.20
Nodes (6): automations, listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions

### Community 84 - "floorRoutes.ts"
Cohesion: 0.15
Nodes (12): agentStatesForFloor(), floorMetrics, AutomationVersion, ValidationError, appGrantRouter, auditEntity(), automationRouter, connectionRouter (+4 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.19
Nodes (15): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+7 more)

### Community 97 - "installations.ts"
Cohesion: 0.13
Nodes (20): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installationPublic(), installations, markInstallationTested(), normalizeConfig() (+12 more)

### Community 98 - "sectorExecutions.ts"
Cohesion: 0.11
Nodes (23): resolveOwnedSectorId(), PERIODS, requireSector(), sectorExecutionRouter, requireSector(), agentEvents, durationOf(), ExecutionEnvironment (+15 more)

### Community 99 - "toolExecution.ts"
Cohesion: 0.25
Nodes (9): executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets(), ToolExecutionResult, SENSITIVE_HEADER (+1 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "offices.ts"
Cohesion: 0.33
Nodes (4): createOffice(), ensureDefaultOffice(), Office, offices

### Community 102 - "agentRuntime.ts"
Cohesion: 0.27
Nodes (11): AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask(), inputToText(), parseJsonOutput() (+3 more)

### Community 103 - "eventTrigger.ts"
Cohesion: 0.21
Nodes (25): buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), normalizeCondition(), readEventTriggerConfig() (+17 more)

### Community 104 - "db.ts"
Cohesion: 0.08
Nodes (22): auth, db, mongoClient, col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus (+14 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): TokenUsage, dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "runProcessor.ts"
Cohesion: 0.13
Nodes (30): runEventKey(), createLiveTracker(), findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor() (+22 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "floorWork.ts"
Cohesion: 0.15
Nodes (15): Agent, AgentAppGrant, CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows() (+7 more)

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "interactiveRoutes.integration.test.mjs"
Cohesion: 0.48
Nodes (6): comSessao(), criarAgente(), esperarCobranca(), patch(), somar(), tokensDoDono()

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "jsonSchema.ts"
Cohesion: 0.23
Nodes (14): runResolvedTool(), checkStageOutput(), checkJsonText(), JsonCheck, parseJsonText(), describeErrors(), join(), matchesType() (+6 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "floorCommunication.ts"
Cohesion: 0.15
Nodes (14): Building, updateBuilding(), buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES (+6 more)

### Community 120 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 123 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 124 - "gateWiring.integration.test.mjs"
Cohesion: 0.53
Nodes (5): agents(), insertAgent(), insertSector(), sectors(), threeAnswers()

### Community 125 - "seedAgentBubbles.ts"
Cohesion: 0.60
Nodes (4): ensureAgentLiveStateIndexes(), arg(), main(), SHOWCASE

### Community 126 - "channelApps.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addChannel(), addEmptyInstallation(), connections(), widgets()

### Community 127 - "channelOverview.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addWidget(), messages(), say(), widgets()

### Community 129 - "engine.ts"
Cohesion: 0.14
Nodes (19): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+11 more)

### Community 131 - "sourceCheckpoint.integration.test.mjs"
Cohesion: 0.25
Nodes (5): agora, AUTOMACAO, FONTE, OUTRA_FONTE, QUANDO

### Community 133 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 134 - "sourceTool.integration.test.mjs"
Cohesion: 0.20
Nodes (6): AGENTE, agenteFalso, ANDAR, FEED(), itensDoFeed, servidor

### Community 135 - "timeoutCancellation.test.mjs"
Cohesion: 0.40
Nodes (4): AnthropicFalso, comportamento, contadora(), espera()

### Community 140 - "AppDefinition"
Cohesion: 0.38
Nodes (7): adapters, manifest, native(), num(), schema(), str(), AppDefinition

### Community 146 - "getAgentById"
Cohesion: 0.40
Nodes (5): getAgentById(), resolveOwnedAgentId(), resolveSectorMembers(), resolveSectorTeamFields(), requireAgent()

### Community 147 - "runConfig.ts"
Cohesion: 0.18
Nodes (12): dentro(), LIMITS, MATRIX, ModelCapabilities, normalizeRunConfig(), numeroFinito(), REASONING_EFFORTS, ReasoningEffort (+4 more)

### Community 149 - "openai.ts"
Cohesion: 0.05
Nodes (72): ToolCallRecord, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), FALLBACK_MODELS (+64 more)

### Community 150 - "agentLiveTracker.ts"
Cohesion: 0.24
Nodes (7): AgentBubbleState, catalogIndex(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail(), SYSTEM_APPS

### Community 151 - "googleTools.ts"
Cohesion: 0.57
Nodes (4): googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 152 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 153 - "floors.ts"
Cohesion: 0.13
Nodes (23): BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE, isValidTimezone(), LANGUAGES, collection, createFloor() (+15 more)

### Community 155 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 156 - "lexicalRetrieval.ts"
Cohesion: 0.30
Nodes (11): searchKnowledgeLexicallyForOwners(), escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm, normalize(), pad() (+3 more)

### Community 158 - "agentTools.ts"
Cohesion: 0.32
Nodes (7): AgentTool, legacyToolToExecutable(), MAX_TOOL_ITERATIONS, resolveHttpTool(), toolInputSchema(), ExecutableTool, TOOL_DEFAULTS

### Community 159 - "connections/service.ts"
Cohesion: 0.10
Nodes (18): connections, deliveries, listDeliveries(), sentDeliveriesByAgent(), CONNECTION_CATALOG, createConnection(), CreateConnectionInput, isNonEmpty() (+10 more)

### Community 165 - "selectVisualStates"
Cohesion: 0.33
Nodes (5): agentLiveStatesForFloor(), rank(), selectVisualStates(), NOW, row()

## Knowledge Gaps
- **583 isolated node(s):** `name`, `version`, `type`, `main`, `dev` (+578 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.167) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `runProcessor.ts`?**
  _High betweenness centrality (0.167) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `sourceCheckpoint.integration.test.mjs`, `sourceTool.integration.test.mjs`, `toolsSecurity.test.mjs`, `sectorTeam.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `hardening.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `executionModes.integration.test.mjs`, `migrationFixture.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `memoryStore.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sourceStaleRun.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `interactiveRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `appRoutes.integration.test.mjs`, `floorWork.integration.test.mjs`, `gateWiring.integration.test.mjs`, `channelApps.integration.test.mjs`, `channelOverview.integration.test.mjs`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `type` to the rest of the system?**
  _583 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `automations/types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12857142857142856 - nodes in this community are weakly interconnected._
- **Should `knowledge.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09782608695652174 - nodes in this community are weakly interconnected._