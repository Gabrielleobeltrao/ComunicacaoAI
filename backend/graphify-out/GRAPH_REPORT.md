# Graph Report - backend  (2026-08-15)

## Corpus Check
- 158 files · ~156,344 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1568 nodes · 3497 edges · 107 communities (96 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9a4d876b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runProcessor.ts
- floors.ts
- openai.ts
- seedRestaurantDemo.ts
- knowledge.ts
- executionCenter.ts
- index.ts
- audit.ts
- agents.ts
- googleCalendar.ts
- agentReadiness.ts
- respondWithAgentIfLinked
- runner.ts
- apps/types.ts
- delegation.ts
- mongoServer.mjs
- agentRoutineRoutes.ts
- whatsapp.ts
- tools.ts
- routineExecution.ts
- automations/repository.ts
- automations/service.ts
- dependencies
- agentMetrics.ts
- delegationWiring.ts
- llm.ts
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- resolveSectorTurn
- sectors.ts
- tokenUsage.ts
- runRepository.ts
- agentEvents.ts
- migration.ts
- validate.ts
- toolExecution.ts
- eventTrigger.integration.test.mjs
- conversationTurns.ts
- connections/service.ts
- installations.ts
- scripts
- automations/types.ts
- package.json
- webhookTriggers.ts
- agentRuntime.ts
- userSettings.ts
- delegation.test.mjs
- runnerTimeout.test.mjs
- runtimeHardening.test.mjs
- schedulerPublish.integration.test.mjs
- connections/repository.ts
- agentHistory.integration.test.mjs
- auditRouteMap.test.mjs
- routineDelivery.integration.test.mjs
- deployment.test.mjs
- builtinTools.ts
- connections/types.ts
- collaboration.test.mjs
- agentTools.ts
- config.test.mjs
- groundingContract.test.mjs
- jsonSchema.test.mjs
- outputContract.test.mjs
- readiness.test.mjs
- automations.test.mjs
- dotenv
- express
- socket.io
- db.ts
- routine.test.mjs
- seedGuard.test.mjs
- grants.ts
- delegationLog.ts
- appManifest.test.mjs
- registry.ts
- appRoutes.integration.test.mjs
- appGrantRoutes.ts
- googleTools.ts
- safeHttp.ts
- appMigration.integration.test.mjs
- j
- GroundingRequiredError

## God Nodes (most connected - your core abstractions)
1. `db` - 36 edges
2. `respondWithAgentIfLinked()` - 33 edges
3. `getAgentById()` - 25 edges
4. `encrypt()` - 25 edges
5. `buildDeps()` - 24 edges
6. `refreshMemoryAndIdentity()` - 23 edges
7. `productionDelegationDeps()` - 18 edges
8. `resolveSectorTurn()` - 17 edges
9. `decrypt()` - 17 edges
10. `startMongo()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `buildDeps()` --indirect_call--> `getAgentById()`  [INFERRED]
  src/automations/runProcessor.ts → src/agents.ts
- `resolveAgentTools()` --indirect_call--> `resolveHttpTool()`  [INFERRED]
  src/builtinTools.ts → src/agentTools.ts
- `buildDeps()` --indirect_call--> `runEventKey()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentEvents.ts
- `buildDeps()` --indirect_call--> `executeAgentTask()`  [INFERRED]
  src/automations/runProcessor.ts → src/agentRuntime.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (107 total, 11 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.22
Nodes (16): finalizeAgentEvent(), finalizeAgentEventSafe(), buildDeps(), processRun(), findRunUnscoped(), insertArtifact(), insertStepRun(), updateRun() (+8 more)

### Community 1 - "floors.ts"
Cohesion: 0.08
Nodes (44): ensureAppActionIndexes(), ensureInstallationIndexes(), agentStatesForFloor(), buildingOverview(), floorMetrics, ensureAutomationIndexes(), ensureRunIndexes(), Building (+36 more)

### Community 2 - "openai.ts"
Cohesion: 0.07
Nodes (69): MAX_TOOL_ITERATIONS, ToolCallRecord, anthropicUsage(), AUXILIARY_MODEL, buildClient(), checkGuardrail(), extractIdentity(), extractStructuredOutput() (+61 more)

### Community 3 - "seedRestaurantDemo.ts"
Cohesion: 0.19
Nodes (16): createAgent(), createDocument(), createDocumentFor(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan (+8 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.08
Nodes (38): chunks, chunkText(), combineKnowledgeHits(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent(), deleteAllForSector(), deleteDocument() (+30 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.08
Nodes (47): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+39 more)

### Community 6 - "index.ts"
Cohesion: 0.05
Nodes (30): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), app, AVATAR_MIME_TYPES (+22 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (36): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+28 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (43): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentTool, AgentToolHeader, AgentToolParam (+35 more)

### Community 9 - "googleCalendar.ts"
Cohesion: 0.09
Nodes (27): clientUrl, config, FeatureFlags, flags, isProduction, originList(), port, stripTrailingSlash() (+19 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.08
Nodes (34): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+26 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.10
Nodes (34): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+26 more)

### Community 12 - "runner.ts"
Cohesion: 0.12
Nodes (26): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+18 more)

### Community 13 - "apps/types.ts"
Cohesion: 0.11
Nodes (24): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+16 more)

### Community 14 - "delegation.ts"
Cohesion: 0.13
Nodes (24): presetSpec(), suggestPresetForCapability(), asOutputFormat(), buildCapabilityMissing(), CapabilityMissing, checkStageOutput(), childContext(), DEFAULT_DELEGATION_TOKEN_BUDGET (+16 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.09
Nodes (10): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), automations() (+2 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.20
Nodes (19): EventTriggerError, EventTriggerSpec, buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations(), listRoutines(), RoutineError (+11 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.14
Nodes (18): ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter(), InboundMediaRef, InboundMessage (+10 more)

### Community 18 - "tools.ts"
Cohesion: 0.09
Nodes (21): clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize(), TOOL_AUTH_KINDS, TOOL_LIMITS (+13 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.16
Nodes (13): AgentEventStatus, RecordAgentEventInput, executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineRunContext, RoutineStepCall (+5 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, signBody() (+4 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.15
Nodes (29): getAgentById(), buildEventTriggerDefinition(), createEventTrigger(), getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), updateRoutine() (+21 more)

### Community 22 - "dependencies"
Cohesion: 0.11
Nodes (19): @anthropic-ai/sdk, better-auth, cors, cron-parser, multer, nodemailer, openai, dependencies (+11 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.16
Nodes (16): AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel(), kpiShortLabel() (+8 more)

### Community 24 - "delegationWiring.ts"
Cohesion: 0.36
Nodes (9): resolveAgentTools(), agentCanDelegate(), buildDelegationTools(), capabilityMissingTool(), DelegationContext, finishDelegation(), startDelegation(), productionDelegationDeps() (+1 more)

### Community 25 - "llm.ts"
Cohesion: 0.19
Nodes (17): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, auxiliaryModel(), checkGuardrail(), extractIdentity(), extractStructuredOutput(), generateAgentReply(), listModelsForProvider() (+9 more)

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
Nodes (31): ensureActivationMode(), addMessage(), addOwnerReply(), AgentCardStats, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel() (+23 more)

### Community 31 - "resolveSectorTurn"
Cohesion: 0.11
Nodes (19): setActiveAgentId(), auxModelFor(), buildStageTransitionOptions(), getWidgetConfigAgent(), inboundMediaToText(), memberRoutingLine(), resolveOwnedSectorId(), resolveSectorTurn() (+11 more)

### Community 32 - "sectors.ts"
Cohesion: 0.11
Nodes (23): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, deleteSector(), enforceSingleMembership() (+15 more)

### Community 33 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

### Community 34 - "runRepository.ts"
Cohesion: 0.05
Nodes (51): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+43 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.22
Nodes (9): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentExecutionEvent, events, recordAgentEvent(), recordAgentEventSafe(), runEventKey() (+1 more)

### Community 36 - "migration.ts"
Cohesion: 0.15
Nodes (20): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureGoogleInstallation(), ensureGoogleInstallations() (+12 more)

### Community 37 - "validate.ts"
Cohesion: 0.24
Nodes (11): AutomationValidationError, canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord(), validateDefinition() (+3 more)

### Community 38 - "toolExecution.ts"
Cohesion: 0.22
Nodes (11): decrypt(), getKey(), executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl(), redactSecrets() (+3 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 41 - "connections/service.ts"
Cohesion: 0.21
Nodes (11): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, getConnection(), isNonEmpty(), normalizeName(), patchConnection(), PROVIDERS (+3 more)

### Community 42 - "installations.ts"
Cohesion: 0.16
Nodes (18): createInstallation(), CreateInstallationInput, decryptInstallationConfig(), deleteInstallation(), installations, listInstallations(), markInstallationTested(), normalizeConfig() (+10 more)

### Community 43 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, dev:api, dev:worker, seed:demo, start, start:api (+2 more)

### Community 44 - "automations/types.ts"
Cohesion: 0.10
Nodes (21): insertRunIdempotent(), createRun(), CreateRunInput, AutomationRun, SafeRunError, CreateAutomationInput, UpdateDraftPatch, AutomationDefinition (+13 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "webhookTriggers.ts"
Cohesion: 0.46
Nodes (7): Automation, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent(), liveWebhookCountFor(), PublishedAutomation

### Community 47 - "agentRuntime.ts"
Cohesion: 0.15
Nodes (20): AgentExecutionRequest, AgentExecutionResult, AgentOutputFormat, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective() (+12 more)

### Community 48 - "userSettings.ts"
Cohesion: 0.22
Nodes (8): clearProviderApiKey(), FIELD_BY_PROVIDER, getMonthlyTokenCap(), getProviderKeyStatus(), setMonthlyTokenCap(), setProviderApiKey(), settings, UserSettings

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

### Community 53 - "connections/repository.ts"
Cohesion: 0.17
Nodes (6): connections, deliveries, listDeliveries(), sentDeliveriesByAgent(), updateDelivery(), Delivery

### Community 54 - "agentHistory.integration.test.mjs"
Cohesion: 0.25
Nodes (4): AGENT, FLOOR, OTHER_AGENT, ROUTINE

### Community 55 - "auditRouteMap.test.mjs"
Cohesion: 0.29
Nodes (5): ACTIONS, declaredRoutes(), readSource(), ROUTER_PREFIX, SOURCE_DIR

### Community 56 - "routineDelivery.integration.test.mjs"
Cohesion: 0.25
Nodes (4): AGENT, BUILDING, CONNECTION, FLOOR

### Community 57 - "deployment.test.mjs"
Cohesion: 0.29
Nodes (4): compose, coolify, envExample, pkg

### Community 58 - "builtinTools.ts"
Cohesion: 0.20
Nodes (15): APP_GUIDES, BUILTIN_APPS, BuiltinApp, BuiltinAppGuide, builtinAppsCatalog(), BuiltinConfigField, hubspotTools(), mercadoPagoTools() (+7 more)

### Community 59 - "connections/types.ts"
Cohesion: 0.27
Nodes (8): chunkTelegram(), FetchImpl, MailTransport, sendTelegram(), ConnectionStatus, DeliveryStatus, EmailConfig, TelegramConfig

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "agentTools.ts"
Cohesion: 0.21
Nodes (15): legacyToolToExecutable(), resolveHttpTool(), runResolvedTool(), toolInputSchema(), describeErrors(), join(), matchesType(), Schema (+7 more)

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 78 - "db.ts"
Cohesion: 0.33
Nodes (5): auth, db, mongoClient, AgentDoc, Sector

### Community 84 - "grants.ts"
Cohesion: 0.22
Nodes (15): missingCapability(), AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate(), isVersionCompatible() (+7 more)

### Community 85 - "delegationLog.ts"
Cohesion: 0.22
Nodes (8): col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus, ensureDelegationIndexes(), listDelegationsForAgent(), succeededDelegationsByCaller()

### Community 97 - "registry.ts"
Cohesion: 0.10
Nodes (15): installationPublic(), appCatalogPublic(), email, google, hubspot, LEGACY_APP_KEYS, mercadopago, nuvemshop (+7 more)

### Community 99 - "appGrantRoutes.ts"
Cohesion: 0.21
Nodes (10): getInstallation(), ValidationError, requireAgent(), appGrantRouter, validateGrant(), connectionRouter, parseFilters(), fail() (+2 more)

### Community 100 - "googleTools.ts"
Cohesion: 0.52
Nodes (5): getGoogleAccessToken(), googleCalendarTools(), googleFetch(), googleSheetsTools(), objectSchema()

### Community 101 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 102 - "appMigration.integration.test.mjs"
Cohesion: 0.38
Nodes (3): agents(), insertAgent(), readAgent()

### Community 105 - "j"
Cohesion: 0.47
Nodes (6): agentCard(), checkDelegation(), getCapabilities(), j(), listAvailable(), policyAllows()

## Knowledge Gaps
- **376 isolated node(s):** `AppMigrationReport`, `installations`, `agents`, `integrations`, `RETENTION_NOTE` (+371 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `runProcessor.ts` to `tokenUsage.ts`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `runProcessor.ts` to `hardening.integration.test.mjs`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `db` connect `db.ts` to `floors.ts`, `seedRestaurantDemo.ts`, `knowledge.ts`, `executionCenter.ts`, `index.ts`, `audit.ts`, `agents.ts`, `googleCalendar.ts`, `respondWithAgentIfLinked`, `tools.ts`, `automations/repository.ts`, `widgets.ts`, `resolveSectorTurn`, `sectors.ts`, `tokenUsage.ts`, `runRepository.ts`, `agentEvents.ts`, `migration.ts`, `conversationTurns.ts`, `installations.ts`, `userSettings.ts`, `connections/repository.ts`, `grants.ts`, `delegationLog.ts`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AppMigrationReport`, `installations`, `agents` to the rest of the system?**
  _376 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07857142857142857 - nodes in this community are weakly interconnected._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0700152207001522 - nodes in this community are weakly interconnected._