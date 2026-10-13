import { Users as UsersIcon } from 'lucide-react'
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ALL_PERMISSIONS, PERMISSION_LABELS } from '@shared/permissions'
import { formatDateTime } from '@shared/format'
import { formatRelativeTime } from '@shared/dates'
import type { UsersPageData } from '@shared/api/admin'
import { useDocumentTitle } from '@/lib/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { PageHeader, SectionHeading } from '@/components/layout/page-header'
import { PageQuery } from '@/components/layout/page-error'
import { TablePageSkeleton } from '@/components/layout/page-skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { UserTable } from './user-table'
import { CreateUserDialog } from './create-user-dialog'
import { PermissionsMatrix } from './permissions-matrix'
import { ADMIN_KEYS, useAdminPage } from './admin-client'

/**
 * Users & Permissions (section 16).
 *
 * Shows who can sign in, what role they hold, and exactly what each role may
 * see. The permissions matrix is editable so the client can confirm it without
 * a code deploy, and every change is written to the audit log.
 */
export default function UsersPage() {
  useDocumentTitle('Users & Permissions')
  const query = useAdminPage<UsersPageData>(ADMIN_KEYS.users, '/api/users/page')

  return (
    <PageQuery query={query} skeleton={<TablePageSkeleton filters={0} />}>
      {(data) => <UsersView data={data} />}
    </PageQuery>
  )
}

function UsersView({ data }: { data: UsersPageData }) {
  const now = new Date()

  if (!data.dbReady) {
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

  const { users, divisions, salesReps, auditEntries, rolePermissions, canViewAudit } = data

  const activeOwners = users.filter((u) => u.isActive && u.roles.includes('OWNER')).length

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
          {canViewAudit ? <TabsTrigger value="audit">Recent changes</TabsTrigger> : null}
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
              <UserTable currentUserId={data.currentUserId} users={users} />
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
                    {users.filter((u) => u.roles.includes(roleName)).length} users
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
              granted: rolePermissions[roleName],
            }))}
          />
        </TabsContent>

        {canViewAudit ? (
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
                        {formatDateTime(entry.createdAt)} &middot;{' '}
                        {formatRelativeTime(new Date(entry.createdAt), now)}
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
