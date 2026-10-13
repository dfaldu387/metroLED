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
import type { NavIconName } from '@shared/navigation'

/** Maps the icon names in shared/navigation to Lucide components. */
export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  LayoutDashboard,
  BarChart3,
  Wallet,
  Target,
  ShoppingCart,
  Percent,
  MessageSquare,
  FileText,
  Database,
  Users,
  Settings,
}

export const BRAND_ICON = Gauge
