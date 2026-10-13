import type { Metadata } from 'next'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { getPageContext } from '@/lib/page-context'
import { assistantConfigured } from '@/lib/ai/assistant'
import { SUGGESTED_QUESTIONS } from '@/lib/ai/tools'
import { formatRelativeTime } from '@/lib/dates'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact, PageHeader } from '@/components/layout/page-header'
import { AskConsole } from './ask-console'

export const metadata: Metadata = { title: 'Ask MetroLED' }

/**
 * Ask MetroLED (section 11).
 *
 * The assistant answers only from a fixed set of approved business queries and
 * attaches the source of every figure. It cannot write SQL and cannot reach a
 * record the signed-in role is not allowed to see - that is enforced in the
 * query layer, not by the model.
 */
export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const context = await getPageContext(PERMISSIONS.AI_USE, '/ask', params, { months: 24 })
  const { dataset, scope, user, now } = context

  const initialQuestion = typeof params.q === 'string' ? params.q : null
  const configured = assistantConfigured()

  // Only suggest questions this role can actually have answered.
  const suggestions = SUGGESTED_QUESTIONS.filter((question) => {
    const lower = question.toLowerCase()
    if ((lower.includes('margin') || lower.includes('profit')) && !scope.canSeeMargin) return false
    if (lower.includes('overdue') && !scope.canSeeReceivables) return false
    if (lower.includes('eco led mart') && !scope.canSeeEcommerce) return false
    return true
  })

  return (
    <>
      <DataModeBanner mode={dataset.mode} />

      <PageHeader
        title="Ask MetroLED"
        description="Ask a question about company data in plain English. Every answer shows where the figure came from and how fresh it is."
        meta={
          <>
            <MetaFact label="Answering as" value={`${user.name} (${user.roleLabel})`} />
            <MetaFact
              label="Data last refreshed"
              value={formatRelativeTime(dataset.freshness.lastRefreshAt, now)}
              tone={dataset.freshness.isStale ? 'warning' : 'default'}
            />
            {dataset.mode === 'demo' ? (
              <Badge variant="demo" size="sm">
                Demo data
              </Badge>
            ) : null}
          </>
        }
      />

      {!configured ? (
        <Alert tone="warning" title="The assistant is not configured yet" className="mb-5">
          An administrator needs to set <code className="font-mono text-[12px]">ANTHROPIC_API_KEY</code> on this
          deployment before questions can be answered. Every dashboard still shows live figures in the meantime.
        </Alert>
      ) : null}

      {!scope.canSeeMargin ? (
        <Alert tone="info" title="What the assistant can tell you" className="mb-5">
          Your role does not include profit or gross margin, so the assistant will decline those questions. It
          answers from the same data your dashboards show, and never more.
        </Alert>
      ) : null}

      <AskConsole
        suggestions={suggestions}
        initialQuestion={initialQuestion}
        enabled={configured}
        dataMode={dataset.mode}
        userName={user.name.split(/\s+/)[0] ?? user.name}
      />
    </>
  )
}
