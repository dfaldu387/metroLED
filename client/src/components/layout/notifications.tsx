import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Bell, CheckCheck, CircleAlert, Info } from 'lucide-react'
import type { NotificationItem, NotificationsResponse } from '@shared/api/operations'
import { formatRelativeTime } from '@shared/dates'
import { api } from '@/lib/api'
import { Link } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/misc'
import { Badge } from '@/components/ui/badge'

/**
 * Notifications bell.
 *
 * Items come from GET /api/notifications, which derives them from the same
 * permission-scoped data the Overview shows. "Seen" is remembered per user in
 * this browser: an item stays in the list while its condition holds, but the
 * unread count only counts items this person has not opened the menu for.
 */

const SEEN_KEY = (userId: string) => `metroled-notifications-seen:${userId}`

function readSeen(userId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY(userId))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeSeen(userId: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(SEEN_KEY(userId), JSON.stringify([...ids]))
  } catch {
    // Storage unavailable: the badge simply resets on the next visit.
  }
}

export function useNotifications() {
  return useQuery<NotificationsResponse>({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsResponse>('/api/notifications'),
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    retry: 1,
  })
}

const ICONS = { urgent: CircleAlert, warning: AlertTriangle, info: Info } as const
const TONES = {
  urgent: 'bg-negative-50 text-negative-600',
  warning: 'bg-warning-50 text-warning-600',
  info: 'bg-brand-50 text-brand-600',
} as const

export function NotificationsMenu({ userId, className }: { userId: string; className?: string }) {
  const query = useNotifications()
  const items = React.useMemo(() => query.data?.items ?? [], [query.data])
  const [seen, setSeen] = React.useState<Set<string>>(() => readSeen(userId))
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => setSeen(readSeen(userId)), [userId])

  // Drop ids for conditions that no longer exist, so storage does not grow forever.
  React.useEffect(() => {
    if (!query.data) return
    const live = new Set(items.map((i) => i.id))
    const pruned = new Set([...seen].filter((id) => live.has(id)))
    if (pruned.size !== seen.size) {
      setSeen(pruned)
      writeSeen(userId, pruned)
    }
  }, [items, query.data, seen, userId])

  const unread = items.filter((i) => !seen.has(i.id))
  const urgentUnread = unread.some((i) => i.severity === 'urgent')

  const markAllRead = () => {
    const next = new Set(items.map((i) => i.id))
    setSeen(next)
    writeSeen(userId, next)
  }

  const markRead = (id: string) => {
    const next = new Set(seen)
    next.add(id)
    setSeen(next)
    writeSeen(userId, next)
  }

  const now = query.data ? new Date(query.data.now) : new Date()

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void query.refetch()
      }}
    >
      <DropdownMenuTrigger
        className={cn(
          'relative flex size-9 items-center justify-center rounded-lg text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 data-[state=open]:bg-ink-100 data-[state=open]:text-ink-900',
          className,
        )}
        aria-label={
          unread.length === 0
            ? 'Notifications'
            : `Notifications: ${unread.length} unread${urgentUnread ? ', including urgent items' : ''}`
        }
      >
        <Bell className="size-[18px]" aria-hidden />
        {unread.length > 0 ? (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold leading-none text-white ring-2 ring-surface',
              urgentUnread ? 'bg-negative-600' : 'bg-brand-600',
            )}
            aria-hidden
          >
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-[min(26rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3">
          <div>
            <p className="text-[13.5px] font-semibold text-ink-900">Notifications</p>
            <p className="text-[12px] text-ink-500">
              {items.length === 0
                ? 'Nothing needs your attention.'
                : `${items.length} ${items.length === 1 ? 'item' : 'items'}${unread.length > 0 ? `, ${unread.length} new` : ''}`}
              {query.data?.mode === 'demo' ? ' · Demo data' : ''}
            </p>
          </div>
          {unread.length > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-brand-600 transition-colors hover:bg-brand-50"
            >
              <CheckCheck className="size-3.5" aria-hidden />
              Mark all as read
            </button>
          ) : null}
        </div>

        <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
          {query.isPending ? (
            <p className="px-4 py-8 text-center text-[13px] text-ink-500">Checking…</p>
          ) : query.isError ? (
            <p className="px-4 py-8 text-center text-[13px] text-ink-500">
              Notifications could not be loaded. They will be retried shortly.
            </p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-positive-50">
                <CheckCheck className="size-4.5 text-positive-700" aria-hidden />
              </span>
              <p className="text-[13.5px] font-medium text-ink-900">You are all caught up</p>
              <p className="mt-1 max-w-xs text-[12.5px] leading-5 text-ink-500">
                Overdue invoices, quiet quotes, sync problems and new briefs appear here when they happen.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-200 p-1">
              {items.map((item) => (
                <li key={item.id}>
                  <NotificationRow item={item} unread={!seen.has(item.id)} now={now} onOpen={() => markRead(item.id)} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-ink-200 px-4 py-2.5 text-[11.5px] text-ink-500">
          Built from the data your role can see. Items clear themselves once resolved.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NotificationRow({
  item,
  unread,
  now,
  onOpen,
}: {
  item: NotificationItem
  unread: boolean
  now: Date
  onOpen: () => void
}) {
  const Icon = ICONS[item.severity]
  return (
    <DropdownMenuItem asChild onSelect={onOpen} className="items-start rounded-lg px-3 py-2.5">
      <Link href={item.href} className="group">
        <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', TONES[item.severity])}>
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className={cn('text-[13px] leading-5 text-ink-900', unread ? 'font-semibold' : 'font-medium')}>
              {item.title}
            </span>
            {unread ? <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-600" aria-label="Unread" /> : null}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-[18px] text-ink-600">{item.detail}</span>
          <span className="mt-1.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[12px] font-medium text-brand-600 group-hover:underline">
              {item.actionLabel}
              <ArrowRight className="size-3" aria-hidden />
            </span>
            {item.amountLabel ? (
              <Badge variant={item.severity === 'urgent' ? 'negative' : 'neutral'} size="sm" className="tabular">
                {item.amountLabel}
              </Badge>
            ) : item.at ? (
              <span className="text-[11.5px] text-ink-500">{formatRelativeTime(new Date(item.at), now)}</span>
            ) : null}
          </span>
        </span>
      </Link>
    </DropdownMenuItem>
  )
}
