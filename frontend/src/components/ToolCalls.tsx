import type { ToolCall } from '../lib/types'

function formatArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  return parts.length > 0 ? `(${parts.join(', ')})` : '()'
}

// Compact list of the tools the agent called, for the playgrounds and Chats.
export function ToolCalls({ calls }: { calls: ToolCall[] }) {
  if (calls.length === 0) return null
  return (
    <div className="mt-1 space-y-1">
      {calls.map((call, i) => (
        <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className={call.ok ? 'text-emerald-400' : 'text-red-400'}>🔧</span>
            <span className="font-medium text-slate-300">{call.name}</span>
            <span className="min-w-0 truncate text-slate-500">{formatArgs(call.arguments)}</span>
          </div>
          <p className="mt-0.5 truncate text-slate-500" title={call.result}>
            → {call.result}
          </p>
        </div>
      ))}
    </div>
  )
}
