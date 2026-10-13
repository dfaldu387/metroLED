'use client'

import * as React from 'react'
import { Download, WifiOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * PWA registration, install prompt and offline indicator.
 *
 * The install prompt is offered once and is dismissible; it is never shown
 * again in the same session after being dismissed.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'metroled.install-prompt-dismissed'

export function PwaProvider() {
  const [installEvent, setInstallEvent] = React.useState<BeforeInstallPromptEvent | null>(null)
  const [offline, setOffline] = React.useState(false)

  React.useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // In development, chunk URLs under /_next/static are not content-hashed, so
    // a cache-first service worker would keep serving yesterday's JavaScript
    // against today's server HTML (a hydration mismatch). Remove it instead.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .then(() => (typeof caches === 'undefined' ? undefined : caches.keys()))
        .then((names) => Promise.all((names ?? []).map((n) => caches.delete(n))))
        .catch(() => undefined)
      return
    }

    {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        // A failed registration must not break the application.
        console.warn('[pwa] service worker registration failed', error)
      })
    }
  }, [])

  React.useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      try {
        if (window.sessionStorage.getItem(DISMISS_KEY) === '1') return
      } catch {
        // Private browsing can block storage; showing the prompt is fine.
      }
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  React.useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setInstallEvent(null)
  }

  return (
    <>
      {offline ? (
        <div
          role="alert"
          className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2 bg-ink-900 px-4 py-2 text-[12.5px] font-medium text-white print-hidden"
        >
          <WifiOff className="size-3.5" aria-hidden />
          You are offline. Figures on screen may be out of date and cannot be refreshed.
        </div>
      ) : null}

      {installEvent ? (
        <div className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-ink-200 bg-white p-4 shadow-overlay print-hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13.5px] font-semibold text-ink-900">Add MetroLED to your home screen</p>
              <p className="mt-1 text-[12.5px] leading-5 text-ink-600">
                Open your dashboards in one tap, like an app. You will still need a connection to see current
                figures.
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss install prompt"
              className="shrink-0 rounded-md p-1 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                const event = installEvent
                setInstallEvent(null)
                await event.prompt()
                await event.userChoice
              }}
            >
              <Download aria-hidden />
              Install app
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}
