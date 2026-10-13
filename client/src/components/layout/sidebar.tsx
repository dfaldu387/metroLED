import * as React from 'react'
import { Link, useLinkStatus } from '@/lib/navigation'
import { usePathname } from '@/lib/navigation'
import { ChevronDown, Loader2, LogOut, Menu, UserCog, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NAVIGATION, type NavItem } from '@shared/navigation'
import { api } from '@/lib/api'
import { BRAND_ICON, NAV_ICONS } from './nav-icons'
import { Avatar, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/misc'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { NotificationsMenu } from './notifications'
import { ThemeToggle } from './top-bar'

/**
 * Navigation shell.
 *
 * Desktop: a compact fixed left sidebar with the brand at the top and the
 * signed-in user at the bottom.
 * Mobile:  a hamburger opens the same navigation as a slide-in drawer, and the
 * account menu moves into the drawer footer.
 *
 * The active page is marked with both a background change and a left accent
 * bar, plus `aria-current="page"` so it is obvious and announced.
 */

export interface SidebarUser {
  id: string
  name: string
  email: string
  roleLabel: string
  isDemo: boolean
}

interface SidebarProps {
  user: SidebarUser
  /** Nav items the signed-in role is allowed to open. */
  allowedHrefs: string[]
}

function useVisibleSections(allowedHrefs: string[]) {
  return React.useMemo(() => {
    const allowed = new Set(allowedHrefs)
    return NAVIGATION.map((section) => ({
      ...section,
      items: section.items.filter((item) => allowed.has(item.href)),
    })).filter((section) => section.items.length > 0)
  }, [allowedHrefs])
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The icon slot inside a nav link.
 *
 * Every page here is server-rendered, so following a link is a round trip.
 * `useLinkStatus` reports that this particular link is pending, which lets the
 * item the user actually clicked show a spinner immediately. Without it the
 * click has no visible effect until the next page is ready, and the
 * application feels unresponsive even when it is working normally.
 *
 * It must be a child of the Link to read that status.
 */
function NavLinkIcon({ item, active }: { item: NavItem; active: boolean }) {
  const { pending } = useLinkStatus()

  const Icon = NAV_ICONS[item.icon]

  if (pending) {
    return <Loader2 className="size-[17px] shrink-0 animate-spin text-brand-600" aria-hidden />
  }

  return (
    <Icon
      className={cn('size-[17px] shrink-0', active ? 'text-brand-600' : 'text-ink-500 group-hover:text-ink-700')}
      aria-hidden
    />
  )
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  onNavigate?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
            active ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
          )}
        >
          {active ? (
            <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand-600" aria-hidden />
          ) : null}
          <NavLinkIcon item={item} active={active} />
          <span className="truncate">{item.label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[240px]">
        {item.purpose}
      </TooltipContent>
    </Tooltip>
  )
}

function Brand() {
  return (
    <Link href="/overview" className="flex items-center gap-2.5 rounded-lg px-1 py-1">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
        <BRAND_ICON className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold leading-tight text-ink-900">MetroLED</span>
        <span className="block truncate text-[11.5px] leading-tight text-ink-500">Intelligence</span>
      </span>
    </Link>
  )
}

function AccountMenu({ user, align = 'start' }: { user: SidebarUser; align?: 'start' | 'end' }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-ink-100"
        aria-label="Account menu"
      >
        <Avatar name={user.name} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight text-ink-900">{user.name}</span>
          <span className="block truncate text-[11.5px] leading-tight text-ink-500">{user.roleLabel}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-ink-400" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side="top" className="w-60">
        <DropdownMenuLabel>
          <p className="truncate text-[13px] font-medium text-ink-900">{user.name}</p>
          <p className="truncate text-[12px] text-ink-500">{user.email}</p>
          <p className="mt-1.5">
            <Badge variant={user.isDemo ? 'demo' : 'brand'} size="sm">
              {user.isDemo ? 'Demo session' : user.roleLabel}
            </Badge>
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserCog aria-hidden />
            Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* A sign-out is a state change, so it is a POST, not a link. */}
        <DropdownMenuItem tone="danger" onSelect={() => void signOut()}>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

async function signOut() {
  try {
    await api.post('/api/auth/sign-out')
  } finally {
    // A full navigation drops every cached figure from memory.
    window.location.assign('/sign-in')
  }
}

export function Sidebar({ user, allowedHrefs }: SidebarProps) {
  const pathname = usePathname()
  const sections = useVisibleSections(allowedHrefs)

  return (
    /*
      Pinned to the viewport so the navigation and the account menu stay
      reachable however far the page scrolls - the A/R and pipeline tables run
      well past one screen.

      `h-screen` (rather than the flex default of stretching to the full
      container height) is what gives the sticky element somewhere to stick:
      a box as tall as its container can never move relative to it. The nav
      list inside scrolls on its own if it ever outgrows the viewport, which
      keeps the brand pinned at the top and the account menu at the bottom.
    */
    <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:self-start lg:border-r lg:border-ink-200 lg:bg-surface">
      <div className="px-4 py-4">
        <Brand />
      </div>

      <nav className="flex-1 overflow-y-auto px-4 pb-4" aria-label="Main navigation">
        {sections.map((section) => (
          <div key={section.label} className="mb-5">
            <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-ink-200 p-2">
        <AccountMenu user={user} />
      </div>
    </aside>
  )
}

/** Mobile top bar with the drawer trigger. */
export function MobileNav({ user, allowedHrefs }: SidebarProps) {
  const pathname = usePathname()
  const sections = useVisibleSections(allowedHrefs)
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const closeButtonRef = React.useRef<HTMLButtonElement>(null)
  const wasOpen = React.useRef(false)

  // Close the drawer whenever the route changes.
  React.useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Prevent the page behind the drawer from scrolling, and let Escape close
  // it - a panel that traps the reader with no keyboard way out is a dead end.
  React.useEffect(() => {
    if (!open) return

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)

    // Move focus into the drawer so the next Tab lands on its first link
    // rather than back in the page behind it.
    closeButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Return focus to the trigger when the drawer closes, so keyboard users are
  // not dropped back at the top of the document.
  React.useEffect(() => {
    if (open) return
    if (wasOpen.current) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  React.useEffect(() => {
    wasOpen.current = open
  }, [open])

  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-ink-200 bg-surface px-3 lg:hidden print-hidden">
        <Brand />
        <div className="flex items-center gap-0.5">
          <ThemeToggle />
          <NotificationsMenu userId={user.id} />
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={open}
          aria-controls="mobile-navigation-drawer"
          className="flex size-9 items-center justify-center rounded-lg text-ink-700 transition-colors hover:bg-ink-100"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          {/*
            The backdrop is a plain div, not a button. The close control is the
            labelled X below; a second element with the same accessible name
            would put a full-screen invisible button in the accessibility tree
            and make "close" ambiguous to a screen reader.
          */}
          <div className="absolute inset-0 bg-ink-950/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            id="mobile-navigation-drawer"
            className="absolute inset-y-0 left-0 flex w-[min(19rem,88vw)] flex-col border-r border-ink-200 bg-surface shadow-overlay"
          >
            <div className="flex items-center justify-between px-4 py-4">
              <Brand />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="flex size-8 items-center justify-center rounded-lg text-ink-600 transition-colors hover:bg-ink-100"
              >
                <X className="size-4.5" aria-hidden />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-4 pb-4" aria-label="Main navigation">
              {sections.map((section) => (
                <div key={section.label} className="mb-5">
                  <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    {section.label}
                  </p>
                  <div className="space-y-0.5">
                    {section.items.map((item) => (
                      <NavLink
                        key={item.href}
                        item={item}
                        active={isActive(pathname, item.href)}
                        onNavigate={() => setOpen(false)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </nav>

            <div className="border-t border-ink-200 p-2">
              <AccountMenu user={user} align="start" />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
