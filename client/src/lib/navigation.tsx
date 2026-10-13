import * as React from 'react'
import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useSearchParams as useRouterSearchParams,
} from 'react-router'
import { refreshAll } from './query'

/**
 * Navigation helpers with the same shape as the `next/link` and
 * `next/navigation` APIs the components were written against, so components
 * ported from the Next.js app only need their import path changed:
 *
 *   import Link from 'next/link'                    -> import { Link } from '@/lib/navigation'
 *   import { useRouter, usePathname } from 'next/navigation' -> from '@/lib/navigation'
 */

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string
  replace?: boolean
  /** Accepted for compatibility; Vite code-splits per route instead. */
  prefetch?: boolean | null
  /** false keeps the scroll position (Next.js `scroll={false}`). */
  scroll?: boolean
}

function isExternal(href: string) {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href) || href.startsWith('/api/')
}

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, replace, prefetch: _prefetch, scroll, ...rest },
  ref,
) {
  if (isExternal(href) || href.startsWith('#')) return <a ref={ref} href={href} {...rest} />
  return <RouterLink ref={ref} to={href} replace={replace} preventScrollReset={scroll === false} {...rest} />
})

export default Link

export function usePathname(): string {
  return useLocation().pathname
}

/** Read-only search params (Next.js `useSearchParams` semantics). */
export function useSearchParams(): URLSearchParams {
  return useRouterSearchParams()[0]
}

export function useRouter() {
  const navigate = useNavigate()
  return React.useMemo(
    () => ({
      push: (href: string, _opts?: { scroll?: boolean }) => navigate(href),
      replace: (href: string, _opts?: { scroll?: boolean }) => navigate(href, { replace: true }),
      back: () => navigate(-1),
      forward: () => navigate(1),
      /** Re-fetches the data on screen, like Next's `router.refresh()`. */
      refresh: () => void refreshAll(),
      prefetch: (_href: string) => undefined,
    }),
    [navigate],
  )
}

/**
 * `next/link`'s useLinkStatus. Client navigation in the SPA is immediate (the
 * page shows its own loading state), so a link is never "pending".
 */
export function useLinkStatus(): { pending: boolean } {
  return { pending: false }
}

/** Sets document.title the way Next.js `metadata.title` did ("%s · MetroLED Intelligence"). */
export function useDocumentTitle(title: string | null | undefined) {
  React.useEffect(() => {
    document.title = title ? `${title} · MetroLED Intelligence` : 'MetroLED Intelligence'
  }, [title])
}
