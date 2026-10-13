import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { ALL_NAV_ITEMS, defaultLandingPage } from '@/lib/navigation'
import { MobileNav, Sidebar } from '@/components/layout/sidebar'
import { PwaProvider } from '@/components/layout/pwa'

/**
 * Authenticated application shell.
 *
 * The session is resolved once here and the navigation is filtered to the
 * items this role can open. Each page then re-checks its own permission
 * server-side, because a filtered sidebar is presentation and not access
 * control.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession()
  if (!user) redirect('/sign-in')

  // A user with no usable page at all should be told so, not shown an empty shell.
  const landing = defaultLandingPage(user.permissions)
  if (landing === '/no-access') redirect('/no-access')

  const allowedHrefs = ALL_NAV_ITEMS.filter((item) => user.permissions.has(item.permission)).map(
    (item) => item.href,
  )

  const sidebarUser = {
    name: user.name,
    email: user.email,
    roleLabel: user.roleLabel,
    isDemo: user.isDemo,
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <MobileNav user={sidebarUser} allowedHrefs={allowedHrefs} />
      <Sidebar user={sidebarUser} allowedHrefs={allowedHrefs} />

      <main id="main-content" className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">{children}</div>
      </main>

      <PwaProvider />
    </div>
  )
}
