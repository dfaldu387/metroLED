import type { AskPageData } from '@shared/api/operations'
import { formatRelativeTime } from '@shared/dates'
import { useDocumentTitle } from '@/lib/navigation'
import { usePageData } from '@/lib/query'
import { PageQuery } from '@/components/layout/page-error'
import { AskSkeleton } from '@/components/layout/page-skeleton'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/feedback'
import { DataModeBanner, MetaFact } from '@/components/layout/page-header'
import { AskConsole } from './ask-console'

/**
 * Ask MetroLED (section 11).
 *
 * The assistant answers only from a fixed set of approved business queries and
 * attaches the source of every figure. It cannot write SQL and cannot reach a
 * record the signed-in role is not allowed to see - that is enforced in the
 * query layer, not by the model.
 *
 * The page is a full-height column: a slim status row at the top, the
 * conversation (or the welcome prompt) in the middle, the composer pinned to
 * the bottom.
 */
export default function AskPage() {
  useDocumentTitle('Ask MetroLED')
  const query = usePageData<AskPageData>('ask')
  return (
    <PageQuery query={query} skeleton={<AskSkeleton />}>
      {(data) => <Ask data={data} />}
    </PageQuery>
  )
}

function Ask({ data }: { data: AskPageData }) {
  const now = new Date(data.now)
  const { user } = data

  return (
    <div className="flex min-h-[calc(100dvh-6.25rem)] flex-col lg:min-h-[calc(100dvh-6.5rem)]">
      <DataModeBanner mode={data.dataMode} />

      <header className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">Ask MetroLED</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <MetaFact label="Answering as" value={`${user.name} (${user.roleLabel})`} />
          <MetaFact
            label="Data last refreshed"
            value={formatRelativeTime(data.lastRefreshAt ? new Date(data.lastRefreshAt) : null, now)}
            tone={data.isStale ? 'warning' : 'default'}
          />
          {data.dataMode === 'demo' ? (
            <Badge variant="demo" size="sm">
              Demo data
            </Badge>
          ) : null}
        </div>
      </header>

      {!data.configured ? (
        <Alert tone="warning" title="The assistant is not configured yet" className="mb-3">
          An administrator needs to set <code className="font-mono text-[12px]">ANTHROPIC_API_KEY</code> on this
          deployment before questions can be answered. Every dashboard still shows live figures in the meantime.
        </Alert>
      ) : null}

      {!data.canSeeMargin ? (
        <Alert tone="info" title="What the assistant can tell you" className="mb-3">
          Your role does not include profit or gross margin, so the assistant will decline those questions. It
          answers from the same data your dashboards show, and never more.
        </Alert>
      ) : null}

      <AskConsole
        suggestions={data.suggestions}
        initialQuestion={data.initialQuestion}
        enabled={data.configured}
        dataMode={data.dataMode}
        userName={user.name.split(/\s+/)[0] ?? user.name}
      />
    </div>
  )
}
