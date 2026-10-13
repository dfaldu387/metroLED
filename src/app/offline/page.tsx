import type { Metadata } from 'next'
import { WifiOff } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Offline' }

/**
 * Served by the service worker when a navigation fails.
 *
 * It deliberately shows no figures at all: a cached revenue total presented as
 * current would be worse than no answer.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-md">
        <Card>
          <CardContent className="py-7 text-center">
            <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-ink-100">
              <WifiOff className="size-5 text-ink-500" aria-hidden />
            </span>
            <h1 className="text-[18px] font-semibold text-ink-900">You are offline</h1>
            <p className="mt-2 text-[13.5px] leading-5 text-ink-600">
              MetroLED Intelligence needs a connection to show business figures. Nothing is shown from a cache,
              because an out-of-date financial figure is worse than none.
            </p>
            <p className="mt-2 text-[13px] leading-5 text-ink-600">
              Reconnect and reload this page to continue.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
