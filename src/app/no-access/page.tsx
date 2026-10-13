import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { PERMISSION_LABELS, type Permission } from '@/lib/auth/permissions'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { defaultLandingPage } from '@/lib/navigation'

export const metadata: Metadata = { title: 'No access' }

/**
 * Shown when an authenticated user opens a page their role does not include.
 *
 * It names the missing permission and who to ask, rather than a bare 403, so
 * the user knows exactly what to request.
 */
export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ permission?: string }>
}) {
  const { permission } = await searchParams
  const user = await getSession()
  const label = permission ? PERMISSION_LABELS[permission as Permission] : undefined
  const landing = user ? defaultLandingPage(user.permissions) : '/sign-in'
  const hasSomewhereToGo = landing !== '/no-access'

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-md">
        <Card>
          <CardContent className="py-7 text-center">
            <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-warning-50">
              <ShieldAlert className="size-5 text-warning-700" aria-hidden />
            </span>
            <h1 className="text-[18px] font-semibold text-ink-900">You do not have access to that page</h1>
            <p className="mt-2 text-[13.5px] leading-5 text-ink-600">
              {label
                ? `Your role does not include permission to ${label.toLowerCase()}.`
                : 'Your role does not include access to the page you requested.'}{' '}
              {user ? `You are signed in as ${user.name} (${user.roleLabel}).` : ''}
            </p>
            <p className="mt-2 text-[13px] leading-5 text-ink-600">
              Ask an account owner to review your permissions in Users &amp; Permissions if you need this access.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              {hasSomewhereToGo ? (
                <Button asChild variant="primary" size="md">
                  <Link href={landing}>Go to a page you can open</Link>
                </Button>
              ) : null}
              <Button asChild variant="secondary" size="md">
                {/* A sign-out is a state change, so a POST and not a link. */}
                <form action="/api/auth/sign-out" method="post">
                  <button type="submit">Sign out</button>
                </form>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
