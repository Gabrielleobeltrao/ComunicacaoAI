# Graph Report - backend  (2026-08-18)

## Corpus Check
- 288 files · ~294,611 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2479 nodes · 5734 edges · 173 communities (149 shown, 24 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5528c78f`
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
- navigation.ts
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
- db.ts
- sectors.ts
- runRepository.ts
- sourceMonitoring.test.mjs
- runProcessor.ts
- openai.ts
- claude.ts
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
- channelApps.ts
- floorRoutes.ts
- sectorExecutions.ts
- llmFake.ts
- entrypointParity.test.mjs
- automations/service.ts
- agentDefinition.ts
- agentRoutineRoutes.ts
- apps/types.ts
- tokenUsage.ts
- run-tests.mjs
- scheduler.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- clarify.ts
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- toolExecution.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- floorCommunication.ts
- sectorAccess.integration.test.mjs
- connections/service.ts
- collaborationGate.test.mjs
- floorWork.integration.test.mjs
- gateWiring.integration.test.mjs
- runService.ts
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
- toolsSecurity.test.mjs
- safeHttp.ts
- agentTools.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- sectorDecisions.ts
- official/index.ts
- appRoutes.integration.test.mjs
- buildClient
- rd-station/adapter.ts
- conversationTurns.ts
- lexicalRetrieval.ts
- floors.ts
- buildGuardrailCheckPrompt
- googleCalendar.ts
- scopeGate.test.mjs
- builtinTools.ts
- sourceSsrf.test.mjs
- floorWork.ts
- playgroundSession.ts
- hubspot/adapter.ts
- autoModel.ts
- email/manifest.ts
- whatsapp/manifest.ts
- sectorBriefing.ts
- mercado-pago/adapter.ts
- buildSectorPlannerPrompt
- buildStageTransitionPrompt

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
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `buildDeps()` --indirect_call--> `resolveOwnedSectorId()`  [INFERRED]
  src/automations/runProcessor.ts → src/sectors.ts
- `resolveOwnedAgentId()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts
- `resolveSectorMembers()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (173 total, 24 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.11
Nodes (26): SUPPORTED_IMAGE_TYPES, auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput(), FAKE_LLM_ENABLED, generateAgentReply() (+18 more)

### Community 1 - "eventTrigger.ts"
Cohesion: 0.21
Nodes (27): buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), readEventTriggerConfig(), updateEventTrigger() (+19 more)

### Community 2 - "sectorAccess.ts"
Cohesion: 0.20
Nodes (15): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+7 more)

### Community 3 - "agentRuntime.ts"
Cohesion: 0.12
Nodes (27): enforceOutputContract(), AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson() (+19 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.10
Nodes (23): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), documents, EMBEDDING_DIMENSIONS (+15 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.05
Nodes (61): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc (+53 more)

### Community 6 - "src/index.ts"
Cohesion: 0.05
Nodes (38): backfillAgentEventAttempts(), ensureAgentEventIndexes(), telemetrySince(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), formatOptions() (+30 more)

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
Nodes (32): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+24 more)

### Community 11 - "refreshMemoryAndIdentity"
Cohesion: 0.11
Nodes (27): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+19 more)

### Community 12 - "runner.ts"
Cohesion: 0.05
Nodes (71): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), publishedSourceFingerprint(), RoutineSource, AgentCall (+63 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.06
Nodes (39): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentBubbleState, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail (+31 more)

### Community 14 - "delegation.ts"
Cohesion: 0.08
Nodes (46): presetSpec(), suggestPresetForCapability(), clarificationFrom(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing (+38 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.06
Nodes (17): FLOOR, PAGE, OPCOES, AGENTE, SETOR, startMongo(), stopMongo(), A (+9 more)

### Community 16 - "automations/types.ts"
Cohesion: 0.17
Nodes (11): AI_STEP_TYPES, AutomationInput, AutomationLimits, DEFAULT_LIMITS, DeliveryTarget, EXECUTION_MODES, ManualTrigger, RetryPolicy (+3 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (21): extractTextFromFile(), getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia() (+13 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.12
Nodes (20): AgentEventStatus, RecordAgentEventInput, LiveTracker, AgentExecutionRequest, AgentExecutionResult, ResolvedTool, executeRoutineStep(), KnowledgeUnavailableError (+12 more)

### Community 20 - "navigation.ts"
Cohesion: 0.19
Nodes (16): listInstallations(), buildNavigation(), dropPinsForApp(), getNavigationPreferences(), MAX_PINNED_APPS, NavigationApp, NavigationAppStatus, preferences (+8 more)

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

### Community 30 - "widgets.ts"
Cohesion: 0.07
Nodes (31): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 31 - "db.ts"
Cohesion: 0.20
Nodes (9): auth, db, mongoClient, AgentDoc, Sector, listToolCalls(), logToolCalls(), ToolCallLog (+1 more)

### Community 32 - "sectors.ts"
Cohesion: 0.12
Nodes (25): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+17 more)

### Community 33 - "runRepository.ts"
Cohesion: 0.10
Nodes (23): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+15 more)

### Community 35 - "runProcessor.ts"
Cohesion: 0.09
Nodes (27): agentIdsOf(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact(), insertStepRun(), updateRun(), preview() (+19 more)

### Community 36 - "openai.ts"
Cohesion: 0.16
Nodes (17): listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), AUXILIARY_MODEL, DEFAULT_MODEL (+9 more)

### Community 37 - "claude.ts"
Cohesion: 0.15
Nodes (14): anthropicUsage(), AUXILIARY_MODEL, DEFAULT_MODEL, FALLBACK_MODELS, generateAgentReply(), ANTHROPIC_AUX_MODEL, ANTHROPIC_DEFAULT_MODEL, auxModelOf() (+6 more)

### Community 38 - "tools.ts"
Cohesion: 0.09
Nodes (21): clamp(), createTool(), deleteTool(), getTool(), getToolsByIds(), listTools(), normalize(), TOOL_AUTH_KINDS (+13 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.11
Nodes (22): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+14 more)

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
Cohesion: 0.15
Nodes (18): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installationPublic(), installations, LEGACY_APP_VERSION, markInstallationTested() (+10 more)

### Community 48 - "googleTools.ts"
Cohesion: 0.33
Nodes (7): adapters, manifest, getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

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
Cohesion: 0.12
Nodes (25): backfillManagedChannelInstallations(), ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), findAutomation(), backfillSourceFingerprints() (+17 more)

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
Cohesion: 0.10
Nodes (33): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow, recordAgentEvent() (+25 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, signBody() (+4 more)

### Community 84 - "systemPrompt.ts"
Cohesion: 0.12
Nodes (14): buildClarificationInstruction(), buildIdentityCaptureInstruction(), buildLanguageInstruction(), buildProactivityInstruction(), buildResponseStyleInstruction(), DETAIL_INSTRUCTIONS, formatStructuredMemory(), GUARDRAIL_REFUSAL_MESSAGE (+6 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.20
Nodes (14): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+6 more)

### Community 97 - "floorRoutes.ts"
Cohesion: 0.21
Nodes (10): agentStatesForFloor(), floorMetrics, ValidationError, appGrantRouter, auditEntity(), connectionRouter, floorRouter, fail() (+2 more)

### Community 98 - "sectorExecutions.ts"
Cohesion: 0.11
Nodes (23): resolveOwnedSectorId(), PERIODS, requireSector(), sectorExecutionRouter, requireSector(), agentEvents, durationOf(), ExecutionEnvironment (+15 more)

### Community 99 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "automations/service.ts"
Cohesion: 0.10
Nodes (32): ensureActivationMode(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition() (+24 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.11
Nodes (28): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+20 more)

### Community 103 - "agentRoutineRoutes.ts"
Cohesion: 0.11
Nodes (43): getAgentById(), StepCondition, EventTriggerError, EventTriggerSpec, normalizeCondition(), webhookEndpoint(), AppActionPlan, MemoryPlan (+35 more)

### Community 104 - "apps/types.ts"
Cohesion: 0.11
Nodes (25): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+17 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.16
Nodes (19): TokenUsage, attemptChargeKey(), dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage() (+11 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "scheduler.ts"
Cohesion: 0.25
Nodes (12): findVersion(), advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, planSchedules() (+4 more)

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
Cohesion: 0.27
Nodes (8): ClarificationRequest, CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarificationGuidance(), CLARIFY_LIMIT, clarifyBudgetSpent()

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "interactiveRoutes.integration.test.mjs"
Cohesion: 0.43
Nodes (7): comSessao(), criarAgente(), esperarCobranca(), esperarTurnos(), patch(), somar(), tokensDoDono()

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "toolExecution.ts"
Cohesion: 0.20
Nodes (12): decrypt(), getKey(), executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets() (+4 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "floorCommunication.ts"
Cohesion: 0.21
Nodes (12): buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode, FloorLink (+4 more)

### Community 120 - "sectorAccess.integration.test.mjs"
Cohesion: 0.18
Nodes (5): runs(), wipe(), COORD, OUTSIDER, STAGE_AGENT

### Community 121 - "connections/service.ts"
Cohesion: 0.21
Nodes (11): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, decryptConfig(), getConnection(), isNonEmpty(), normalizeName(), patchConnection() (+3 more)

### Community 123 - "floorWork.integration.test.mjs"
Cohesion: 0.47
Nodes (4): agents(), insertAgent(), insertSector(), sectors()

### Community 124 - "gateWiring.integration.test.mjs"
Cohesion: 0.53
Nodes (5): agents(), insertAgent(), insertSector(), sectors(), threeAnswers()

### Community 125 - "runService.ts"
Cohesion: 0.36
Nodes (8): createLiveTracker(), insertRunIdempotent(), createRun(), CreateRunInput, AutomationRun, SafeRunError, TriggerType, runExecutionKey()

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

### Community 133 - "scopeCache.ts"
Cohesion: 0.31
Nodes (8): cache, chaveDe(), Entrada, normalizar(), rememberedScope(), rememberScope(), checkScope(), ScopeVerdict

### Community 134 - "sourceTool.integration.test.mjs"
Cohesion: 0.20
Nodes (6): AGENTE, agenteFalso, ANDAR, FEED(), itensDoFeed, servidor

### Community 135 - "timeoutCancellation.test.mjs"
Cohesion: 0.40
Nodes (4): AnthropicFalso, comportamento, contadora(), espera()

### Community 139 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 140 - "agentTools.ts"
Cohesion: 0.32
Nodes (7): AgentTool, legacyToolToExecutable(), MAX_TOOL_ITERATIONS, resolveHttpTool(), toolInputSchema(), ExecutableTool, TOOL_DEFAULTS

### Community 146 - "sectorDecisions.ts"
Cohesion: 0.29
Nodes (5): aggregateSectorDecisions(), listSectorDecisionsForConversation(), SectorDecision, SectorDecisionAggregate, sectorDecisions

### Community 147 - "official/index.ts"
Cohesion: 0.12
Nodes (12): MODULES, OFFICIAL_ADAPTERS, OFFICIAL_APPS, OfficialAppsError, OfficialModule, adapters, manifest, adapters (+4 more)

### Community 149 - "buildClient"
Cohesion: 0.18
Nodes (17): buildClient(), extractIdentity(), extractStructuredOutput(), transcribeImage(), updateMemory(), updateStructuredMemory(), buildClient(), extractIdentity() (+9 more)

### Community 151 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 152 - "lexicalRetrieval.ts"
Cohesion: 0.30
Nodes (11): searchKnowledgeLexicallyForOwners(), escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm, normalize(), pad() (+3 more)

### Community 153 - "floors.ts"
Cohesion: 0.12
Nodes (30): buildingOverview(), Building, BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE, ensureDefaultBuilding(), isValidTimezone() (+22 more)

### Community 156 - "buildGuardrailCheckPrompt"
Cohesion: 0.67
Nodes (4): checkGuardrail(), checkGuardrail(), buildGuardrailCheckPrompt(), parseInScopeResult()

### Community 157 - "googleCalendar.ts"
Cohesion: 0.18
Nodes (14): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse, deleteIntegration() (+6 more)

### Community 159 - "builtinTools.ts"
Cohesion: 0.18
Nodes (15): adapters, manifest, APP_GUIDES, BUILTIN_APPS, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, hubspotTools() (+7 more)

### Community 165 - "floorWork.ts"
Cohesion: 0.18
Nodes (15): Agent, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows() (+7 more)

### Community 167 - "playgroundSession.ts"
Cohesion: 0.25
Nodes (8): guardarTurnoDeTeste(), appendPlaygroundTurns(), clearPlaygroundTurns(), cortar(), loadPlaygroundTurns(), PlaygroundSession, PlaygroundTurn, sessions

### Community 170 - "autoModel.ts"
Cohesion: 0.29
Nodes (7): AUTO_MODEL, AutoModelChoice, chooseModelTier(), ModelTier, POR_PRESET, resolveAutoModel(), auxModelFor()

### Community 175 - "sectorBriefing.ts"
Cohesion: 0.70
Nodes (4): BriefingMember, coordinatorBriefing(), limpar(), linhaDe()

### Community 179 - "buildSectorPlannerPrompt"
Cohesion: 0.67
Nodes (4): planSectorResponse(), planSectorResponse(), buildSectorPlannerPrompt(), parseSectorPlan()

### Community 180 - "buildStageTransitionPrompt"
Cohesion: 0.67
Nodes (4): planStageTransition(), planStageTransition(), buildStageTransitionPrompt(), parseStageTransition()

## Knowledge Gaps
- **609 isolated node(s):** `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget`, `DelegationDenyCode`, `DelegationCheck`, `OPEN_COMMUNICATION` (+604 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `tokenUsage.ts` to `runProcessor.ts`, `delegationWiring.ts`?**
  _High betweenness centrality (0.153) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `tokenUsage.ts` to `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.152) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `sourceCheckpoint.integration.test.mjs`, `sourceTool.integration.test.mjs`, `toolsSecurity.test.mjs`, `appRoutes.integration.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`, `hardening.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `executionModes.integration.test.mjs`, `migrationFixture.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `memoryStore.integration.test.mjs`, `agentLiveState.integration.test.mjs`, `executionRoots.integration.test.mjs`, `sourceStaleRun.integration.test.mjs`, `sectorExecutions.integration.test.mjs`, `interactiveRoutes.integration.test.mjs`, `appMigration.integration.test.mjs`, `sectorAccess.integration.test.mjs`, `floorWork.integration.test.mjs`, `gateWiring.integration.test.mjs`, `channelApps.integration.test.mjs`, `channelOverview.integration.test.mjs`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget`, `DelegationDenyCode` to the rest of the system?**
  _609 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `llm.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10591133004926108 - nodes in this community are weakly interconnected._
- **Should `agentRuntime.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11724137931034483 - nodes in this community are weakly interconnected._