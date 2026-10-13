import * as React from 'react'
import { AlertOctagon, RefreshCw } from 'lucide-react'
import { Link } from '@/lib/navigation'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * "This page could not be loaded" card.
 *
 * Section 3: every error must explain what happened and what the user can do.
 * It names the likely cause in plain language and offers a retry. The stack
 * is never shown; a server error message is shown only when it is one the API
 * wrote for users (an ApiError), never a raw exception.
 */
export function PageErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  React.useEffect(() => {
    console.error('[page] load failed', error)
  }, [error])

  const message = error instanceof Error ? error.message : ''
  const isDatabase =
    (error instanceof ApiError && (error.status === 503 || error.code === 'NETWORK')) ||
    /database|connect|ECONNREFUSED/i.test(message)

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-lg">
        <CardContent className="py-7 text-center">
          <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-negative-50">
            <AlertOctagon className="size-5 text-negative-600" aria-hidden />
          </span>
          <h1 className="text-[18px] font-semibold text-ink-900">This page could not be loaded</h1>
          <p className="mt-2 text-[13.5px] leading-5 text-ink-600">
            {isDatabase
              ? 'The reporting database or server could not be reached, so no figures can be shown. This is usually temporary.'
              : error instanceof ApiError && error.status < 500
                ? error.message
                : 'Something went wrong while preparing this page. Nothing was changed, and no data was lost.'}
          </p>
          <p className="mt-2 text-[13px] leading-5 text-ink-600">
            Try again. If it keeps happening, check the Data Health page, or contact whoever maintains this system.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {onRetry ? (
              <Button variant="primary" size="md" onClick={onRetry}>
                <RefreshCw aria-hidden />
                Try again
              </Button>
            ) : null}
            <Button asChild variant="secondary" size="md">
              <Link href="/overview">Go to the Overview</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Renders a page query: skeleton while the first load is pending, the error
 * card on failure, otherwise `children(data)`. While a filter change refetches,
 * the previous data stays on screen (placeholderData) with a thin progress bar.
 *
 *   const query = usePageData<OverviewPageData>('overview')
 *   return <PageQuery query={query} skeleton={<OverviewSkeleton />}>{(data) => <Overview data={data} />}</PageQuery>
 */
export function PageQuery<T>({
  query,
  skeleton,
  children,
}: {
  query: {
    data: T | undefined
    error: unknown
    isPending: boolean
    isError: boolean
    isFetching: boolean
    isPlaceholderData?: boolean
    refetch: () => unknown
  }
  skeleton: React.ReactNode
  children: (data: T) => React.ReactNode
}) {
  if (query.isPending) return <>{skeleton}</>
  if (query.isError && query.data === undefined) {
    // 401/403 are redirected by the query client; render nothing meanwhile.
    if (query.error instanceof ApiError && (query.error.status === 401 || query.error.status === 403)) {
      return <>{skeleton}</>
    }
    return <PageErrorCard error={query.error} onRetry={() => void query.refetch()} />
  }
  return (
    <>
      {query.isFetching && query.isPlaceholderData ? (
        <div
          role="progressbar"
          aria-label="Updating figures"
          className="fixed inset-x-0 top-0 z-[60] h-0.5 animate-pulse bg-brand-500"
        />
      ) : null}
      {children(query.data as T)}
    </>
  )
}
