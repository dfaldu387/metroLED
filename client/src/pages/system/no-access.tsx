import { ShieldAlert } from 'lucide-react'
import { PERMISSION_LABELS, type Permission } from '@shared/permissions'
import { Link, useDocumentTitle, useSearchParams } from '@/lib/navigation'
import { api } from '@/lib/api'
import { useSessionInfo } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Shown when an authenticated user opens a page their role does not include.
 *
 * It names the missing permission and who to ask, rather than a bare 403, so
 * the user knows exactly what to request.
 */
export default function NoAccessPage() {
  useDocumentTitle('No access')
  const permission = useSearchParams().get('permission')
  const { data } = useSessionInfo()
  const user = data?.user ?? null

  const label = permission ? PERMISSION_LABELS[permission as Permission] : undefined
  const landing = user ? user.landingPage : '/sign-in'
  const hasSomewhereToGo = landing !== '/no-access'

  async function signOut() {
    try {
      await api.post('/api/auth/sign-out')
    } finally {
      window.location.assign('/sign-in')
    }
  }

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
              {/* A sign-out is a state change, so a POST and not a link. */}
              <Button variant="secondary" size="md" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
