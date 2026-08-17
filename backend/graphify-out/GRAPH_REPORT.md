# Graph Report - backend  (2026-08-17)

## Corpus Check
- 264 files · ~262,989 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2321 nodes · 5345 edges · 155 communities (131 shown, 24 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 42 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cc261cce`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- floorWork.ts
- openai.ts
- runConfig.ts
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
- agentMetrics.ts
- migration.ts
- sectorKnowledgeRoutes.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- migrate.ts
- sectors.ts
- runRepository.ts
- sourceMonitoring.test.mjs
- sourceSsrf.test.mjs
- conversationTurns.ts
- official/index.ts
- tools.ts
- eventTrigger.integration.test.mjs
- executionRoots.ts
- automations/repository.ts
- start
- scripts
- validate.ts
- package.json
- connections/service.ts
- googleCalendar.ts
- Agent
- delegation.test.mjs
- runnerTimeout.test.mjs
- runtimeHardening.test.mjs
- schedulerPublish.integration.test.mjs
- agentEvents.ts
- agentHistory.integration.test.mjs
- auditRouteMap.test.mjs
- routineDelivery.integration.test.mjs
- deployment.test.mjs
- agentDefinition.test.mjs
- AppDefinition
- collaboration.test.mjs
- config.test.mjs
- groundingContract.test.mjs
- jsonSchema.test.mjs
- outputContract.test.mjs
- readiness.test.mjs
- automations.test.mjs
- dotenv
- floors.ts
- delegationWiring.ts
- automations/types.ts
- routine.test.mjs
- seedGuard.test.mjs
- privateApps.ts
- ExecutionMode
- db.ts
- installations.ts
- sectorExecutions.ts
- toolExecution.ts
- records.ts
- runService.ts
- interactiveRun.test.mjs
- eventTrigger.ts
- builtinTools.ts
- tokenUsage.ts
- run-tests.mjs
- runProcessor.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- AgentExecutionRequest
- sectorExecutions.integration.test.mjs
- entrypointParity.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- agentRuntime.ts
- executionModes.integration.test.mjs
- appMigration.integration.test.mjs
- appGrantRoutes.ts
- sectorAccess.integration.test.mjs
- appRoutes.integration.test.mjs
- collaborationGate.test.mjs
- floorWork.integration.test.mjs
- gateWiring.integration.test.mjs
- rd-station/adapter.ts
- channelApps.integration.test.mjs
- channelOverview.integration.test.mjs
- llmFakeGate.test.mjs
- engine.ts
- logHygiene.test.mjs
- sourceCheckpoint.integration.test.mjs
- cron-parser
- stripe/adapter.ts
- providerPayload.test.mjs
- runQueue.integration.test.mjs
- GroundingRequiredError
- migrationFixture.integration.test.mjs
- llmFake.ts
- agentTools.ts
- ToolValidationError
- memoryStore.integration.test.mjs
- candleAnalyzer.test.mjs
- mercado-pago/adapter.ts
- claude.ts
- seedRestaurantDemo.ts
- telegram/manifest.ts
- safeHttp.ts
- config.ts
- timeoutCancellation.test.mjs

## God Nodes (most connected - your core abstractions)
1. `db` - 50 edges
2. `respondWithAgentIfLinked()` - 40 edges
3. `buildDeps()` - 39 edges
4. `startMongo()` - 35 edges
5. `stopMongo()` - 35 edges
6. `getAgentById()` - 30 edges
7. `encrypt()` - 26 edges
8. `refreshMemoryAndIdentity()` - 24 edges
9. `productionDelegationDeps()` - 24 edges
10. `AppDefinition` - 23 edges

## Surprising Connections (you probably didn't know these)
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts
- `resolveOwnedAgentId()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts
- `resolveSectorMembers()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (155 total, 24 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.16
Nodes (19): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, auxiliaryModel(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), FAKE_LLM_ENABLED, generateAgentReply() (+11 more)

### Community 1 - "floorWork.ts"
Cohesion: 0.13
Nodes (18): DELEGATION_MAX_DEPTH, buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode (+10 more)

### Community 2 - "openai.ts"
Cohesion: 0.16
Nodes (22): extractIdentity(), listAvailableModels(), cache, cacheKey(), getCachedModels(), ModelOption, setCachedModels(), AUXILIARY_MODEL (+14 more)

### Community 3 - "runConfig.ts"
Cohesion: 0.10
Nodes (27): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveAgentRun(), resolveCache(), ResolvedAgentRun (+19 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.10
Nodes (23): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), documents, EMBEDDING_DIMENSIONS (+15 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (48): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+40 more)

### Community 6 - "src/index.ts"
Cohesion: 0.04
Nodes (44): stopEmbeddedEngine(), app, AVATAR_MIME_TYPES, channelWebhookUrl(), httpServer, io, isValidWebhookUrl(), MEDIA_LABEL (+36 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (35): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+27 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (44): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentTool, AgentToolHeader, AgentToolParam (+36 more)

### Community 9 - "grants.ts"
Cohesion: 0.18
Nodes (21): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+13 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.08
Nodes (31): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+23 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.07
Nodes (43): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+35 more)

### Community 12 - "runner.ts"
Cohesion: 0.08
Nodes (47): publishedSourceFingerprint(), AgentCall, delay(), DeliverCall, executeStep(), FetchResult, MemoryOps, runDefinition() (+39 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.08
Nodes (32): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+24 more)

### Community 14 - "delegation.ts"
Cohesion: 0.11
Nodes (36): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, checkCollaboration(), agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools() (+28 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.08
Nodes (9): FLOOR, PAGE, startMongo(), stopMongo(), A, B, automations(), seedSchedule() (+1 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.12
Nodes (35): EventTriggerError, normalizeCondition(), webhookEndpoint(), listAutomations(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines() (+27 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.11
Nodes (19): AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER, toolDetail(), SYSTEM_APPS (+11 more)

### Community 20 - "automations/service.ts"
Cohesion: 0.16
Nodes (23): ensureActivationMode(), getAgentById(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), defaultDefinition() (+15 more)

### Community 21 - "apps/types.ts"
Cohesion: 0.11
Nodes (25): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+17 more)

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (21): @anthropic-ai/sdk, better-auth, cors, multer, nodemailer, openai, dependencies, @anthropic-ai/sdk (+13 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "migration.ts"
Cohesion: 0.12
Nodes (28): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+20 more)

### Community 25 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.15
Nodes (14): chunkText(), deleteDocument(), deleteDocumentFor(), getDocument(), getDocumentFor(), indexDocumentChunks(), KnowledgeDocument, listDocuments() (+6 more)

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

### Community 31 - "migrate.ts"
Cohesion: 0.13
Nodes (23): ensureAppActionIndexes(), ensureInstallationIndexes(), ensureNavigationIndexes(), ensurePrivateAppIndexes(), ensureAutomationIndexes(), ensureRunIndexes(), backfillSourceFingerprints(), ensureSourceCheckpointIndexes() (+15 more)

### Community 32 - "sectors.ts"
Cohesion: 0.09
Nodes (30): mongoClient, AgentDoc, suggestedEntryPolicy(), assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent() (+22 more)

### Community 33 - "runRepository.ts"
Cohesion: 0.10
Nodes (25): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+17 more)

### Community 36 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 37 - "official/index.ts"
Cohesion: 0.10
Nodes (14): manifest, adapters, manifest, MODULES, OFFICIAL_ADAPTERS, OFFICIAL_APPS, OfficialAppsError, OfficialModule (+6 more)

### Community 38 - "tools.ts"
Cohesion: 0.10
Nodes (20): clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS, TOOL_DEFAULTS (+12 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.12
Nodes (20): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, executionAnalytics(), executionBreakdown(), ExecutionEnvironment (+12 more)

### Community 41 - "automations/repository.ts"
Cohesion: 0.13
Nodes (13): automations, findAutomation(), findByWebhookKey(), listActiveAutomations(), listActivePublished(), ListAutomationsQuery, versions, AutomationVersion (+5 more)

### Community 42 - "start"
Cohesion: 0.22
Nodes (9): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), ensureExecutionIndexes(), start(), backfillKnowledgeOwners(), ensureKnowledgeIndexes(), ensureVectorIndex() (+1 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "validate.ts"
Cohesion: 0.17
Nodes (20): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), isConditionOperator(), StepCondition (+12 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "connections/service.ts"
Cohesion: 0.08
Nodes (25): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), connections, deliveries, listDeliveries(), sentDeliveriesByAgent() (+17 more)

### Community 47 - "googleCalendar.ts"
Cohesion: 0.13
Nodes (21): adapters, manifest, buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), googleConfigured() (+13 more)

### Community 48 - "Agent"
Cohesion: 0.25
Nodes (8): Agent, CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows(), FloorCommunicationConfig

### Community 49 - "delegation.test.mjs"
Cohesion: 0.22
Nodes (4): B, BUILDING, FLOOR_A, FLOOR_B

### Community 50 - "runnerTimeout.test.mjs"
Cohesion: 0.25
Nodes (3): AGENT_ID, baseDeps(), runnerFor()

### Community 51 - "runtimeHardening.test.mjs"
Cohesion: 0.28
Nodes (6): AGENT_ID, delegateTo(), dispatch(), FLOOR, SECTOR_ID, targetAgent()

### Community 52 - "schedulerPublish.integration.test.mjs"
Cohesion: 0.39
Nodes (6): automations(), definition(), editDraft(), seedPublished(), step(), versions()

### Community 53 - "agentEvents.ts"
Cohesion: 0.18
Nodes (12): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), recordAgentEvent() (+4 more)

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

### Community 59 - "AppDefinition"
Cohesion: 0.53
Nodes (5): native(), num(), schema(), str(), AppDefinition

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 76 - "floors.ts"
Cohesion: 0.12
Nodes (32): agentStatesForFloor(), buildingOverview(), floorMetrics, Building, BuildingLanguage, BuildingPatch, buildings, DEFAULT_TIMEZONE (+24 more)

### Community 77 - "delegationWiring.ts"
Cohesion: 0.12
Nodes (24): agentCanDelegate(), capabilityMissingTool(), col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus, ensureDelegationIndexes() (+16 more)

### Community 78 - "automations/types.ts"
Cohesion: 0.12
Nodes (21): CreateAutomationInput, UpdateDraftPatch, AI_STEP_TYPES, Automation, AutomationDefinition, AutomationInput, AutomationLimits, DEFAULT_LIMITS (+13 more)

### Community 84 - "privateApps.ts"
Cohesion: 0.20
Nodes (16): describeManifestIssues(), exportableManifest(), archivePrivateApp(), createPrivateApp(), deletePrivateApp(), exportPrivateApp(), getPrivateApp(), listAppsForOwner() (+8 more)

### Community 85 - "ExecutionMode"
Cohesion: 0.53
Nodes (6): EventTriggerSpec, AppActionPlan, MemoryPlan, RoutineSpec, ExecutionMode, OutputFormat

### Community 96 - "db.ts"
Cohesion: 0.19
Nodes (15): backfillManagedChannelInstallations(), channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels() (+7 more)

### Community 97 - "installations.ts"
Cohesion: 0.09
Nodes (33): createInstallation(), CreateInstallationInput, deleteInstallation(), getInstallation(), installationPublic(), installations, listInstallations(), markInstallationTested() (+25 more)

### Community 98 - "sectorExecutions.ts"
Cohesion: 0.09
Nodes (31): serializeSector(), PERIODS, sectorExecutionRouter, accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision (+23 more)

### Community 99 - "toolExecution.ts"
Cohesion: 0.21
Nodes (11): ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets(), ToolExecutionResult (+3 more)

### Community 100 - "records.ts"
Cohesion: 0.08
Nodes (48): readPath(), assertAgentMayWrite(), floors, MemoryAccessError, ResolvedScope, resolveTarget(), scopesForAgent(), scopesForOwner() (+40 more)

### Community 101 - "runService.ts"
Cohesion: 0.16
Nodes (19): createLiveTracker(), findVersion(), insertRunIdempotent(), createRun(), CreateRunInput, advanceFrom(), catchUp(), nextFireAt() (+11 more)

### Community 103 - "eventTrigger.ts"
Cohesion: 0.21
Nodes (27): buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), readEventTriggerConfig(), updateEventTrigger() (+19 more)

### Community 104 - "builtinTools.ts"
Cohesion: 0.16
Nodes (20): resolveHttpTool(), resolveAppGrantTools(), APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField (+12 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): TokenUsage, dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "runProcessor.ts"
Cohesion: 0.11
Nodes (32): agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact(), insertStepRun(), updateRun() (+24 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.24
Nodes (9): AGENT, agentDoc(), base, call, ctx, FLOOR, read(), states() (+1 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "AgentExecutionRequest"
Cohesion: 0.67
Nodes (4): AgentExecutionRequest, AgentExecutionResult, RoutineExecutionDeps, DelegationDeps

### Community 112 - "sectorExecutions.integration.test.mjs"
Cohesion: 0.22
Nodes (4): A1, A2, FLOOR, SECTOR

### Community 113 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 114 - "agentBubbleSources.test.mjs"
Cohesion: 0.29
Nodes (5): code, DORMANT, files, stripComments(), WITH_SOURCE

### Community 116 - "agentRuntime.ts"
Cohesion: 0.13
Nodes (24): enforceOutputContract(), AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+16 more)

### Community 117 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 118 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 119 - "appGrantRoutes.ts"
Cohesion: 0.27
Nodes (5): ValidationError, auditEntity(), fail(), notFound(), oid()

### Community 120 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

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
Cohesion: 0.15
Nodes (18): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+10 more)

### Community 131 - "sourceCheckpoint.integration.test.mjs"
Cohesion: 0.25
Nodes (5): agora, AUTOMACAO, FONTE, OUTRA_FONTE, QUANDO

### Community 134 - "providerPayload.test.mjs"
Cohesion: 0.18
Nodes (8): AnthropicFalso, enviado, lenta(), medirAnthropic(), OpenAIFalso, pedindoDuas(), respostaAnthropic, respostaOpenAI

### Community 139 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 140 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), generateAgentReply(), reply(), ChatTurn, RouterOption, SectorPlan, StageTransitionOption

### Community 141 - "agentTools.ts"
Cohesion: 0.16
Nodes (19): legacyToolToExecutable(), MAX_TOOL_ITERATIONS, ResolvedTool, runResolvedTool(), ToolCallRecord, toolInputSchema(), checkStageOutput(), checkJsonText() (+11 more)

### Community 143 - "memoryStore.integration.test.mjs"
Cohesion: 0.22
Nodes (7): AGENTE, ANDAR, CHAVE_AGENTE, CHAVE_SETOR, noAgente, noSetor, SETOR

### Community 149 - "claude.ts"
Cohesion: 0.10
Nodes (39): anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractStructuredOutput(), FALLBACK_MODELS, generateAgentReply(), planSectorResponse() (+31 more)

### Community 150 - "seedRestaurantDemo.ts"
Cohesion: 0.21
Nodes (14): createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main() (+6 more)

### Community 160 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 161 - "config.ts"
Cohesion: 0.24
Nodes (9): auth, clientUrl, config, isProduction, originList(), port, stripTrailingSlash(), urlVar() (+1 more)

### Community 162 - "timeoutCancellation.test.mjs"
Cohesion: 0.40
Nodes (4): AnthropicFalso, comportamento, contadora(), espera()

## Knowledge Gaps
- **578 isolated node(s):** `AgentRunErrorKind`, `ReplyFn`, `DEFAULT_DELEGATION_TOKEN_BUDGET`, `DelegationBudget`, `DelegationDenyCode` (+573 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`?**
  _High betweenness centrality (0.152) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `runProcessor.ts` to `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.152) - this node is a cross-community bridge._
- **Why does `db` connect `db.ts` to `floorWork.ts`, `knowledge.ts`, `executionCenter.ts`, `src/index.ts`, `audit.ts`, `agents.ts`, `grants.ts`, `respondWithAgentIfLinked`, `agentLiveState.ts`, `seedRestaurantDemo.ts`, `migration.ts`, `widgets.ts`, `migrate.ts`, `sectors.ts`, `config.ts`, `runRepository.ts`, `conversationTurns.ts`, `tools.ts`, `executionRoots.ts`, `automations/repository.ts`, `connections/service.ts`, `googleCalendar.ts`, `agentEvents.ts`, `floors.ts`, `delegationWiring.ts`, `privateApps.ts`, `installations.ts`, `sectorExecutions.ts`, `records.ts`, `runService.ts`, `tokenUsage.ts`, `runProcessor.ts`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AgentRunErrorKind`, `ReplyFn`, `DEFAULT_DELEGATION_TOKEN_BUDGET` to the rest of the system?**
  _578 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floorWork.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1341991341991342 - nodes in this community are weakly interconnected._
- **Should `runConfig.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10098522167487685 - nodes in this community are weakly interconnected._