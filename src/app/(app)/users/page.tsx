import type { Metadata } from 'next'
import { Users as UsersIcon } from 'lucide-react'
import { PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS, DEFAULT_ROLE_PERMISSIONS, ALL_PERMISSIONS, PERMISSION_LABELS } from '@/lib/auth/permissions'
import { requirePermission } from '@/lib/auth/guards'
import { prisma, databaseReachable } from '@/lib/db'
import { formatDateTime } from '@/lib/format'
import { formatRelativeTime } from '@/lib/dates'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { PageHeader, SectionHeading } from '@/components/layout/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { UserTable } from './user-table'
import { CreateUserDialog } from './create-user-dialog'
import { PermissionsMatrix } from './permissions-matrix'

export const metadata: Metadata = { title: 'Users & Permissions' }

/**
 * Users & Permissions (section 16).
 *
 * Shows who can sign in, what role they hold, and exactly what each role may
 * see. The permissions matrix is editable so the client can confirm it without
 * a code deploy, and every change is written to the audit log.
 */
export default async function UsersPage() {
  const admin = await requirePermission(PERMISSIONS.USERS_MANAGE, '/users')
  const dbReady = await databaseReachable()
  const now = new Date()

  if (!dbReady) {
    return (
      <>
        <PageHeader
          title="Users & Permissions"
          description="Who can sign in, what role they hold and what each role may see."
        />
        <Alert tone="negative" title="The reporting database is not reachable">
          User accounts live in the database. Set <code className="font-mono text-[12px]">DATABASE_URL</code>, run{' '}
          <code className="font-mono text-[12px]">npm run db:deploy</code> and{' '}
          <code className="font-mono text-[12px]">npm run db:seed</code> to create the first owner account.
        </Alert>
      </>
    )
  }

  const [users, roles, divisions, salesReps, auditEntries] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        roles: { include: { role: true } },
        divisionAccess: { include: { division: true } },
        salesRep: { select: { id: true, name: true } },
        sessions: { where: { revokedAt: null, expiresAt: { gt: now } }, select: { id: true } },
      },
    }),
    prisma.role.findMany({ include: { permissions: true }, orderBy: { name: 'asc' } }),
    prisma.division.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.salesRep.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    admin.permissions.has(PERMISSIONS.AUDIT_VIEW)
      ? prisma.auditLog.findMany({
          where: { action: { startsWith: 'user.' } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : Promise.resolve([]),
  ])

  const activeOwners = users.filter(
    (u) => u.isActive && u.roles.some((r) => r.role.name === 'OWNER'),
  ).length

  const rolePermissions = Object.fromEntries(
    roles.map((role) => [role.name, role.permissions.map((p) => p.permission)]),
  ) as Record<string, string[]>

  return (
    <>
      <PageHeader
        title="Users & Permissions"
        description="Who can sign in, what role they hold and exactly what each role may see."
        meta={
          <p className="text-[12.5px] text-ink-600">
            {users.filter((u) => u.isActive).length} active of {users.length} accounts &middot; {activeOwners}{' '}
            {activeOwners === 1 ? 'owner' : 'owners'}
          </p>
        }
        primaryAction={<CreateUserDialog divisions={divisions} salesReps={salesReps} />}
      />

      <Alert tone="info" title="Permissions are enforced on the server" className="mb-5">
        Hiding a navigation item is presentation only. Every page and every API route re-checks the signed-in
        user&apos;s permission before returning data, and two restrictions are additionally enforced in code and
        cannot be granted here: a sales representative never receives gross margin, and never sees another
        representative&apos;s records.
      </Alert>

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">People ({users.length})</TabsTrigger>
          <TabsTrigger value="roles">Roles &amp; permissions</TabsTrigger>
          {admin.permissions.has(PERMISSIONS.AUDIT_VIEW) ? <TabsTrigger value="audit">Recent changes</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="people">
          <Card>
            {users.length === 0 ? (
              <EmptyState
                icon={UsersIcon}
                title="No user accounts exist yet"
                description="Run npm run db:seed to create the first owner account, or add a user above."
              />
            ) : (
              <UserTable
                currentUserId={admin.id}
                users={users.map((user) => ({
                  id: user.id,
                  name: user.name,
                  email: user.email,
                  isActive: user.isActive,
                  mustChangePassword: user.mustChangePassword,
                  lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
                  lockedUntil: user.lockedUntil ? user.lockedUntil.toISOString() : null,
                  roles: user.roles.map((r) => r.role.name),
                  divisionNames: user.divisionAccess.map((d) => d.division.name),
                  salesRepName: user.salesRep?.name ?? null,
                  activeSessions: user.sessions.length,
                }))}
              />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="roles">
          <div className="mb-4">
            <SectionHeading
              title="Permissions matrix"
              description="PENDING CLIENT CONFIRMATION — this is the proposed starting point from the Phase 1 scope. Adjust it here and confirm with Ali before go-live."
            />
          </div>

          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[]).map((roleName) => (
              <Card key={roleName}>
                <CardHeader>
                  <div>
                    <CardTitle>{ROLE_LABELS[roleName]}</CardTitle>
                  </div>
                  <Badge variant="neutral" size="sm">
                    {users.filter((u) => u.roles.some((r) => r.role.name === roleName)).length} users
                  </Badge>
                </CardHeader>
                <CardContent>
                  <p className="text-[12.5px] leading-5 text-ink-600">{ROLE_DESCRIPTIONS[roleName]}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <PermissionsMatrix
            permissions={ALL_PERMISSIONS.map((permission) => ({
              key: permission,
              label: PERMISSION_LABELS[permission],
            }))}
            roles={(Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[]).map((roleName) => ({
              name: roleName,
              label: ROLE_LABELS[roleName],
              granted: rolePermissions[roleName] ?? DEFAULT_ROLE_PERMISSIONS[roleName],
            }))}
          />
        </TabsContent>

        {admin.permissions.has(PERMISSIONS.AUDIT_VIEW) ? (
          <TabsContent value="audit">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Recent account changes</CardTitle>
                  <CardDescription>
                    Every user and permission change is recorded. The full audit log covers every action in the
                    system.
                  </CardDescription>
                </div>
              </CardHeader>
              {auditEntries.length === 0 ? (
                <EmptyState
                  title="No account changes recorded yet"
                  description="Creating a user, changing roles or resetting a password will appear here."
                />
              ) : (
                <ul className="divide-y divide-ink-200">
                  {auditEntries.map((entry) => (
                    <li key={entry.id} className="px-4 py-3 sm:px-5">
                      <p className="text-[13px] text-ink-800">{entry.summary}</p>
                      <p className="mt-0.5 text-[11.5px] text-ink-500">
                        {formatDateTime(entry.createdAt)} &middot; {formatRelativeTime(entry.createdAt, now)}
                        {entry.actorEmail ? ` · ${entry.actorEmail}` : ''}
                        {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  )
}

export const dynamic = 'force-dynamic'
