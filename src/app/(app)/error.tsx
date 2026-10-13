'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertOctagon, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Error boundary for the authenticated pages.
 *
 * Section 3: every error must explain what happened and what the user can do.
 * It names the likely cause in plain language, offers a retry that re-renders
 * the segment rather than a full reload, and shows the digest so an operator
 * can find the matching server log entry. The stack is never shown.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[page] render failed', error)
  }, [error])

  // The message is safe to show only when we wrote it ourselves; anything else
  // could carry internals, so it is replaced with a plain explanation.
  const isDatabase = /database|prisma|connect|ECONNREFUSED|P\d{4}/i.test(error.message)

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
              ? 'The reporting database could not be reached, so no figures can be shown. This is usually temporary.'
              : 'Something went wrong while preparing this page. Nothing was changed, and no data was lost.'}
          </p>

          <p className="mt-2 text-[13px] leading-5 text-ink-600">
            Try again. If it keeps happening, check the Data Health page, or send the reference below to whoever
            maintains this system.
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button variant="primary" size="md" onClick={reset}>
              <RefreshCw aria-hidden />
              Try again
            </Button>
            <Button asChild variant="secondary" size="md">
              <Link href="/overview">Go to the Overview</Link>
            </Button>
          </div>

          {error.digest ? (
            <p className="mt-5 border-t border-ink-200 pt-4 text-[11.5px] text-ink-500">
              Reference: <code className="font-mono text-ink-700">{error.digest}</code>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
