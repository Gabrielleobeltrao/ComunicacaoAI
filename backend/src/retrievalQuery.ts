// What a retrieval is a question ABOUT. Pure and DB-free on purpose: the routine
// step imports it, and that module must stay unit-testable without a database.
//
// The input is part of the question. It used to be included only when it was a
// string, so a step whose input was an object or an array retrieved nothing —
// exactly the shape a webhook or a previous step hands over.
export function buildRetrievalQuery(
  parts: { objective?: string | null; instructions?: string | null; input?: unknown },
  maxChars = 2000,
): string {
  const input =
    parts.input === undefined || parts.input === null
      ? ''
      : typeof parts.input === 'string'
        ? parts.input
        : (() => {
            try {
              return JSON.stringify(parts.input)
            } catch {
              return ''
            }
          })()
  return [parts.objective ?? '', parts.instructions ?? '', input]
    .map((piece) => String(piece).trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxChars)
}
