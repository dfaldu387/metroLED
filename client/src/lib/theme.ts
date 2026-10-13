import * as React from 'react'

/**
 * Light / dark theme.
 *
 * The preference (light, dark or follow the system) is kept in localStorage
 * and applied as `data-theme="light|dark"` on <html>. index.html applies the
 * same rule in an inline script before the first paint, so a dark-mode user
 * never sees a white flash; this module keeps it in sync afterwards and
 * follows the OS setting while "system" is selected.
 */

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'metroled-theme'
const EVENT = 'metroled:theme'

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readPreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference)
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = resolved === 'dark' ? '#0b1220' : '#1a56db'
  return resolved
}

export function setPreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Private mode or blocked storage: the choice still applies for this page.
  }
  applyTheme(preference)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: preference }))
}

export function useTheme(): {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
} {
  const [preference, setLocal] = React.useState<ThemePreference>(() =>
    typeof window === 'undefined' ? 'system' : readPreference(),
  )
  const [resolved, setResolved] = React.useState<ResolvedTheme>(() =>
    typeof window === 'undefined' ? 'light' : resolveTheme(readPreference()),
  )

  React.useEffect(() => {
    setResolved(applyTheme(preference))

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onMedia = () => {
      if (readPreference() === 'system') setResolved(applyTheme('system'))
    }
    const onEvent = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail
      setLocal(next)
      setResolved(resolveTheme(next))
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        const next = readPreference()
        setLocal(next)
        setResolved(applyTheme(next))
      }
    }

    media.addEventListener('change', onMedia)
    window.addEventListener(EVENT, onEvent)
    window.addEventListener('storage', onStorage)
    return () => {
      media.removeEventListener('change', onMedia)
      window.removeEventListener(EVENT, onEvent)
      window.removeEventListener('storage', onStorage)
    }
  }, [preference])

  return { preference, resolved, setPreference }
}
