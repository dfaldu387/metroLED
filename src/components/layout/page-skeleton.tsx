import { ChartSkeleton, KpiSkeleton, Skeleton, TableSkeleton } from '@/components/ui/feedback'

/**
 * Route-level loading skeletons.
 *
 * These matter more than they look. Every page in this application is a
 * server component that reads the session, so navigating to one is a server
 * round trip. Without a `loading.tsx` boundary the router keeps the PREVIOUS
 * page on screen and shows nothing at all until the new one has finished
 * rendering - so a click appears to do nothing for a second or more, and the
 * application feels broken rather than busy.
 *
 * With a boundary, the shell appears instantly and the real content streams
 * in behind it.
 *
 * Each skeleton mirrors the shape of the page it stands in for, so the layout
 * does not jump when the content arrives.
 */

function HeaderSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
        <div className="mt-3 flex flex-wrap gap-4">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-32 rounded-lg" />
        ))}
      </div>
    </div>
  )
}

function FilterSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-44 rounded-lg" />
      ))}
    </div>
  )
}

function CardSkeleton({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`surface p-4 sm:p-5 ${className ?? ''}`}>{children}</div>
}

/** Overview: five KPI cards, an attention list, two charts. */
export function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the overview">
      <HeaderSkeleton actions={2} />
      <FilterSkeleton />
      <div className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
      <Skeleton className="mb-3 h-4 w-40" />
      <CardSkeleton className="mb-7">
        <TableSkeleton rows={4} columns={3} />
      </CardSkeleton>
      <div className="grid gap-4 xl:grid-cols-5">
        <CardSkeleton className="xl:col-span-3">
          <Skeleton className="mb-4 h-4 w-44" />
          <ChartSkeleton height={260} />
        </CardSkeleton>
        <CardSkeleton className="xl:col-span-2">
          <Skeleton className="mb-4 h-4 w-44" />
          <ChartSkeleton height={260} />
        </CardSkeleton>
      </div>
    </div>
  )
}

/** A page of headline stats, charts and a table. */
export function AnalyticsSkeleton({
  stats = 4,
  charts = 2,
  filters = 3,
}: {
  stats?: number
  charts?: number
  filters?: number
}) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <HeaderSkeleton />
      <FilterSkeleton count={filters} />
      <CardSkeleton className="mb-5">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-6 w-32" />
              <Skeleton className="mt-2 h-3 w-28" />
            </div>
          ))}
        </div>
      </CardSkeleton>
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: charts }).map((_, i) => (
          <CardSkeleton key={i}>
            <Skeleton className="mb-4 h-4 w-48" />
            <ChartSkeleton height={240} />
          </CardSkeleton>
        ))}
      </div>
      <CardSkeleton>
        <Skeleton className="mb-4 h-4 w-40" />
        <TableSkeleton rows={8} columns={6} />
      </CardSkeleton>
    </div>
  )
}

/** A page that is mostly one long table. */
export function TablePageSkeleton({ filters = 2 }: { filters?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <HeaderSkeleton />
      <FilterSkeleton count={filters} />
      <CardSkeleton>
        <Skeleton className="mb-4 h-4 w-48" />
        <TableSkeleton rows={10} columns={6} />
      </CardSkeleton>
    </div>
  )
}

/** Stacked document-style sections: the daily brief. */
export function DocumentSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <HeaderSkeleton actions={2} />
      {Array.from({ length: 4 }).map((_, i) => (
        <CardSkeleton key={i} className="mb-5">
          <Skeleton className="mb-4 h-4 w-56" />
          <div className="grid gap-5 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-2 h-6 w-28" />
              </div>
            ))}
          </div>
        </CardSkeleton>
      ))}
    </div>
  )
}

/** Settings and administration: a form or list in a card. */
export function FormPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <HeaderSkeleton />
      <CardSkeleton>
        <Skeleton className="mb-5 h-4 w-48" />
        <div className="grid gap-5 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-2 h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </CardSkeleton>
    </div>
  )
}

/** The assistant: suggestions grid and composer. */
export function AskSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <HeaderSkeleton actions={0} />
      <CardSkeleton className="mb-4">
        <div className="mx-auto max-w-2xl py-6">
          <Skeleton className="mx-auto h-11 w-11 rounded-full" />
          <Skeleton className="mx-auto mt-4 h-5 w-64" />
          <Skeleton className="mx-auto mt-2 h-4 w-80 max-w-full" />
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11 rounded-lg" />
            ))}
          </div>
        </div>
      </CardSkeleton>
      <CardSkeleton>
        <Skeleton className="h-9 w-full rounded-lg" />
      </CardSkeleton>
    </div>
  )
}
