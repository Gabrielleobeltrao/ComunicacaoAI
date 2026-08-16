// The thing the runtime actually calls.
//
// Instrumentation must be impossible to get wrong in two ways: it must never break
// the execution it is watching (every write is fire-and-forget and swallows its own
// errors), and it must never be the thing that decides an agent is busy — it only
// mirrors a transition that really happened.
import type { ObjectId } from 'mongodb'
import type { AgentBubbleState } from './agentLiveState.js'
import { finishAgentState, reportAgentState } from './agentLiveState.js'
import type { ResolvedTool } from './agentTools.js'
import { SYSTEM_APPS } from './apps/registry.js'

export interface LiveTrackerContext {
  ownerId: string
  agentId: ObjectId | string
  floorId?: ObjectId | string | null
  rootExecutionId: string
}

export interface LiveTracker {
  // Fire-and-forget: the caller never awaits telemetry.
  report(state: AgentBubbleState, detail?: unknown): void
  // Awaited: used where the transition must be visible BEFORE the caller moves on —
  // a state the execution stops in, like `blocked`, must not race the throw.
  reportNow(state: AgentBubbleState, detail?: unknown): Promise<void>
  // Awaited in `finally`, so an execution never ends on an active state.
  finish(state: 'completed' | 'failed' | 'canceled'): Promise<void>
}

// Used everywhere instrumentation is optional. Costs nothing and keeps call sites
// free of `if (tracker)`.
export const NOOP_TRACKER: LiveTracker = {
  report: () => undefined,
  reportNow: async () => undefined,
  finish: async () => undefined,
}

export function createLiveTracker(ctx: LiveTrackerContext): LiveTracker {
  // Writes are chained so two transitions in the same millisecond keep their order;
  // the stored `sequence` still decides who wins if they race anyway.
  let chain: Promise<unknown> = Promise.resolve()
  const enqueue = (run: () => Promise<unknown>): Promise<unknown> => {
    chain = chain.then(run, run).catch(() => undefined)
    return chain
  }

  return {
    report(state, detail) {
      void enqueue(() => reportAgentState({ ...ctx, state, detail }))
    },
    async reportNow(state, detail) {
      await enqueue(() => reportAgentState({ ...ctx, state, detail }))
    },
    async finish(state) {
      await enqueue(() => finishAgentState({ ...ctx, state }))
    },
  }
}

// A public label for a tool the model is about to run. It is derived from the
// CATALOG, never from the tool's own name or URL: an owner's Custom Tool is reported
// as a generic action, because its name is theirs to write and could say anything.
export function toolDetail(toolName: string): { appKey?: string; actionLabel: string } {
  const found = catalogIndex().get(toolName)
  if (!found) return { actionLabel: 'Usando ferramenta' }
  return { appKey: found.appKey, actionLabel: found.actionLabel }
}

// action name → (App, public label). Built once; the catalog is static.
let index: Map<string, { appKey: string; actionLabel: string }> | null = null
function catalogIndex(): Map<string, { appKey: string; actionLabel: string }> {
  if (!index) {
    index = new Map()
    for (const app of SYSTEM_APPS) {
      for (const action of app.actions) index.set(action.key, { appKey: app.key, actionLabel: action.name })
    }
  }
  return index
}

// Wrap a tool list so every call reports `using_tool` before and returns to
// `thinking` after. The wrapper adds nothing the model can see: same name, same
// description, same schema.
export function instrumentTools(tools: ResolvedTool[], tracker: LiveTracker): ResolvedTool[] {
  if (tracker === NOOP_TRACKER || tools.length === 0) return tools
  return tools.map((tool) => ({
    ...tool,
    run: async (args) => {
      tracker.report('using_tool', toolDetail(tool.name))
      try {
        return await tool.run(args)
      } finally {
        // The model is reasoning again the moment the tool returns.
        tracker.report('thinking')
      }
    },
  }))
}
