import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-black/20 px-1 py-0.5 text-[0.85em]">{children}</code>,
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded bg-black/20 p-2 text-[0.85em] last:mb-0">{children}</pre>
  ),
}

// The agent's reply can include markdown (bold, lists) when the agent's
// "Formatação" style setting is on. react-markdown never uses
// dangerouslySetInnerHTML, so this stays safe even though the content is
// LLM-generated free text.
export function MessageContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkBreaks]} components={MARKDOWN_COMPONENTS}>
      {content}
    </ReactMarkdown>
  )
}
