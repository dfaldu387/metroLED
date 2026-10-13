/*
 * MetroLED Intelligence service worker.
 *
 * Scope is deliberately narrow. This application reports financial figures, so
 * the service worker must NEVER serve a stale number from a cache: a cached
 * revenue total presented as current would be worse than no answer at all.
 *
 * Therefore:
 *   - Navigations and every request under /api are network-only. If the
 *     network is unavailable the user gets the offline page, which says plainly
 *     that figures cannot be shown while offline.
 *   - Only the application shell assets (icons, manifest, the offline page) are
 *     pre-cached, so an installed home-screen app opens and explains itself
 *     instead of showing a browser error.
 */

const VERSION = 'metroled-v3'
const SHELL_CACHE = `${VERSION}-shell`
const OFFLINE_URL = '/offline'

const SHELL_ASSETS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // One failed asset must not abort the whole install.
      await Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never cache data. A stale financial figure is a wrong financial figure.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          const offline = await cache.match(OFFLINE_URL)
          return (
            offline ??
            new Response('You are offline. MetroLED Intelligence needs a connection to show business figures.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          )
        }
      })(),
    )
    return
  }

  // Static shell assets: cache first, since they never carry business data.
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest' ||
    // Vite build output under /assets is content-hashed, so a cached copy
    // can never be a stale version of a changed file.
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE)
        const hit = await cache.match(request)
        if (hit) return hit
        try {
          const response = await fetch(request)
          if (response.ok) cache.put(request, response.clone())
          return response
        } catch {
          return new Response('', { status: 504 })
        }
      })(),
    )
  }
})
