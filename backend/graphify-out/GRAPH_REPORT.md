# Graph Report - backend  (2026-08-15)

## Corpus Check
- 154 files · ~153,080 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1552 nodes · 3419 edges · 104 communities (94 shown, 10 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4d7d2f8b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runProcessor.ts
- floors.ts
- openai.ts
- runRepository.ts
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
- resolveSectorTurn
- devDependencies
- compilerOptions
- executionCenter.integration.test.mjs
- logRoutes.integration.test.mjs
- widgets.ts
- sectorDecisions.ts
- sectors.ts
- tokenUsage.ts
- engine.ts
- agentEvents.ts
- migration.ts
- validate.ts
- toolExecution.ts
- eventTrigger.integration.test.mjs
- eventTrigger.ts
- connections/service.ts
- installations.ts
- scripts
- automations/types.ts
- package.json
- webhookTriggers.ts
- scheduler.ts
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
- toolsSecurity.test.mjs
- collaboration.test.mjs
- db.ts
- config.test.mjs
- groundingContract.test.mjs
- jsonSchema.test.mjs
- outputContract.test.mjs
- readiness.test.mjs
- automations.test.mjs
- dotenv
- express
- socket.io
- conversationTurns.ts
- routine.test.mjs
- seedGuard.test.mjs
- grants.ts
- safeError.ts
- appManifest.test.mjs
- registry.ts
- config.ts
- seedRestaurantDemo.ts
- delegationLog.ts
- safeHttp.ts
- appMigration.integration.test.mjs

## God Nodes (most connected - your core abstractions)
1. `db` - 35 edges
2. `respondWithAgentIfLinked()` - 33 edges
3. `encrypt()` - 25 edges
4. `getAgentById()` - 24 edges
5. `buildDeps()` - 24 edges
6. `refreshMemoryAndIdentity()` - 23 edges
7. `productionDelegationDeps()` - 18 edges
8. `resolveSectorTurn()` - 17 edges
9. `decrypt()` - 17 edges
10. `Agent` - 16 edges

## Surprising Connections (you probably didn't know these)
- `execDeps()` --indirect_call--> `attemptChargeKey()`  [INFERRED]
  test/hardening.integration.test.mjs → src/tokenUsage.ts
- `buildDeps()` --indirect_call--> `getAgentById()`  [INFERRED]
  src/automations/runProcessor.ts → src/agents.ts
- `resolveOwnedAgentId()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts
- `resolveSectorMembers()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts
- `resolveSectorTeamFields()` --calls--> `getAgentById()`  [EXTRACTED]
  src/index.ts → src/agents.ts

## Import Cycles
- 3-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/agentTools.ts`
- 4-file cycle: `src/agentTools.ts -> src/agents.ts -> src/llm.ts -> src/openai.ts -> src/agentTools.ts`

## Communities (104 total, 10 thin omitted)

### Community 0 - "runProcessor.ts"
Cohesion: 0.16
Nodes (19): processRun(), findRunUnscoped(), insertArtifact(), insertStepRun(), updateRun(), preview(), chunkTelegram(), FetchImpl (+11 more)

### Community 1 - "floors.ts"
Cohesion: 0.07
Nodes (46): ensureAppActionIndexes(), ensureInstallationIndexes(), agentStatesForFloor(), buildingOverview(), floorMetrics, ensureAutomationIndexes(), ensureRunIndexes(), Building (+38 more)

### Community 2 - "openai.ts"
Cohesion: 0.05
Nodes (94): AgentExecutionRequest, AgentExecutionResult, AgentRunError, AgentRunErrorKind, boundedSchema(), buildHistory(), buildTaskObjective(), checkJson() (+86 more)

### Community 3 - "runRepository.ts"
Cohesion: 0.15
Nodes (16): artifacts, findRun(), listArtifacts(), listRuns(), listStepRuns(), MAX_RUN_CLAIMS, requestCancel(), RUN_LEASE_MS (+8 more)

### Community 4 - "knowledge.ts"
Cohesion: 0.08
Nodes (39): chunks, chunkText(), combineKnowledgeHits(), createDocument(), createDocumentFor(), CreateDocumentInput, deleteAllFor(), deleteAllForAgent() (+31 more)

### Community 5 - "executionCenter.ts"
Cohesion: 0.07
Nodes (49): ACTIVE_RUN_STATUSES, agentConstraint(), agentIdsInSector(), AgentRef, agents, AutomationDoc, automationFilter(), automations (+41 more)

### Community 6 - "index.ts"
Cohesion: 0.05
Nodes (35): backfillAgentEventAttempts(), ensureAgentEventIndexes(), ensureAuditIndexes(), stopEmbeddedEngine(), ensureExecutionIndexes(), getBuiltinApp(), app, AVATAR_MIME_TYPES (+27 more)

### Community 7 - "audit.ts"
Cohesion: 0.08
Nodes (36): AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AuditAction, AuditActorType, AuditEntityType, AuditEvent, AuditEventPublic (+28 more)

### Community 8 - "agents.ts"
Cohesion: 0.05
Nodes (43): sanitizeActivationWrite(), ACTIVATION_MODES, AGENT_PRESETS, AgentModelFields, agents, AgentTool, AgentToolHeader, AgentToolParam (+35 more)

### Community 9 - "googleCalendar.ts"
Cohesion: 0.15
Nodes (19): buildGoogleAuthUrl(), connectGoogle(), fetchUserEmail(), getGoogleAccessToken(), getGoogleStatus(), googleConfigured(), SCOPES, TokenResponse (+11 more)

### Community 10 - "agentReadiness.ts"
Cohesion: 0.08
Nodes (36): AGENT_PRESET_SPECS, AgentPresetSpec, BY_ID, CAPABILITY_HINTS, agentReadiness(), AgentWiring, callerPolicyFromLegacy(), CollaboratorCandidate (+28 more)

### Community 11 - "respondWithAgentIfLinked"
Cohesion: 0.10
Nodes (34): conversationMemories, ConversationMemory, getActiveAgentId(), getConversationMemory(), getDoc(), getHumanHandoff(), getLinkedVisitorProfileId(), getStructuredMemory() (+26 more)

### Community 12 - "runner.ts"
Cohesion: 0.11
Nodes (27): AgentCall, delay(), DeliverCall, executeStep(), FetchResult, runDefinition(), RunnerDeps, RunOutcome (+19 more)

### Community 13 - "apps/types.ts"
Cohesion: 0.10
Nodes (26): FORBIDDEN_IN_TEMPLATE, isRecord(), isText(), ManifestIssue, ManifestValidation, sanitizeImportedManifest(), validateAction(), validateAppManifest() (+18 more)

### Community 14 - "delegation.ts"
Cohesion: 0.11
Nodes (33): presetSpec(), suggestPresetForCapability(), AgentOutputFormat, agentCard(), asOutputFormat(), buildCapabilityMissing(), buildDelegationTools(), CapabilityMissing (+25 more)

### Community 15 - "mongoServer.mjs"
Cohesion: 0.10
Nodes (9): PAGE, startMongo(), stopMongo(), A, B, runs(), wipe(), automations() (+1 more)

### Community 16 - "agentRoutineRoutes.ts"
Cohesion: 0.19
Nodes (25): ensureActivationMode(), getAgentById(), createEventTrigger(), EventTriggerError, buildRoutineDefinition(), createRoutine(), getRoutineForAgent(), listAgentAutomations() (+17 more)

### Community 17 - "whatsapp.ts"
Cohesion: 0.14
Nodes (18): ADAPTERS, authenticateWhatsAppInbound(), channelConfig(), evolution, fetchWhatsAppMedia(), getWhatsAppAdapter(), InboundMediaRef, InboundMessage (+10 more)

### Community 18 - "tools.ts"
Cohesion: 0.09
Nodes (23): revokeInstallation(), encrypt(), clamp(), createTool(), deleteTool(), getTool(), listTools(), normalize() (+15 more)

### Community 19 - "routineExecution.ts"
Cohesion: 0.19
Nodes (11): executeRoutineStep(), KnowledgeUnavailableError, persistWithRetry(), RoutineConfigurationError, RoutineRunContext, RoutineStepCall, RoutineStepResult, StepUsage (+3 more)

### Community 20 - "automations/repository.ts"
Cohesion: 0.13
Nodes (12): automations, findByWebhookKey(), listActiveAutomations(), listActivePublished(), listAutomations(), ListAutomationsQuery, versions, signBody() (+4 more)

### Community 21 - "automations/service.ts"
Cohesion: 0.19
Nodes (16): assertOwnedSectorRefs(), AutomationValidationError, collectSectorRefs(), createAutomation(), defaultDefinition(), normalizeName(), requireFloor(), rotateWebhookSecret() (+8 more)

### Community 22 - "dependencies"
Cohesion: 0.11
Nodes (19): @anthropic-ai/sdk, better-auth, cors, cron-parser, multer, nodemailer, openai, dependencies (+11 more)

### Community 23 - "agentMetrics.ts"
Cohesion: 0.15
Nodes (17): events, AgentEventMetrics, AgentOperationalStats, availableMetricKeys(), composeAgentStats(), GENERIC_LABEL, getAgentEventMetricsBatch(), kpiLabel() (+9 more)

### Community 24 - "delegationWiring.ts"
Cohesion: 0.26
Nodes (14): executeAgentTask(), withTimeout(), buildDeps(), resolveAgentTools(), agentCanDelegate(), capabilityMissingTool(), finishDelegation(), startDelegation() (+6 more)

### Community 25 - "resolveSectorTurn"
Cohesion: 0.12
Nodes (18): setActiveAgentId(), auxModelFor(), buildStageTransitionOptions(), memberRoutingLine(), resolveSectorTurn(), auxiliaryModel(), checkGuardrail(), extractIdentity() (+10 more)

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
Nodes (30): addMessage(), addOwnerReply(), AgentCardStats, ConversationSummary, countVisitorMessagesSince(), createWhatsAppChannel(), deleteWhatsAppChannel(), deleteWidget() (+22 more)

### Community 31 - "sectorDecisions.ts"
Cohesion: 0.29
Nodes (6): aggregateSectorDecisions(), listSectorDecisionsForConversation(), logSectorDecision(), SectorDecision, SectorDecisionAggregate, sectorDecisions

### Community 32 - "sectors.ts"
Cohesion: 0.11
Nodes (25): assignAgentToSector(), AssignOutcome, AssignResult, MembershipFail, sectorOfAgent(), sectors, createSector(), deleteSector() (+17 more)

### Community 33 - "tokenUsage.ts"
Cohesion: 0.18
Nodes (17): dayKey(), ensureTokenUsageIndexes(), foldCharge(), getMonthlyTokens(), getUsageSummary(), isDuplicateKey(), recordReplyUsage(), recordReplyUsageOnce() (+9 more)

### Community 34 - "engine.ts"
Cohesion: 0.17
Nodes (15): CONCURRENCY, embeddedEngineEnabled(), EngineHandle, EngineOptions, engineStatus, LEASE_RENEW_MS, readiness(), RUN_POLL_MS (+7 more)

### Community 35 - "agentEvents.ts"
Cohesion: 0.18
Nodes (12): AGENT_EVENT_SOURCES, AGENT_EVENT_STATUSES, AgentEventSource, AgentEventStatus, AgentExecutionEvent, finalizeAgentEvent(), finalizeAgentEventSafe(), recordAgentEvent() (+4 more)

### Community 36 - "migration.ts"
Cohesion: 0.16
Nodes (19): AgentBuiltinTool, LEGACY_APP_VERSION, agents, AppMigrationReport, backfillConnectionAppKeys(), credentialFingerprint(), ensureGoogleInstallations(), ensureInstallation() (+11 more)

### Community 37 - "validate.ts"
Cohesion: 0.36
Nodes (9): canonical(), computeDefinitionHash(), hasCycle(), isHttpUrl(), isNonEmptyString(), isRecord(), validateDefinition(), validateStepConfig() (+1 more)

### Community 38 - "toolExecution.ts"
Cohesion: 0.18
Nodes (13): decrypt(), getKey(), ExecutableTool, executeToolCall(), ExecuteToolOptions, fillTemplate(), maskHeaders(), maskUrl() (+5 more)

### Community 39 - "eventTrigger.integration.test.mjs"
Cohesion: 0.17
Nodes (4): AGENT, BUILDING, FLOOR, FOREIGN_AGENT

### Community 40 - "eventTrigger.ts"
Cohesion: 0.42
Nodes (8): buildEventTriggerDefinition(), EventTriggerSpec, getEventTriggerForAgent(), isEventTrigger(), listEventTriggers(), updateEventTrigger(), getAutomation(), OutputFormat

### Community 41 - "connections/service.ts"
Cohesion: 0.21
Nodes (11): CONNECTION_CATALOG, createConnection(), CreateConnectionInput, decryptConfig(), getConnection(), isNonEmpty(), normalizeName(), patchConnection() (+3 more)

### Community 42 - "installations.ts"
Cohesion: 0.18
Nodes (12): createInstallation(), CreateInstallationInput, getInstallation(), installations, listInstallations(), normalizeConfig(), normalizeName(), patchInstallation() (+4 more)

### Community 43 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, dev:api, dev:worker, seed:demo, start, start:api (+2 more)

### Community 44 - "automations/types.ts"
Cohesion: 0.11
Nodes (21): insertRunIdempotent(), createRun(), CreateRunInput, AutomationRun, SafeRunError, CreateAutomationInput, UpdateDraftPatch, AutomationDefinition (+13 more)

### Community 45 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 46 - "webhookTriggers.ts"
Cohesion: 0.46
Nodes (7): Automation, agentsReferencedBy(), isLiveWebhook(), liveDefinition(), liveWebhookCountByAgent(), liveWebhookCountFor(), PublishedAutomation

### Community 47 - "scheduler.ts"
Cohesion: 0.23
Nodes (13): findVersion(), advanceFrom(), catchUp(), nextFireAt(), automations, backfillPublishedTriggers(), defaultDeps, ensureSchedulerIndexes() (+5 more)

### Community 48 - "userSettings.ts"
Cohesion: 0.11
Nodes (17): extractTextFromFile(), SUPPORTED_IMAGE_TYPES, getWidgetConfigAgent(), inboundMediaToText(), resolveOwnedSectorId(), Provider, transcribeImage(), requireSector() (+9 more)

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
Nodes (6): connections, deliveries, insertDeliveryIdempotent(), listDeliveries(), sentDeliveriesByAgent(), updateDelivery()

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

### Community 60 - "collaboration.test.mjs"
Cohesion: 0.40
Nodes (5): AGENT, OTHER, SELF, webhookDef(), wh()

### Community 61 - "db.ts"
Cohesion: 0.20
Nodes (9): auth, db, mongoClient, AgentDoc, Sector, listToolCalls(), logToolCalls(), ToolCallLog (+1 more)

### Community 62 - "config.test.mjs"
Cohesion: 0.40
Nodes (3): here, PROD_SECRETS, PROD_URLS

### Community 63 - "groundingContract.test.mjs"
Cohesion: 0.40
Nodes (3): AGENT, call, ctx

### Community 64 - "jsonSchema.test.mjs"
Cohesion: 0.67
Nodes (3): bad(), ok(), orderSchema

### Community 78 - "conversationTurns.ts"
Cohesion: 0.23
Nodes (10): ConversationTurn, EMBEDDING_DIMENSIONS, ensureConversationTurnsVectorIndex(), recordTurn(), searchRelevantTurns(), turns, TURNS_VECTOR_INDEX_NAME, embedText() (+2 more)

### Community 84 - "grants.ts"
Cohesion: 0.21
Nodes (16): missingCapability(), AppActionEvent, appActionEvents, buildAction(), declarativeTool(), instrument(), interpolate(), isVersionCompatible() (+8 more)

### Community 85 - "safeError.ts"
Cohesion: 0.25
Nodes (7): ALIAS, DelegationDenyCode, DENY_MESSAGE, KINDS, MESSAGE, publicDelegationError(), safeErrorKind

### Community 97 - "registry.ts"
Cohesion: 0.12
Nodes (10): email, google, hubspot, LEGACY_APP_KEYS, mercadopago, nuvemshop, rdstation, slack (+2 more)

### Community 98 - "config.ts"
Cohesion: 0.16
Nodes (13): clientUrl, config, FeatureFlags, flags, isProduction, originList(), port, stripTrailingSlash() (+5 more)

### Community 99 - "seedRestaurantDemo.ts"
Cohesion: 0.23
Nodes (13): createAgent(), SEED_CONFIRM_PHRASE, SeedEnv, seedGuard(), seedMayWrite(), SeedPlan, main(), member() (+5 more)

### Community 100 - "delegationLog.ts"
Cohesion: 0.22
Nodes (8): col, DelegationFinish, DelegationRecord, DelegationStart, DelegationStatus, ensureDelegationIndexes(), listDelegationsForAgent(), succeededDelegationsByCaller()

### Community 101 - "safeHttp.ts"
Cohesion: 0.33
Nodes (8): assertPublicUrl(), DEFAULTS, isLoopback(), isPrivateIp(), loopbackAllowed(), safeFetch(), SafeFetchOptions, SafeFetchResult

### Community 102 - "appMigration.integration.test.mjs"
Cohesion: 0.32
Nodes (3): agents(), insertAgent(), readAgent()

## Knowledge Gaps
- **375 isolated node(s):** `AGENT_PRESETS`, `ACTIVATION_MODES`, `LEGACY_ACTIVATION_MODES`, `DELEGATION_POLICIES`, `MetricProfile` (+370 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `attemptChargeKey()` connect `delegationWiring.ts` to `runProcessor.ts`, `tokenUsage.ts`?**
  _High betweenness centrality (0.138) - this node is a cross-community bridge._
- **Why does `execDeps()` connect `delegationWiring.ts` to `mongoServer.mjs`?**
  _High betweenness centrality (0.138) - this node is a cross-community bridge._
- **Why does `startMongo()` connect `mongoServer.mjs` to `appMigration.integration.test.mjs`, `eventTrigger.integration.test.mjs`, `schedulerPublish.integration.test.mjs`, `agentHistory.integration.test.mjs`, `routineDelivery.integration.test.mjs`, `toolsSecurity.test.mjs`, `executionCenter.integration.test.mjs`, `logRoutes.integration.test.mjs`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `buildDeps()` (e.g. with `finalizeAgentEvent()` and `runEventKey()`) actually correct?**
  _`buildDeps()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AGENT_PRESETS`, `ACTIVATION_MODES`, `LEGACY_ACTIVATION_MODES` to the rest of the system?**
  _375 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `floors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06939890710382514 - nodes in this community are weakly interconnected._
- **Should `openai.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.051018465638682654 - nodes in this community are weakly interconnected._