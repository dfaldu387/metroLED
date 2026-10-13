import type { AccountPageData } from '@shared/api/operations'
import { ROLE_LABELS, PERMISSION_LABELS } from '@shared/permissions'
import { formatDateTime } from '@shared/format'
import { formatRelativeTime } from '@shared/dates'
import { Link, useDocumentTitle } from '@/lib/navigation'
import { usePageData } from '@/lib/query'
import { PageQuery } from '@/components/layout/page-error'
import { FormPageSkeleton } from '@/components/layout/page-skeleton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/feedback'
import { Avatar } from '@/components/ui/misc'
import { PageHeader } from '@/components/layout/page-header'
import { ChangePasswordForm } from './change-password-form'

/**
 * The signed-in user's own account.
 *
 * Shows exactly what their role lets them see, so a user who finds a page
 * missing can understand why without asking an administrator.
 */
export default function AccountPage() {
  useDocumentTitle('Account')
  const query = usePageData<AccountPageData>('account')
  return (
    <PageQuery query={query} skeleton={<FormPageSkeleton />}>
      {(data) => <Account data={data} />}
    </PageQuery>
  )
}

function Account({ data }: { data: AccountPageData }) {
  const now = new Date(data.now)
  const { user, sessions, granted, denied } = data

  return (
    <>
      <PageHeader
        title="Your account"
        description="Your sign-in details, what your role allows, and your active sessions."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Profile</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-4">
                <Avatar name={user.name} size="lg" />
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-ink-900">{user.name}</p>
                  <p className="text-[13px] text-ink-600">{user.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {user.roles.map((role) => (
                      <Badge key={role} variant={role === 'OWNER' ? 'brand' : 'neutral'} size="sm">
                        {ROLE_LABELS[role]}
                      </Badge>
                    ))}
                    {user.isDemo ? (
                      <Badge variant="demo" size="sm">
                        Demo session
                      </Badge>
                    ) : null}
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <dt className="text-[11.5px] text-ink-500">Timezone</dt>
                      <dd className="text-[13px] font-medium text-ink-900">{user.timezone}</dd>
                    </div>
                    <div>
                      <dt className="text-[11.5px] text-ink-500">Data scope</dt>
                      <dd className="text-[13px] font-medium text-ink-900">
                        {user.salesRepId ? 'Own records only' : 'All records'}
                        {user.divisionIds.length > 0 ? `, ${user.divisionIds.length} divisions` : ''}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </CardContent>
          </Card>

          {user.isDemo ? (
            <Alert tone="warning" title="This is a demo session">
              You are previewing the interface as a {user.roleLabel}. There is no real account behind this session
              and no password to change. Sign out and use real credentials to make any change that is recorded.
            </Alert>
          ) : (
            <ChangePasswordForm mustChange={user.mustChangePassword} />
          )}

          {sessions.length > 0 ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Active sessions</CardTitle>
                  <CardDescription>
                    Where you are currently signed in. Changing your password signs out every other session.
                  </CardDescription>
                </div>
              </CardHeader>
              <ul className="divide-y divide-ink-200">
                {sessions.map((session) => (
                  <li key={session.id} className="px-4 py-3 sm:px-5">
                    <p className="text-[13px] text-ink-800">
                      {session.userAgent ? shortenUserAgent(session.userAgent) : 'Unknown device'}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-ink-500">
                      {session.ipAddress ? `${session.ipAddress} · ` : ''}
                      Last active {formatRelativeTime(new Date(session.lastSeenAt), now)} &middot; expires{' '}
                      {formatDateTime(session.expiresAt, user.timezone)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        {/* --- What your role allows ---------------------------------------- */}
        <Card className="h-fit">
          <CardHeader>
            <div>
              <CardTitle>What your role allows</CardTitle>
              <CardDescription>
                Enforced on the server for every page and every API request.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-positive-700">
                You can
              </p>
              <ul className="space-y-1.5">
                {granted.map((permission) => (
                  <li key={permission} className="flex items-start gap-2 text-[12.5px] leading-5 text-ink-700">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-positive-500" aria-hidden />
                    {PERMISSION_LABELS[permission]}
                  </li>
                ))}
              </ul>
            </div>

            {denied.length > 0 ? (
              <div className="border-t border-ink-200 pt-4">
                <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-500">
                  You cannot
                </p>
                <ul className="space-y-1.5">
                  {denied.map((permission) => (
                    <li key={permission} className="flex items-start gap-2 text-[12.5px] leading-5 text-ink-500">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-300" aria-hidden />
                      {PERMISSION_LABELS[permission]}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[12px] leading-5 text-ink-500">
                  If you need one of these, ask an account owner to review your permissions in{' '}
                  <Link href="/users" className="font-medium text-brand-700 underline">
                    Users &amp; Permissions
                  </Link>
                  .
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  )
}


/** Turns a raw user-agent string into something a person can recognise. */
function shortenUserAgent(userAgent: string): string {
  const browser =
    /Edg\//.test(userAgent)
      ? 'Edge'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : /Firefox\//.test(userAgent)
            ? 'Firefox'
            : 'Browser'

  const platform = /iPhone|iPad/.test(userAgent)
    ? 'iPhone or iPad'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Macintosh/.test(userAgent)
        ? 'Mac'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : 'Unknown device'

  return `${browser} on ${platform}`
}
