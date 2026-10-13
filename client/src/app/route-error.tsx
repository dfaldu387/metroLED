import { useRouteError } from 'react-router'
import { PageErrorCard } from '@/components/layout/page-error'

/** Router error element: a render error inside a page (the old error.tsx). */
export function RouteError() {
  const error = useRouteError()
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
      <PageErrorCard error={error} onRetry={() => window.location.reload()} />
    </div>
  )
}
