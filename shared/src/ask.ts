/**
 * Parsing of the Ask MetroLED assistant's four-part answer.
 *
 * Moved from the old ask-console client component so the server unit tests and
 * the client page share one implementation.
 */

export interface AnswerBlock {
  label: string | null
  text: string
}

export function parseAnswer(content: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = []
  // Split on bold headings like "**Answer:**" at the start of a line.
  const pattern = /^\s*\*\*(.+?):?\*\*:?\s*/gm

  let lastIndex = 0
  let lastLabel: string | null = null
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    const preceding = content.slice(lastIndex, match.index).trim()
    if (preceding) blocks.push({ label: lastLabel, text: stripBold(preceding) })
    lastLabel = match[1] ?? null
    lastIndex = pattern.lastIndex
  }

  const remainder = content.slice(lastIndex).trim()
  if (remainder) blocks.push({ label: lastLabel, text: stripBold(remainder) })

  return blocks.length > 0 ? blocks : [{ label: null, text: stripBold(content.trim()) }]
}

function stripBold(value: string): string {
  return value.replace(/\*\*(.+?)\*\*/g, '$1')
}
