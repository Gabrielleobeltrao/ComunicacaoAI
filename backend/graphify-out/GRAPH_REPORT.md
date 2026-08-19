# Graph Report - backend  (2026-08-19)

## Corpus Check
- 298 files · ~318,595 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2606 nodes · 6033 edges · 183 communities (155 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `33a27f25`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- widgets.ts
- sourceCheckpoint.ts
- agentRuntime.ts
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
- automations/types.ts
- whatsapp.ts
- patterns.ts
- routineExecution.ts
- runProcessor.ts
- googleCalendar.ts
- dependencies
- agentMetrics.ts
- migration.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- routine.ts
- runRepository.ts
- sectorExecutions.ts
- sectorAccess.ts
- sourceMonitoring.test.mjs
- connections/service.ts
- agentTools.ts
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
- agentRoutineRoutes.ts
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
- scheduler.ts
- delegationWiring.ts
- automations/repository.ts
- routine.test.mjs
- seedGuard.test.mjs
- sectorPlanner.ts
- seedRestaurantDemo.ts
- db.ts
- openai.ts
- claude.ts
- systemPrompt.ts
- entrypointParity.test.mjs
- automations/service.ts
- agentDefinition.ts
- installations.ts
- interactiveRun.ts
- tokenUsage.ts
- run-tests.mjs
- builtinTools.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- clarify.ts
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- sectors.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- runConfig.ts
- sectorMembership.ts
- autoModel.ts
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
- ChatTurn
- sourceTool.integration.test.mjs
- timeoutCancellation.test.mjs
- safeError.ts
- conversationTurns.ts
- lexicalRetrieval.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- executionTrace.ts
- config.ts
- appRoutes.integration.test.mjs
- buildClient
- agentEvents.ts
- runResolvedTool
- sectorDecisions.ts
- floors.ts
- toolsSecurity.test.mjs
- tokensByModel.integration.test.mjs
- sectorPlanner.test.mjs
- scopeGate.test.mjs
- AppDefinition
- mercado-pago/adapter.ts
- hardening.integration.test.mjs
- sourceSsrf.test.mjs
- buildSectorPlannerPrompt
- floorWork.ts
- buildStageTransitionPrompt
- auditSectorFloorIntegrity.ts
- official/index.ts
- scheduler.integration.test.mjs
- webSourcePolicy.test.mjs
- auditMiddleware.ts
- webKnowledge.ts
- apps/types.ts
- sectorBriefing.ts
- googleTools.ts
- hubspot/adapter.ts
- rd-station/adapter.ts
- email/manifest.ts
- whatsapp/manifest.ts

## God Nodes (most connected - your core abstractions)
1. `respondWithAgentIfLinked()` - 55 edges
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
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `floorWorkOverview` --indirect_call--> `withAgentDefaults()`  [INFERRED]
  src/floorWork.ts → src/agents.ts
- `buildDeps()` --indirect_call--> `getAgentById()`  [INFERRED]
  src/automations/runProcessor.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (183 total, 28 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.10
Nodes (28): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, askAux(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput() (+20 more)

### Community 1 - "widgets.ts"
Cohesion: 0.08
Nodes (32): ensureActivationMode(), addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel() (+24 more)

### Community 2 - "sourceCheckpoint.ts"
Cohesion: 0.15
Nodes (16): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), acquireSourceLease(), advanceCheckpoint(), beginCheck() (+8 more)

### Community 3 - "agentRuntime.ts"
Cohesion: 0.24
Nodes (12): AgentOutputFormat, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask(), inputToText() (+4 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.10
Nodes (23): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), documents, EMBEDDING_DIMENSIONS (+15 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (49): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+41 more)

### Community 6 - "src/index.ts"
Cohesion: 0.04
Nodes (43): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), app, AVATAR_MIME_TYPES (+35 more)

### Community 7 - "audit.ts"
Cohesion: 0.11
Nodes (25): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic, AuditFilters (+17 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (50): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentToolHeader, AgentToolParam (+42 more)

### Community 9 - "grants.ts"
Cohesion: 0.17
Nodes (22): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+14 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (32): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+24 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.08
Nodes (39): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+31 more)

### Community 12 - "runner.ts"
Cohesion: 0.09
Nodes (44): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, MemoryOps, runDefinition(), RunnerDeps (+36 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.08
Nodes (33): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentBubbleState, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail (+25 more)

### Community 14 - "delegation.ts"
Cohesion: 0.10
Nodes (34): presetSpec(), suggestPresetForCapability(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing, checkDelegation() (+26 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.06
Nodes (16): FLOOR, PAGE, OPCOES, AGENTE, SETOR, startMongo(), stopMongo(), A (+8 more)

### Community 16 - "automations/types.ts"
Cohesion: 0.17
Nodes (11): AI_STEP_TYPES, AutomationInput, AutomationLimits, DEFAULT_LIMITS, DeliveryTarget, EXECUTION_MODES, ManualTrigger, RetryPolicy (+3 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (21): decrypt(), getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia() (+13 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.09
Nodes (30): catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail(), ToolTrace, AgentExecutionRequest (+22 more)

### Community 20 - "runProcessor.ts"
Cohesion: 0.15
Nodes (27): runEventKey(), createLiveTracker(), findAutomation(), findVersion(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun() (+19 more)

### Community 21 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (14): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse, deleteIntegration() (+6 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "migration.ts"
Cohesion: 0.12
Nodes (27): AgentBuiltinTool, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation(), ensureGoogleInstallations() (+19 more)

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

### Community 30 - "routine.ts"
Cohesion: 0.13
Nodes (49): StepCondition, buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers() (+41 more)

### Community 31 - "runRepository.ts"
Cohesion: 0.13
Nodes (21): artifacts, findRun(), insertRunIdempotent(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel() (+13 more)

### Community 32 - "sectorExecutions.ts"
Cohesion: 0.12
Nodes (20): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+12 more)

### Community 33 - "sectorAccess.ts"
Cohesion: 0.21
Nodes (14): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+6 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.09
Nodes (21): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), connections, deliveries, sentDeliveriesByAgent(), CONNECTION_CATALOG (+13 more)

### Community 36 - "agentTools.ts"
Cohesion: 0.16
Nodes (16): AgentTool, legacyToolToExecutable(), resolveHttpTool(), toolInputSchema(), ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate() (+8 more)

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
Nodes (21): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+13 more)

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
Cohesion: 0.19
Nodes (19): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), canonical() (+11 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "agentRoutineRoutes.ts"
Cohesion: 0.12
Nodes (30): getAgentById(), EventTriggerError, normalizeCondition(), webhookEndpoint(), listAgentAutomations(), listRoutines(), readSourceFromDefinition(), RoutineError (+22 more)

### Community 48 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.13
Nodes (17): resolveOwnedSectorId(), chunkText(), deleteDocument(), deleteDocumentFor(), getDocument(), getDocumentFor(), indexDocumentChunks(), KnowledgeDocument (+9 more)

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
Nodes (24): backfillManagedChannelInstallations(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes() (+16 more)

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

### Community 77 - "delegationWiring.ts"
Cohesion: 0.13
Nodes (23): resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), DelegationContext, TEAM_TOOL_NAMES, col, DelegationFinish, DelegationRecord (+15 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.20
Nodes (6): automations, listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.11
Nodes (35): executeSectorTeam(), stageInstruction(), assembleWithoutModel(), buildSynthesisContext(), dedupeAgainst(), describeMember(), describePlan(), ExecutionTask (+27 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 96 - "db.ts"
Cohesion: 0.16
Nodes (17): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+9 more)

### Community 97 - "openai.ts"
Cohesion: 0.19
Nodes (16): checkGuardrail(), listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), AUXILIARY_MODEL (+8 more)

### Community 98 - "claude.ts"
Cohesion: 0.14
Nodes (14): MAX_TOOL_ITERATIONS, ToolCallRecord, AUXILIARY_MODEL, DEFAULT_MODEL, FALLBACK_MODELS, AgentReplyResult, TokenUsage, ANTHROPIC_AUX_MODEL (+6 more)

### Community 99 - "systemPrompt.ts"
Cohesion: 0.13
Nodes (12): DETAIL_INSTRUCTIONS, GUARDRAIL_REFUSAL_MESSAGE, GUARDRAIL_SCOPE_INSTRUCTION, HANDOFF_INSTRUCTION, HANDOFF_MARKER, IDENTITY_EXTRACTION_SYSTEM_PROMPT, LANGUAGE_INSTRUCTIONS, MEMORY_UPDATE_SYSTEM_PROMPT (+4 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "automations/service.ts"
Cohesion: 0.09
Nodes (39): findByWebhookKey(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition() (+31 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.18
Nodes (17): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+9 more)

### Community 103 - "installations.ts"
Cohesion: 0.09
Nodes (34): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installationPublic(), installations, LEGACY_APP_VERSION, listInstallations() (+26 more)

### Community 104 - "interactiveRun.ts"
Cohesion: 0.22
Nodes (11): enforceOutputContract(), AgentRunError, comPrazo(), describeDropped(), espera(), InteractiveReply, InteractiveRunResult, runInteractive() (+3 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "builtinTools.ts"
Cohesion: 0.18
Nodes (15): adapters, manifest, APP_GUIDES, BUILTIN_APPS, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, hubspotTools() (+7 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.16
Nodes (12): AGENT, agentDoc(), ALVO, alvoDoc(), base, call, ctx, depsDelegacao() (+4 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "clarify.ts"
Cohesion: 0.24
Nodes (9): clarificationFrom(), ClarificationRequest, CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarificationGuidance(), CLARIFY_LIMIT (+1 more)

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "interactiveRoutes.integration.test.mjs"
Cohesion: 0.43
Nodes (7): comSessao(), criarAgente(), esperarCobranca(), esperarTurnos(), patch(), somar(), tokensDoDono()

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "sectors.ts"
Cohesion: 0.18
Nodes (16): createSector(), deleteSector(), enforceSingleMembership(), membersFromStages(), normalizeMembers(), normalizeStages(), SECTOR_MODE_LABEL, SECTOR_MODES (+8 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "runConfig.ts"
Cohesion: 0.18
Nodes (12): dentro(), LIMITS, MATRIX, ModelCapabilities, normalizeRunConfig(), numeroFinito(), REASONING_EFFORTS, ReasoningEffort (+4 more)

### Community 120 - "sectorMembership.ts"
Cohesion: 0.24
Nodes (9): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, MAX_SECTOR_MEMBERS, SectorMember (+1 more)

### Community 121 - "autoModel.ts"
Cohesion: 0.29
Nodes (7): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), auxModelFor()

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
Cohesion: 0.16
Nodes (17): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+9 more)

### Community 131 - "sourceCheckpoint.integration.test.mjs"
Cohesion: 0.25
Nodes (5): agora, AUTOMACAO, FONTE, OUTRA_FONTE, QUANDO

### Community 133 - "ChatTurn"
Cohesion: 0.27
Nodes (9): cache, chaveDe(), Entrada, normalizar(), rememberedScope(), rememberScope(), checkScope(), ScopeVerdict (+1 more)

### Community 134 - "sourceTool.integration.test.mjs"
Cohesion: 0.20
Nodes (7): AGENTE, agenteFalso, ANDAR, FEED(), itensDoFeed, servidor, site()

### Community 135 - "timeoutCancellation.test.mjs"
Cohesion: 0.40
Nodes (4): AnthropicFalso, comportamento, contadora(), espera()

### Community 137 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 139 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 140 - "lexicalRetrieval.ts"
Cohesion: 0.20
Nodes (17): searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm (+9 more)

### Community 146 - "executionTrace.ts"
Cohesion: 0.17
Nodes (11): ExecutionTraceEvent, onTraceEvent(), readTrace(), sanitize(), Sink, traceEvent(), TraceEventType, TraceInput (+3 more)

### Community 147 - "config.ts"
Cohesion: 0.21
Nodes (11): clientUrl, config, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig() (+3 more)

### Community 149 - "buildClient"
Cohesion: 0.15
Nodes (19): askAux(), buildClient(), extractIdentity(), extractStructuredOutput(), transcribeImage(), updateMemory(), updateStructuredMemory(), askAux() (+11 more)

### Community 150 - "agentEvents.ts"
Cohesion: 0.18
Nodes (12): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow (+4 more)

### Community 151 - "runResolvedTool"
Cohesion: 0.40
Nodes (6): runResolvedTool(), anthropicUsage(), generateAgentReply(), generateAgentReply(), buildSystemPrompt(), buildSystemPromptParts()

### Community 152 - "sectorDecisions.ts"
Cohesion: 0.29
Nodes (5): aggregateSectorDecisions(), listSectorDecisionsForConversation(), SectorDecision, SectorDecisionAggregate, sectorDecisions

### Community 153 - "floors.ts"
Cohesion: 0.07
Nodes (43): agentStatesForFloor(), buildingOverview(), floorMetrics, AutomationVersion, Building, BuildingLanguage, BuildingPatch, buildings (+35 more)

### Community 156 - "tokensByModel.integration.test.mjs"
Cohesion: 0.40
Nodes (3): AGENTE, ANDAR, ONTEM

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.33
Nodes (4): COZINHA, EQUIPE, FINANCEIRO, JURIDICO

### Community 159 - "AppDefinition"
Cohesion: 0.53
Nodes (5): native(), num(), schema(), str(), AppDefinition

### Community 164 - "buildSectorPlannerPrompt"
Cohesion: 0.67
Nodes (4): planSectorResponse(), planSectorResponse(), buildSectorPlannerPrompt(), parseSectorPlan()

### Community 165 - "floorWork.ts"
Cohesion: 0.10
Nodes (29): Agent, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows() (+21 more)

### Community 166 - "buildStageTransitionPrompt"
Cohesion: 0.67
Nodes (4): planStageTransition(), planStageTransition(), buildStageTransitionPrompt(), parseStageTransition()

### Community 168 - "official/index.ts"
Cohesion: 0.12
Nodes (12): MODULES, OFFICIAL_ADAPTERS, OFFICIAL_APPS, OfficialAppsError, OfficialModule, adapters, manifest, adapters (+4 more)

### Community 171 - "auditMiddleware.ts"
Cohesion: 0.19
Nodes (11): AuditAction, recordAudit(), safeMetadata(), entityLabelWithOwner(), auditRequests(), AuditTarget, auditTargetFor(), matches() (+3 more)

### Community 172 - "webKnowledge.ts"
Cohesion: 0.07
Nodes (44): WatchedSource, assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions (+36 more)

### Community 174 - "apps/types.ts"
Cohesion: 0.11
Nodes (25): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+17 more)

### Community 175 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

### Community 178 - "googleTools.ts"
Cohesion: 0.33
Nodes (7): adapters, manifest, getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

## Knowledge Gaps
- **651 isolated node(s):** `AGENT_PRESETS`, `ACTIVATION_MODES`, `LEGACY_ACTIVATION_MODES`, `DELEGATION_POLICIES`, `MetricProfile` (+646 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ensureAgentWebKnowledgeFresh()` connect `webKnowledge.ts` to `engine.ts`, `delegationWiring.ts`, `sourceTool.integration.test.mjs`, `agentRoutineRoutes.ts`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Why does `site()` connect `sourceTool.integration.test.mjs` to `webKnowledge.ts`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`, `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AGENT_PRESETS`, `ACTIVATION_MODES`, `LEGACY_ACTIVATION_MODES` to the rest of the system?**
  _651 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `llm.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1010752688172043 - nodes in this community are weakly interconnected._
- **Should `widgets.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07575757575757576 - nodes in this community are weakly interconnected._