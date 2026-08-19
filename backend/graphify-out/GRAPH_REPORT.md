# Graph Report - backend  (2026-08-19)

## Corpus Check
- 300 files · ~327,272 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2648 nodes · 6131 edges · 183 communities (162 shown, 21 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6a07a9fc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- llm.ts
- floors.ts
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
- runRoutes.ts
- sectorExecutions.ts
- claude.ts
- sourceMonitoring.test.mjs
- connections/service.ts
- floorCommunication.ts
- llmFake.ts
- tools.ts
- eventTrigger.integration.test.mjs
- executionRoots.ts
- agentTools.ts
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
- sectorAccess.ts
- delegationWiring.ts
- automations/repository.ts
- routine.test.mjs
- seedGuard.test.mjs
- sectorPlanner.ts
- seedRestaurantDemo.ts
- channelApps.ts
- widgets.ts
- agentRoutineRoutes.ts
- scheduler.ts
- entrypointParity.test.mjs
- automations/service.ts
- agentDefinition.ts
- installations.ts
- sourceChange.ts
- tokenUsage.ts
- run-tests.mjs
- floorWork.ts
- agentLiveState.integration.test.mjs
- executionRoots.integration.test.mjs
- sourceStaleRun.integration.test.mjs
- sectorMembership.ts
- sectorExecutions.integration.test.mjs
- interactiveRoutes.integration.test.mjs
- agentBubbleSources.test.mjs
- appManifest.test.mjs
- sectors.ts
- interactiveRun.test.mjs
- appMigration.integration.test.mjs
- eventTrigger.ts
- clarify.ts
- autoModel.ts
- collaborationGate.test.mjs
- floorWork.integration.test.mjs
- gateWiring.integration.test.mjs
- sectorTeam.integration.test.mjs
- channelApps.integration.test.mjs
- channelOverview.integration.test.mjs
- llmFakeGate.test.mjs
- runRepository.ts
- logHygiene.test.mjs
- sourceCheckpoint.integration.test.mjs
- cron-parser
- scopeCache.ts
- sourceTool.integration.test.mjs
- timeoutCancellation.test.mjs
- openai.ts
- conversationTurns.ts
- lexicalRetrieval.ts
- agentDefinition.test.mjs
- candleAnalyzer.test.mjs
- executionTrace.ts
- db.ts
- appRoutes.integration.test.mjs
- offices.ts
- agentEvents.ts
- auditMiddleware.ts
- modelDefaults.ts
- apps/types.ts
- toolsSecurity.test.mjs
- webContent.ts
- sectorPlanner.test.mjs
- scopeGate.test.mjs
- encrypt
- sectorAccess.integration.test.mjs
- hardening.integration.test.mjs
- runService.ts
- googleTools.ts
- executionRoutes.ts
- RunStatus
- playgroundSession.ts
- safeHttp.ts
- builtinTools.ts
- sources.ts
- webSourcePolicy.test.mjs
- webKnowledge.integration.test.mjs
- webDiscovery.ts
- config.ts
- sectorBriefing.ts
- webhookRoutes.ts
- getSectorById
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
10. `ResolvedTool` - 24 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `ensureAgentWebKnowledgeFresh()` --indirect_call--> `site()`  [INFERRED]
  src/webKnowledge.ts → test/sourceTool.integration.test.mjs
- `selectVisualStates()` --indirect_call--> `row()`  [INFERRED]
  src/agentLiveState.ts → test/agentLiveState.test.mjs
- `buildDeps()` --indirect_call--> `runEventKey()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `finalizeAgentEvent()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/llmFake.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (183 total, 21 thin omitted)

### Community 0 - "llm.ts"
Cohesion: 0.16
Nodes (20): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, askAux(), auxiliaryModel(), checkGuardrail(), defaultModel(), extractIdentity(), extractStructuredOutput() (+12 more)

### Community 1 - "floors.ts"
Cohesion: 0.10
Nodes (30): legacyWorkingMap(), liveStatesEtag(), agentStatesForFloor(), buildingOverview(), floorMetrics, BuildingLanguage, BuildingPatch, buildings (+22 more)

### Community 2 - "sourceCheckpoint.ts"
Cohesion: 0.15
Nodes (16): sourceSettingsOf(), LivePassage, livePassagesFor(), liveStepIdFor(), STEP(), acquireSourceLease(), advanceCheckpoint(), beginCheck() (+8 more)

### Community 3 - "agentRuntime.ts"
Cohesion: 0.12
Nodes (26): enforceOutputContract(), AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson(), executeAgentTask() (+18 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.07
Nodes (31): chunks, combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), DocumentPage, DocumentQuery (+23 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.12
Nodes (32): clarificationsSince(), tokensByModelSince(), ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, automationFilter() (+24 more)

### Community 6 - "src/index.ts"
Cohesion: 0.04
Nodes (38): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), clarificationGuidance(), CLARIFY_LIMIT (+30 more)

### Community 7 - "audit.ts"
Cohesion: 0.12
Nodes (19): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditActorType, AuditEvent, AuditEventPublic, AuditFilters, AuditResult (+11 more)

### Community 8 - "agents.ts"
Cohesion: 0.04
Nodes (51): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentSourceSettings, AgentTool, AgentToolHeader (+43 more)

### Community 9 - "grants.ts"
Cohesion: 0.15
Nodes (23): missingCapability(), AppStepContext, AppStepError, executeAppStep(), resolveArgs(), AppActionEvent, appActionEvents, buildAction() (+15 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.09
Nodes (33): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, presetFillableFields(), agentReadiness(), AgentWiring, callerPolicyFromLegacy() (+25 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.08
Nodes (37): formatOptions(), resolveChoice(), semAcento(), conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc() (+29 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (19): AgentCall, delay(), DeliverCall, FetchResult, MemoryOps, runDefinition(), RunnerDeps, RunOutcome (+11 more)

### Community 13 - "agentLiveState.ts"
Cohesion: 0.09
Nodes (30): ACTIVE_TTL_MS, AGENT_BUBBLE_STATES, AgentLiveState, agentLiveStatesForFloor(), AgentLiveStatesResponse, AgentLiveVisualState, AgentSafeDetail, BLOCKED_TTL_MS (+22 more)

### Community 14 - "delegation.ts"
Cohesion: 0.09
Nodes (37): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, ClarificationRequest, agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools() (+29 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.06
Nodes (17): FLOOR, PAGE, OPCOES, AGENTE, SETOR, startMongo(), stopMongo(), A (+9 more)

### Community 16 - "automations/types.ts"
Cohesion: 0.17
Nodes (11): AI_STEP_TYPES, AutomationInput, AutomationLimits, DEFAULT_LIMITS, DeliveryTarget, EXECUTION_MODES, ManualTrigger, RetryPolicy (+3 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.12
Nodes (20): getWidgetConfigAgent(), inboundMediaToText(), ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter() (+12 more)

### Community 18 - "patterns.ts"
Cohesion: 0.09
Nodes (56): acao, adapters, candleAnalyzerTools(), comuns(), listaDeTexto(), recusa(), rodar(), AnalysisResult (+48 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.10
Nodes (31): resolveAgentRun(), RecordAgentEventInput, AgentBubbleState, catalogIndex(), instrumentTools(), LiveTracker, LiveTrackerContext, NOOP_TRACKER (+23 more)

### Community 20 - "runProcessor.ts"
Cohesion: 0.09
Nodes (32): findAutomation(), publishedSourceFingerprint(), agentIdsOf(), buildDeps(), processRun(), trackersFor(), findRunUnscoped(), insertArtifact() (+24 more)

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
Nodes (28): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureChannelInstallation(), ensureGoogleInstallation() (+20 more)

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
Cohesion: 0.15
Nodes (23): comoNumero(), comoTexto(), CONDITION_OPERATORS, ConditionOperator, describeCondition(), evaluateCondition(), StepCondition, EventTriggerSpec (+15 more)

### Community 31 - "runRoutes.ts"
Cohesion: 0.12
Nodes (16): findRun(), listArtifacts(), listRuns(), listStepRuns(), requestCancel(), runRouter, runSummary(), stepPublic() (+8 more)

### Community 32 - "sectorExecutions.ts"
Cohesion: 0.12
Nodes (22): PERIODS, sectorExecutionRouter, agentEvents, durationOf(), ExecutionEnvironment, ExecutionPeriod, executions, finishSectorExecution() (+14 more)

### Community 33 - "claude.ts"
Cohesion: 0.08
Nodes (41): anthropicUsage(), askAux(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), DEFAULT_MODEL, FALLBACK_MODELS, generateAgentReply() (+33 more)

### Community 35 - "connections/service.ts"
Cohesion: 0.16
Nodes (13): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, decryptConfig(), getConnection(), isNonEmpty(), normalizeName(), patchConnection() (+5 more)

### Community 36 - "floorCommunication.ts"
Cohesion: 0.18
Nodes (14): Building, buildings, canCommunicate(), COMMUNICATION_LABEL, communicationConfigOf(), communicationImpact, FLOOR_COMMUNICATION_MODES, FloorCommunicationMode (+6 more)

### Community 37 - "llmFake.ts"
Cohesion: 0.12
Nodes (8): AUXILIARY_MODEL, countTokens(), DEFAULT_MODEL, generateAgentReply(), reply(), RouterOption, SectorPlan, StageTransitionOption

### Community 38 - "tools.ts"
Cohesion: 0.10
Nodes (18): deleteTool(), getTool(), getToolsByIds(), listTools(), TOOL_AUTH_KINDS, TOOL_DEFAULTS, TOOL_LIMITS, TOOL_METHODS (+10 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "executionRoots.ts"
Cohesion: 0.12
Nodes (21): analyticsPeriodStart(), AnalyticsQuery, AnalyticsResult, AnalyticsScope, BreakdownRow, channelExecutionKey(), executionAnalytics(), executionBreakdown() (+13 more)

### Community 41 - "agentTools.ts"
Cohesion: 0.11
Nodes (29): legacyToolToExecutable(), MAX_TOOL_ITERATIONS, resolveHttpTool(), runResolvedTool(), toolInputSchema(), checkStageOutput(), checkJsonText(), JsonCheck (+21 more)

### Community 42 - "executionModes.integration.test.mjs"
Cohesion: 0.12
Nodes (12): acaoDeCandles, AGENT, BUILDING, CANDLES, CHAVE_AGENTE, CHAVE_ANDAR, CHAVE_OUTRO, CHAVE_SETOR (+4 more)

### Community 43 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, dev:api, dev:worker, seed:bubbles, seed:demo, start (+3 more)

### Community 44 - "validate.ts"
Cohesion: 0.27
Nodes (14): isConditionOperator(), normalizeCondition(), canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord() (+6 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "migrationFixture.integration.test.mjs"
Cohesion: 0.29
Nodes (6): AGENT, before_, FLOOR, SECTOR, WA_CHANNEL, WIDGET

### Community 47 - "webKnowledge.ts"
Cohesion: 0.08
Nodes (41): WatchedSource, looksLikeContent(), urlsFromFeed(), urlsFromListing(), urlsFromSitemap(), agents, atualizarFonte(), Descoberta (+33 more)

### Community 48 - "sectorKnowledgeRoutes.ts"
Cohesion: 0.14
Nodes (15): chunkText(), countDocumentsFromSource(), deleteDocument(), deleteDocumentFor(), getDocument(), getDocumentFor(), indexDocumentChunks(), KnowledgeDocument (+7 more)

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
Cohesion: 0.11
Nodes (31): describeManifestIssues(), exportableManifest(), FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest() (+23 more)

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

### Community 76 - "sectorAccess.ts"
Cohesion: 0.20
Nodes (15): serializeSector(), accessConfigOf(), accessImpact, checkSectorEntry(), ENTRY_POLICY_LABEL, EntryDecision, protectedAgentIds(), SECTOR_ENTRY_POLICIES (+7 more)

### Community 77 - "delegationWiring.ts"
Cohesion: 0.14
Nodes (20): resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), DelegationContext, TEAM_TOOL_NAMES, col, DelegationFinish, DelegationRecord (+12 more)

### Community 78 - "automations/repository.ts"
Cohesion: 0.20
Nodes (6): automations, listActiveAutomations(), listActivePublished(), ListAutomationsQuery, versions, AutomationVersion

### Community 84 - "sectorPlanner.ts"
Cohesion: 0.11
Nodes (37): executeSectorTeam(), runWithRetry(), stageInstruction(), normalize(), assembleWithoutModel(), buildSynthesisContext(), dedupeAgainst(), describeMember() (+29 more)

### Community 85 - "seedRestaurantDemo.ts"
Cohesion: 0.20
Nodes (15): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+7 more)

### Community 96 - "channelApps.ts"
Cohesion: 0.22
Nodes (13): channels, ChannelSyncReport, hasValidChannel(), installations, isManagedChannelApp(), isValidChannel(), listValidChannels(), syncManagedChannelInstallations() (+5 more)

### Community 97 - "widgets.ts"
Cohesion: 0.07
Nodes (31): addMessage(), addOwnerReply(), AgentCardStats, ConversationFilters, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 98 - "agentRoutineRoutes.ts"
Cohesion: 0.13
Nodes (27): getAgentById(), webhookEndpoint(), listAgentAutomations(), listRoutines(), readSourceFromDefinition(), RoutineSource, STEP_SOURCE, cronToRecurrence() (+19 more)

### Community 99 - "scheduler.ts"
Cohesion: 0.25
Nodes (12): findVersion(), advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, planSchedules() (+4 more)

### Community 100 - "entrypointParity.test.mjs"
Cohesion: 0.29
Nodes (3): AGENTE, AnthropicFalso, enviado

### Community 101 - "automations/service.ts"
Cohesion: 0.13
Nodes (30): ensureActivationMode(), assertOwnedAgentRefs(), assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), CreateAutomationInput, defaultDefinition() (+22 more)

### Community 102 - "agentDefinition.ts"
Cohesion: 0.10
Nodes (27): AgentDefinition, composeAgentPrompt(), definitionOf(), OutputCheck, outputDirective(), resolveCache(), ResolvedAgentRun, ResolveRunOptions (+19 more)

### Community 103 - "installations.ts"
Cohesion: 0.08
Nodes (38): createInstallation(), CreateInstallationInput, decryptInstallationConfig(), deleteInstallation(), getInstallation(), installationPublic(), installations, listInstallations() (+30 more)

### Community 104 - "sourceChange.ts"
Cohesion: 0.16
Nodes (24): executeStep(), strip(), templateVars(), chaveDoItem(), contentHashOf(), detectHttpChange(), detectRssChange(), HttpChange (+16 more)

### Community 105 - "tokenUsage.ts"
Cohesion: 0.17
Nodes (18): TokenUsage, attemptChargeKey(), dayKey(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage() (+10 more)

### Community 106 - "run-tests.mjs"
Cohesion: 0.22
Nodes (7): arquivos, comBanco, dirTestes, LIMITE_MONGO, raiz, semBanco, usaMongo()

### Community 107 - "floorWork.ts"
Cohesion: 0.18
Nodes (15): Agent, checkCollaboration(), CollaborationDecision, CollaborationDenyCode, discoverable(), GateContext, GateTarget, policyAllows() (+7 more)

### Community 108 - "agentLiveState.integration.test.mjs"
Cohesion: 0.16
Nodes (12): AGENT, agentDoc(), ALVO, alvoDoc(), base, call, ctx, depsDelegacao() (+4 more)

### Community 109 - "executionRoots.integration.test.mjs"
Cohesion: 0.20
Nodes (5): A1, A2, A3, FLOOR_A, FLOOR_B

### Community 110 - "sourceStaleRun.integration.test.mjs"
Cohesion: 0.25
Nodes (5): AGENT, BUILDING, conferirDescartada(), FLOOR, lerRun()

### Community 111 - "sectorMembership.ts"
Cohesion: 0.24
Nodes (9): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, MAX_SECTOR_MEMBERS, SectorMember (+1 more)

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

### Community 119 - "eventTrigger.ts"
Cohesion: 0.18
Nodes (32): buildEventTriggerDefinition(), createEventTrigger(), describeEventTriggerFlow(), EventTriggerError, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), readEventTriggerConfig() (+24 more)

### Community 120 - "clarify.ts"
Cohesion: 0.38
Nodes (6): clarificationFrom(), CLARIFY_TOOL_NAME, clarifyTool(), countClarifications(), j(), clarifyBudgetSpent()

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

### Community 129 - "runRepository.ts"
Cohesion: 0.11
Nodes (27): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+19 more)

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

### Community 137 - "openai.ts"
Cohesion: 0.13
Nodes (27): extractIdentity(), extractStructuredOutput(), listAvailableModels(), updateStructuredMemory(), cache, cacheKey(), getCachedModels(), ModelOption (+19 more)

### Community 139 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 140 - "lexicalRetrieval.ts"
Cohesion: 0.18
Nodes (16): searchKnowledgeLexicallyForOwners(), ABREV_EN, ABREV_PT, escapeRegex(), expandirData(), extractTerms(), extractWindow(), LexicalTerm (+8 more)

### Community 146 - "executionTrace.ts"
Cohesion: 0.15
Nodes (12): ExecutionTraceEvent, onTraceEvent(), preview(), readTrace(), sanitize(), Sink, traceEvent(), TraceEventType (+4 more)

### Community 147 - "db.ts"
Cohesion: 0.17
Nodes (10): auth, db, mongoClient, AgentDoc, aggregateSectorDecisions(), listSectorDecisionsForConversation(), SectorDecision, SectorDecisionAggregate (+2 more)

### Community 149 - "offices.ts"
Cohesion: 0.33
Nodes (4): createOffice(), ensureDefaultOffice(), Office, offices

### Community 150 - "agentEvents.ts"
Cohesion: 0.18
Nodes (12): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), ModelUsageRow (+4 more)

### Community 151 - "auditMiddleware.ts"
Cohesion: 0.17
Nodes (16): AuditAction, AuditEntityType, recordAudit(), safeMetadata(), entityLabelWithOwner(), MAX_LABEL_CHARS, normalizeLabel(), resolveEntityLabels() (+8 more)

### Community 152 - "modelDefaults.ts"
Cohesion: 0.29
Nodes (5): ANTHROPIC_AUX_MODEL, ANTHROPIC_DEFAULT_MODEL, auxModelOf(), OPENAI_AUX_MODEL, OPENAI_DEFAULT_MODEL

### Community 153 - "apps/types.ts"
Cohesion: 0.06
Nodes (38): manifest, adapters, manifest, MODULES, OFFICIAL_ADAPTERS, OfficialAppsError, OfficialModule, adapters (+30 more)

### Community 156 - "webContent.ts"
Cohesion: 0.32
Nodes (11): canonicalFromHtml(), canonicalizeUrl(), domainOf(), extractPageMeta(), extractReadableText(), iso(), metaContent(), pageFacts() (+3 more)

### Community 157 - "sectorPlanner.test.mjs"
Cohesion: 0.33
Nodes (4): COZINHA, EQUIPE, FINANCEIRO, JURIDICO

### Community 159 - "encrypt"
Cohesion: 0.17
Nodes (14): decrypt(), encrypt(), getKey(), clamp(), createTool(), normalize(), updateTool(), clearProviderApiKey() (+6 more)

### Community 160 - "sectorAccess.integration.test.mjs"
Cohesion: 0.29
Nodes (3): COORD, OUTSIDER, STAGE_AGENT

### Community 162 - "runService.ts"
Cohesion: 0.27
Nodes (10): createLiveTracker(), insertRunIdempotent(), createRun(), CreateRunInput, Artifact, AutomationRun, SafeRunError, StepRun (+2 more)

### Community 163 - "googleTools.ts"
Cohesion: 0.33
Nodes (7): adapters, manifest, getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 164 - "executionRoutes.ts"
Cohesion: 0.18
Nodes (8): EXECUTION_TABS, ExecutionFilters, ExecutionTab, RunTimelineFilters, AnalyticsPeriod, ANALYTICS_PERIODS, executionRouter, parseFilters()

### Community 165 - "RunStatus"
Cohesion: 0.22
Nodes (10): AutomationDoc, RunDoc, RunItem, RunStats, RunTimelineItem, ScheduledItem, TriggerItem, RunStatus (+2 more)

### Community 166 - "playgroundSession.ts"
Cohesion: 0.25
Nodes (8): guardarTurnoDeTeste(), appendPlaygroundTurns(), clearPlaygroundTurns(), cortar(), loadPlaygroundTurns(), PlaygroundSession, PlaygroundTurn, sessions

### Community 167 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 168 - "builtinTools.ts"
Cohesion: 0.17
Nodes (16): adapters, manifest, APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField (+8 more)

### Community 169 - "sources.ts"
Cohesion: 0.57
Nodes (7): clean(), decodeEntities(), parseRssItems(), pick(), pickLink(), stripCdata(), stripTags()

### Community 171 - "webKnowledge.integration.test.mjs"
Cohesion: 0.24
Nodes (10): agenteComSite(), artigosNoFeed, comFeed(), criarAgente(), depsDoRuntime(), pedidos, rodar(), setorDeUm() (+2 more)

### Community 172 - "webDiscovery.ts"
Cohesion: 0.38
Nodes (5): feedFromHtml(), DiscoveryPlan, DiscoveryProbe, ehFeed(), planDiscovery()

### Community 174 - "config.ts"
Cohesion: 0.32
Nodes (7): clientUrl, isProduction, originList(), port, stripTrailingSlash(), urlVar(), validateConfig()

### Community 175 - "sectorBriefing.ts"
Cohesion: 0.53
Nodes (5): BriefingMember, coordinatorBriefing(), limpar(), linhaDe(), ExecutionPlan

### Community 177 - "webhookRoutes.ts"
Cohesion: 0.43
Nodes (5): findByWebhookKey(), signBody(), verifySignature(), webhookIdempotencyKey(), webhookRouter

### Community 178 - "getSectorById"
Cohesion: 0.50
Nodes (4): resolveOwnedSectorId(), requireSector(), requireSector(), getSectorById()

## Knowledge Gaps
- **657 isolated node(s):** `name`, `version`, `type`, `main`, `dev` (+652 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ensureAgentWebKnowledgeFresh()` connect `webKnowledge.ts` to `runRepository.ts`, `agentRoutineRoutes.ts`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Why does `site()` connect `webKnowledge.ts` to `sourceTool.integration.test.mjs`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `attemptChargeKey()` connect `tokenUsage.ts` to `hardening.integration.test.mjs`, `runProcessor.ts`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `type` to the rest of the system?**
  _657 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10317460317460317 - nodes in this community are weakly interconnected._
- **Should `agentRuntime.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12315270935960591 - nodes in this community are weakly interconnected._