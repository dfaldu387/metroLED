import {
  BarChart3,
  Database,
  FileText,
  Gauge,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  Percent,
  Settings,
  ShoppingCart,
  Target,
  Users,
  Wallet,
} from 'lucide-react'
import { PERMISSIONS, type Permission } from './auth/permissions'

/**
 * Application navigation (section 4).
 *
 * Exactly the items the scope calls for - no extras. `permission` is used to
 * hide an item the signed-in role cannot use, but the page itself re-checks
 * server-side: hiding a link is presentation, not access control.
 */

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  permission: Permission
  /** Shown in the tooltip on the collapsed sidebar and as the page subtitle. */
  purpose: string
}

export interface NavSection {
  label: string
  items: NavItem[]
}

export const NAVIGATION: NavSection[] = [
  {
    label: 'Main',
    items: [
      {
        label: 'Overview',
        href: '/overview',
        icon: LayoutDashboard,
        permission: PERMISSIONS.OVERVIEW_VIEW,
        purpose: 'How the business is performing right now, and what needs attention.',
      },
      {
        label: 'Revenue',
        href: '/revenue',
        icon: BarChart3,
        permission: PERMISSIONS.REVENUE_VIEW,
        purpose: 'Invoiced sales over time, by division, customer and representative.',
      },
      {
        label: 'Accounts Receivable',
        href: '/accounts-receivable',
        icon: Wallet,
        permission: PERMISSIONS.RECEIVABLES_VIEW,
        purpose: 'What customers owe, how overdue it is, and which invoices to chase.',
      },
      {
        label: 'Sales Pipeline',
        href: '/sales-pipeline',
        icon: Target,
        permission: PERMISSIONS.PIPELINE_VIEW,
        purpose: 'Open quotes, their stage and value, and which ones have gone quiet.',
      },
      {
        label: 'E-commerce',
        href: '/ecommerce',
        icon: ShoppingCart,
        permission: PERMISSIONS.ECOMMERCE_VIEW,
        purpose: 'Eco LED Mart store performance: sales, orders and best sellers.',
      },
      {
        label: 'Gross Margin',
        href: '/gross-margin',
        icon: Percent,
        permission: PERMISSIONS.MARGIN_VIEW,
        purpose: 'Revenue less direct cost, by division, using the approved cost basis.',
      },
    ],
  },
  {
    label: 'Workspace',
    items: [
      {
        label: 'Ask MetroLED',
        href: '/ask',
        icon: MessageSquare,
        permission: PERMISSIONS.AI_USE,
        purpose: 'Ask a question about company data in plain English and see where the answer came from.',
      },
      {
        label: 'Daily Brief',
        href: '/daily-brief',
        icon: FileText,
        permission: PERMISSIONS.BRIEF_VIEW,
        purpose: 'Yesterday in one page: revenue, new overdue invoices, stale quotes and sync health.',
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        label: 'Data Health',
        href: '/data-health',
        icon: Database,
        permission: PERMISSIONS.DATA_HEALTH_VIEW,
        purpose: 'Connection status, synchronisation history and records needing review.',
      },
      {
        label: 'Users & Permissions',
        href: '/users',
        icon: Users,
        permission: PERMISSIONS.USERS_MANAGE,
        purpose: 'Who can sign in, what role they hold and what each role may see.',
      },
      {
        label: 'Settings',
        href: '/settings',
        icon: Settings,
        permission: PERMISSIONS.SETTINGS_VIEW,
        purpose: 'Company details, divisions, metric definitions and the Daily Brief schedule.',
      },
    ],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = NAVIGATION.flatMap((s) => s.items)

/** The first page a given set of permissions can actually open. */
export function defaultLandingPage(permissions: Set<Permission>): string {
  for (const item of ALL_NAV_ITEMS) {
    if (permissions.has(item.permission)) return item.href
  }
  return '/no-access'
}

export function findNavItem(pathname: string): NavItem | undefined {
  // Longest match wins, so /settings/divisions resolves to Settings.
  return [...ALL_NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
}

export const BRAND_ICON = Gauge
