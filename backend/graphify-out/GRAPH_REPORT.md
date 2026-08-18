# Graph Report - backend  (2026-08-18)

## Corpus Check
- 288 files · ~294,611 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2480 nodes · 5735 edges · 183 communities (153 shown, 30 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `57c9765a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- eventTrigger.ts
- sectorAccess.ts
- agentRuntime.ts
- knowledge.ts
- executionCenter.ts
- src/index.ts
- audit.ts
- agents.ts
- grants.ts
- agentReadiness.ts
- refreshMemoryAndIdentity
- runner.ts
- agentLiveState.ts
- delegation.ts
- mongoServer.mjs
- automations/types.ts
- whatsapp.ts
- patterns.ts
- routineExecution.ts
- delegateToAgent
- AppDefinition
- dependencies
- agentMetrics.ts
- migration.ts
- records.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- respondWithAgentIfLinked
- sectors.ts
- runRepository.ts
- sourceMonitoring.test.mjs
- connections/service.ts
- modelCache.ts
- openai.ts
- tools.ts
- eventTrigger.integration.test.mjs
- executionRoots.ts
- jsonSchema.ts
- executionModes.integration.test.mjs
- scripts
- validate.ts
- package.json
- migrationFixture.integration.test.mjs
- installations.ts
- googleTools.ts
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
- sectorKnowledgeRoutes.ts
- delegationWiring.ts
- automations/repository.ts
- routine.test.mjs
- seedGuard.test.mjs
- systemPrompt.ts
- seedRestaurantDemo.ts
- db.ts
- building.ts
- sectorExecutions.ts
- llmFake.ts
- entrypointParity.test.mjs
- automations/service.ts
- agentDefinition.ts
- agentRoutineRoutes.ts
- apps/manifest.ts
- tokenUsage.ts
- run-tests.mjs
- runProcessor.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- clarify.ts
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- agentTools.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- floorCommunication.ts
- sectorAccess.integration.test.mjs
- agentEvents.ts
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
- toolsSecurity.test.mjs
- safeHttp.ts
- sourceChange.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- safeError.ts
- official/index.ts
- appRoutes.integration.test.mjs
- claude.ts
- slack/adapter.ts
- conversationTurns.ts
- lexicalRetrieval.ts
- floors.ts
- web-chat/manifest.ts
- encrypt
- scopeGate.test.mjs
- builtinTools.ts
- apps/types.ts
- hardening.integration.test.mjs
- sourceSsrf.test.mjs
- sourceTool.ts
- sectorMembership.ts
- Agent
- sourceCheckpoint.ts
- playgroundSession.ts
- hubspot/adapter.ts
- sources.ts
- autoModel.ts
- email/manifest.ts
- liveSources.ts
- whatsapp/manifest.ts
- sectorBriefing.ts
- mercado-pago/adapter.ts
- nuvemshop/adapter.ts
- stripe/adapter.ts
- buildSectorPlannerPrompt
- buildStageTransitionPrompt
- getSectorById
- google/index.ts

## God Nodes (most connected - your core abstractions)
1. `respondWithAgentIfLinked()` - 53 edges
2. `db` - 51 edges
3. `startMongo()` - 41 edges
4. `stopMongo()` - 41 edges
5. `buildDeps()` - 39 edges
6. `getAgentById()` - 31 edges
7. `productionDelegationDeps()` - 27 edges
8. `encrypt()` - 26 edges
9. `refreshMemoryAndIdentity()` - 24 edges
10. `runMigrations()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `resolveOwnedAgentId()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts
- `resolveSectorMembers()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts
- `resolveSectorTeamFields()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (183 total, 30 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.17
Nodes (18): SUPPORTED_IMAGE_TYPES, auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput(), FAKE_LLM_ENABLED, generateAgentReply() (+10 more)

### Community 1 - "eventTrigger.ts"
Cohesion: 0.21
Nodes (27): buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), normalizeCondition(), readEventTriggerConfig() (+19 more)

### Community 2 - "sectorAccess.ts"
Cohesion: 0.21
Nodes (14): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+6 more)

### Community 3 - "agentRuntime.ts"
Cohesion: 0.12
Nodes (26): enforceOutputContract(), AgentExecutionResult, AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective() (+18 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.10
Nodes (23): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), documents, EMBEDDING_DIMENSIONS (+15 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (50): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+42 more)

### Community 6 - "src/index.ts"
Cohesion: 0.05
Nodes (38): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), ensureDelegationIndexes(), app, AVATAR_MIME_TYPES (+30 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (49): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentToolHeader, AgentToolParam (+41 more)

### Community 9 - "grants.ts"
Cohesion: 0.17
Nodes (22): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+14 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (31): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+23 more)

### Community 11 - "refreshMemoryAndIdentity"
Cohesion: 0.11
Nodes (27): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+19 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (23): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, MemoryOps, runDefinition(), RunnerDeps (+15 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.08
Nodes (32): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+24 more)

### Community 14 - "delegation.ts"
Cohesion: 0.09
Nodes (31): presetSpec(), suggestPresetForCapability(), buildCapabilityMissing(), CapabilityMissing, capabilityMissingTool(), childContext(), DEFAULT_DELEGATION_TOKEN_BUDGET, DELEGATION_MAX_DEPTH (+23 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.06
Nodes (17): FLOOR, PAGE, OPCOES, AGENTE, SETOR, startMongo(), stopMongo(), A (+9 more)

### Community 16 - "automations/types.ts"
Cohesion: 0.12
Nodes (22): CreateAutomationInput, UpdateDraftPatch, AI_STEP_TYPES, Automation, AutomationDefinition, AutomationInput, AutomationLimits, DEFAULT_LIMITS (+14 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (21): extractTextFromFile(), getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia() (+13 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.14
Nodes (16): RecordAgentEventInput, AgentBubbleState, instrumentTools(), LiveTracker, AgentExecutionRequest, ResolvedTool, executeRoutineStep(), KnowledgeUnavailableError (+8 more)

### Community 20 - "delegateToAgent"
Cohesion: 0.27
Nodes (14): agentCard(), asOutputFormat(), buildDelegationTools(), checkDelegation(), delegateToAgent(), delegateToSector(), gateContext(), gateTargetForAgent() (+6 more)

### Community 21 - "AppDefinition"
Cohesion: 0.53
Nodes (5): native(), num(), schema(), str(), AppDefinition

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "migration.ts"
Cohesion: 0.08
Nodes (45): catalogIndex(), LiveTrackerContext, NOOP_TRACKER, toolDetail(), AgentBuiltinTool, listInstallations(), agents, AppMigrationReport (+37 more)

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

### Community 30 - "widgets.ts"
Cohesion: 0.07
Nodes (31): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 31 - "respondWithAgentIfLinked"
Cohesion: 0.10
Nodes (19): clarificationGuidance(), CLARIFY_LIMIT, formatOptions(), resolveChoice(), semAcento(), sectorRunContext(), broadcastMessage(), respondWithAgentIfLinked() (+11 more)

### Community 32 - "sectors.ts"
Cohesion: 0.18
Nodes (16): createSector(), deleteSector(), enforceSingleMembership(), membersFromStages(), normalizeMembers(), normalizeStages(), SECTOR_MODE_LABEL, SECTOR_MODES (+8 more)

### Community 33 - "runRepository.ts"
Cohesion: 0.12
Nodes (21): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+13 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.09
Nodes (22): connections, deliveries, insertDeliveryIdempotent(), sentDeliveriesByAgent(), updateDelivery(), CONNECTION_CATALOG, createConnection(), CreateConnectionInput (+14 more)

### Community 36 - "modelCache.ts"
Cohesion: 0.29
Nodes (9): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), humanizeModelId(), isChatModel() (+1 more)

### Community 37 - "openai.ts"
Cohesion: 0.16
Nodes (17): checkGuardrail(), ANTHROPIC_AUX_MODEL, ANTHROPIC_DEFAULT_MODEL, OPENAI_AUX_MODEL, OPENAI_DEFAULT_MODEL, AUXILIARY_MODEL, buildClient(), checkGuardrail() (+9 more)

### Community 38 - "tools.ts"
Cohesion: 0.10
Nodes (20): clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS, TOOL_LIMITS (+12 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.10
Nodes (26): createLiveTracker(), findVersion(), insertRunIdempotent(), createRun(), analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope (+18 more)

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
Cohesion: 0.19
Nodes (19): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), canonical() (+11 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "installations.ts"
Cohesion: 0.13
Nodes (20): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installationPublic(), installations, LEGACY_APP_VERSION, markInstallationTested() (+12 more)

### Community 48 - "googleTools.ts"
Cohesion: 0.57
Nodes (4): googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

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

### Community 76 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.15
Nodes (14): chunkText(), deleteDocument(), deleteDocumentFor(), getDocument(), getDocumentFor(), indexDocumentChunks(), KnowledgeDocument, listDocuments() (+6 more)

### Community 77 - "delegationWiring.ts"
Cohesion: 0.15
Nodes (18): agentCanDelegate(), DelegationContext, DelegationDeps, TEAM_TOOL_NAMES, col, DelegationFinish, DelegationRecord, DelegationStart (+10 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.13
Nodes (13): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, AutomationVersion (+5 more)

### Community 84 - "systemPrompt.ts"
Cohesion: 0.13
Nodes (12): buildProactivityInstruction(), DETAIL_INSTRUCTIONS, formatStructuredMemory(), GUARDRAIL_CHECK_SYSTEM_PROMPT, GUARDRAIL_REFUSAL_MESSAGE, GUARDRAIL_SCOPE_INSTRUCTION, HANDOFF_INSTRUCTION, HANDOFF_MARKER (+4 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 96 - "db.ts"
Cohesion: 0.10
Nodes (23): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+15 more)

### Community 97 - "building.ts"
Cohesion: 0.15
Nodes (12): BuildingPatch, buildings, DEFAULT_TIMEZONE, LANGUAGES, ValidationError, appGrantRouter, auditEntity(), automationRouter (+4 more)

### Community 98 - "sectorExecutions.ts"
Cohesion: 0.12
Nodes (20): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, listSectorExecutions() (+12 more)

### Community 99 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "automations/service.ts"
Cohesion: 0.18
Nodes (20): ensureActivationMode(), getAgentById(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), defaultDefinition() (+12 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.10
Nodes (29): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+21 more)

### Community 103 - "agentRoutineRoutes.ts"
Cohesion: 0.12
Nodes (40): StepCondition, EventTriggerError, EventTriggerSpec, webhookEndpoint(), AppActionPlan, MemoryPlan, createRoutine(), getRoutineForAgent() (+32 more)

### Community 104 - "apps/manifest.ts"
Cohesion: 0.23
Nodes (13): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+5 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.16
Nodes (19): TokenUsage, attemptChargeKey(), dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey() (+11 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "runProcessor.ts"
Cohesion: 0.15
Nodes (25): livePassagesFor(), findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped() (+17 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "clarify.ts"
Cohesion: 0.32
Nodes (7): clarificationFrom(), ClarificationRequest, CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarifyBudgetSpent()

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "interactiveRoutes.integration.test.mjs"
Cohesion: 0.43
Nodes (7): comSessao(), criarAgente(), esperarCobranca(), esperarTurnos(), patch(), somar(), tokensDoDono()

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "agentTools.ts"
Cohesion: 0.15
Nodes (17): AgentTool, legacyToolToExecutable(), MAX_TOOL_ITERATIONS, resolveHttpTool(), toolInputSchema(), ExecutableTool, executeToolCall(), ExecuteToolOptions (+9 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "floorCommunication.ts"
Cohesion: 0.18
Nodes (14): Building, buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode (+6 more)

### Community 120 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 121 - "agentEvents.ts"
Cohesion: 0.18
Nodes (12): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow (+4 more)

### Community 123 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 124 - "gateWiring.integration.test.mjs"
Cohesion: 0.53
Nodes (5): agents(), insertAgent(), insertSector(), sectors(), threeAnswers()

### Community 126 - "channelApps.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addChannel(), addEmptyInstallation(), connections(), widgets()

### Community 127 - "channelOverview.integration.test.mjs"
Cohesion: 0.60
Nodes (4): addWidget(), messages(), say(), widgets()

### Community 129 - "engine.ts"
Cohesion: 0.07
Nodes (38): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+30 more)

### Community 131 - "sourceCheckpoint.integration.test.mjs"
Cohesion: 0.25
Nodes (5): agora, AUTOMACAO, FONTE, OUTRA_FONTE, QUANDO

### Community 133 - "ChatTurn"
Cohesion: 0.24
Nodes (10): InteractiveRunOptions, cache, chaveDe(), Entrada, normalizar(), rememberedScope(), rememberScope(), checkScope() (+2 more)

### Community 134 - "sourceTool.integration.test.mjs"
Cohesion: 0.20
Nodes (6): AGENTE, agenteFalso, ANDAR, FEED(), itensDoFeed, servidor

### Community 135 - "timeoutCancellation.test.mjs"
Cohesion: 0.40
Nodes (4): AnthropicFalso, comportamento, contadora(), espera()

### Community 139 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 140 - "sourceChange.ts"
Cohesion: 0.29
Nodes (11): detectRssChange(), HttpChange, INITIAL_WINDOWS, InitialWindow, pareceFeed(), RssChange, previewSource(), SourcePreview (+3 more)

### Community 146 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 147 - "official/index.ts"
Cohesion: 0.19
Nodes (8): MODULES, OFFICIAL_ADAPTERS, OfficialAppsError, OfficialModule, adapters, manifest, manifest, NativeFactory

### Community 149 - "claude.ts"
Cohesion: 0.14
Nodes (23): anthropicUsage(), AUXILIARY_MODEL, buildClient(), DEFAULT_MODEL, extractIdentity(), extractStructuredOutput(), FALLBACK_MODELS, generateAgentReply() (+15 more)

### Community 151 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 152 - "lexicalRetrieval.ts"
Cohesion: 0.30
Nodes (11): searchKnowledgeLexicallyForOwners(), escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm, normalize(), pad() (+3 more)

### Community 153 - "floors.ts"
Cohesion: 0.11
Nodes (35): agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, ensureDefaultBuilding(), isValidTimezone(), updateBuilding(), FloorCommunicationConfig (+27 more)

### Community 157 - "encrypt"
Cohesion: 0.18
Nodes (18): decrypt(), encrypt(), getKey(), buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus() (+10 more)

### Community 159 - "builtinTools.ts"
Cohesion: 0.17
Nodes (19): sourceSettingsOf(), resolveAppGrantTools(), APP_GUIDES, BUILTIN_APPS, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, getBuiltinApp() (+11 more)

### Community 160 - "apps/types.ts"
Cohesion: 0.14
Nodes (12): APP_ACTIVATIONS, APP_AVAILABILITIES, AppActionExecution, AppAuthDefinition, AppAuthField, AppAuthKind, AppAvailability, AppResourceField (+4 more)

### Community 163 - "sourceTool.ts"
Cohesion: 0.35
Nodes (10): RoutineSource, chaveDoItem(), contentHashOf(), detectHttpChange(), getCheckpoint(), FonteDoAgente, j(), normalizar() (+2 more)

### Community 164 - "sectorMembership.ts"
Cohesion: 0.22
Nodes (10): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, MAX_SECTOR_MEMBERS, Sector (+2 more)

### Community 165 - "Agent"
Cohesion: 0.27
Nodes (9): Agent, AgentAppGrant, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget (+1 more)

### Community 166 - "sourceCheckpoint.ts"
Cohesion: 0.22
Nodes (9): acquireSourceLease(), checkpoints, ehChaveDuplicada(), LEASE_MS, leases, MAX_SEEN_KEYS, SourceCheckpoint, SourceLease (+1 more)

### Community 167 - "playgroundSession.ts"
Cohesion: 0.25
Nodes (8): guardarTurnoDeTeste(), appendPlaygroundTurns(), clearPlaygroundTurns(), cortar(), loadPlaygroundTurns(), PlaygroundSession, PlaygroundTurn, sessions

### Community 169 - "sources.ts"
Cohesion: 0.57
Nodes (7): clean(), decodeEntities(), parseRssItems(), pick(), pickLink(), stripCdata(), stripTags()

### Community 170 - "autoModel.ts"
Cohesion: 0.29
Nodes (7): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), auxModelFor()

### Community 172 - "liveSources.ts"
Cohesion: 0.33
Nodes (5): LivePassage, liveStepIdFor(), STEP(), normalizeSourceUrl(), sourceFingerprint()

### Community 175 - "sectorBriefing.ts"
Cohesion: 0.70
Nodes (4): BriefingMember, coordinatorBriefing(), limpar(), linhaDe()

### Community 179 - "buildSectorPlannerPrompt"
Cohesion: 0.67
Nodes (4): planSectorResponse(), planSectorResponse(), buildSectorPlannerPrompt(), parseSectorPlan()

### Community 180 - "buildStageTransitionPrompt"
Cohesion: 0.67
Nodes (4): planStageTransition(), planStageTransition(), buildStageTransitionPrompt(), parseStageTransition()

### Community 181 - "getSectorById"
Cohesion: 0.50
Nodes (4): resolveOwnedSectorId(), requireSector(), requireSector(), getSectorById()

## Knowledge Gaps
- **609 isolated node(s):** `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget`, `DelegationDenyCode`, `DelegationCheck`, `OPEN_COMMUNICATION` (+604 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `tokenUsage.ts` to `hardening.integration.test.mjs`, `runProcessor.ts`?**
  _High betweenness centrality (0.161) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `hardening.integration.test.mjs` to `tokenUsage.ts`?**
  _High betweenness centrality (0.160) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `sourceCheckpoint.integration.test.mjs`, `sourceTool.integration.test.mjs`, `toolsSecurity.test.mjs`, `appRoutes.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `hardening.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `executionModes.integration.test.mjs`, `migrationFixture.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `memoryStore.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sourceStaleRun.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `interactiveRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `floorWork.integration.test.mjs`, `gateWiring.integration.test.mjs`, `sectorTeam.integration.test.mjs`, `channelApps.integration.test.mjs`, `channelOverview.integration.test.mjs`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget`, `DelegationDenyCode` to the rest of the system?**
  _609 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `agentRuntime.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1206896551724138 - nodes in this community are weakly interconnected._
- **Should `knowledge.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09782608695652174 - nodes in this community are weakly interconnected._