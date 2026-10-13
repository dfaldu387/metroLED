import { ChevronDown, LogOut, Monitor, Moon, Sun, UserCog } from 'lucide-react'
import { findNavItem } from '@shared/navigation'
import { Link, usePathname } from '@/lib/navigation'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/misc'
import { Badge } from '@/components/ui/badge'
import { NotificationsMenu } from './notifications'

/**
 * Desktop top bar.
 *
 * Left: where you are (the current section and what it is for). Right: the
 * three things a user reaches for from any page - notifications, the theme,
 * and their account. On mobile the same controls sit in the existing top bar
 * beside the navigation trigger (see sidebar.tsx), so there is one bar, not two.
 */

export interface TopBarUser {
  id: string
  name: string
  email: string
  roleLabel: string
  isDemo: boolean
}

export function TopBar({ user }: { user: TopBarUser }) {
  const pathname = usePathname()
  const item = findNavItem(pathname) ?? (pathname.startsWith('/account') ? { label: 'Your account' } : null)

  return (
    <header className="sticky top-0 z-30 hidden h-14 items-center justify-between gap-4 border-b border-ink-200 bg-surface/90 px-6 backdrop-blur lg:flex lg:px-8 print-hidden">
      <p className="min-w-0 truncate text-sm font-semibold text-ink-900">{item?.label ?? 'MetroLED Intelligence'}</p>

      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <NotificationsMenu userId={user.id} />
        <span className="mx-1.5 h-6 w-px bg-ink-200" aria-hidden />
        <TopBarAccountMenu user={user} />
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun; hint: string }[] = [
  { value: 'light', label: 'Light', icon: Sun, hint: 'White surfaces on a soft neutral page.' },
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Easier on the eyes in a dim room.' },
  { value: 'system', label: 'System', icon: Monitor, hint: 'Follow the device setting.' },
]

export function ThemeToggle({ className }: { className?: string }) {
  const { preference, resolved, setPreference } = useTheme()
  const Icon = resolved === 'dark' ? Moon : Sun

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex size-9 items-center justify-center rounded-lg text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 data-[state=open]:bg-ink-100 data-[state=open]:text-ink-900',
          className,
        )}
        aria-label={`Appearance: ${preference === 'system' ? `system (${resolved})` : preference}. Change theme`}
      >
        <Icon className="size-[18px]" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        <DropdownMenuLabel>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Appearance</p>
        </DropdownMenuLabel>
        {THEME_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => setPreference(option.value)}
            className={cn('items-start', preference === option.value && 'bg-brand-50 text-brand-700 data-[highlighted]:bg-brand-50')}
            aria-checked={preference === option.value}
            role="menuitemradio"
          >
            <option.icon className="mt-0.5" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{option.label}</span>
              <span className="block text-[11.5px] leading-4 text-ink-500">{option.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

function TopBarAccountMenu({ user }: { user: TopBarUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 text-left transition-colors hover:bg-ink-100 data-[state=open]:bg-ink-100"
        aria-label="Account menu"
      >
        <Avatar name={user.name} size="sm" />
        <span className="hidden min-w-0 xl:block">
          <span className="block max-w-[10rem] truncate text-[13px] font-medium leading-tight text-ink-900">{user.name}</span>
          <span className="block truncate text-[11px] leading-tight text-ink-500">{user.roleLabel}</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-ink-400" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
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
    window.location.assign('/sign-in')
  }
}

