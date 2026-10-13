import { Navigate, Outlet, useLocation } from 'react-router'
import { MobileNav, Sidebar } from '@/components/layout/sidebar'
import { PwaProvider } from '@/components/layout/pwa'
import { useSessionInfo } from '@/lib/session'

/**
 * Authenticated application shell.
 *
 * The session is resolved once here and the navigation is filtered to the
 * items this role can open. Each page's API endpoint re-checks its own
 * permission on the server, because a filtered sidebar is presentation and not
 * access control.
 */
export function AppLayout() {
  const { data, isPending, isError } = useSessionInfo()
  const location = useLocation()

  if (isPending) return <ShellPlaceholder />
  if (isError || !data?.user) {
    const next = location.pathname + location.search
    return <Navigate to={`/sign-in?next=${encodeURIComponent(next)}`} replace />
  }

  const user = data.user
  // A user with no usable page at all should be told so, not shown an empty shell.
  if (user.landingPage === '/no-access') return <Navigate to="/no-access" replace />

  const sidebarUser = { name: user.name, email: user.email, roleLabel: user.roleLabel, isDemo: user.isDemo }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <MobileNav user={sidebarUser} allowedHrefs={user.allowedHrefs} />
      <Sidebar user={sidebarUser} allowedHrefs={user.allowedHrefs} />

      <main id="main-content" className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
          <Outlet />
        </div>
      </main>

      <PwaProvider />
    </div>
  )
}

function ShellPlaceholder() {
  return <div className="min-h-screen bg-ink-50" aria-busy="true" aria-label="Loading" />
}

/** "/" always resolves to a real destination, never a blank page. */
export function RootRedirect() {
  const { data, isPending } = useSessionInfo()
  if (isPending) return <ShellPlaceholder />
  if (!data?.user) return <Navigate to="/sign-in" replace />
  return <Navigate to={data.user.landingPage} replace />
}
