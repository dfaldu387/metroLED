
import { Link, usePathname } from '@/lib/navigation'
import { Building2, Calculator, Mail, Plug, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { href: '/settings', label: 'Company', icon: Settings2, exact: true, purpose: 'Name, timezone, currency and thresholds.' },
  { href: '/settings/divisions', label: 'Divisions & mappings', icon: Building2, purpose: 'How records are assigned to a division.' },
  { href: '/settings/metrics', label: 'Metric definitions', icon: Calculator, purpose: 'Formulas, cost mappings and approvals.' },
  { href: '/settings/brief', label: 'Daily Brief', icon: Mail, purpose: 'Schedule and recipients.' },
  { href: '/settings/integrations', label: 'Integrations', icon: Plug, purpose: 'Connection status and credentials.' },
]

export function SettingsNav({ canApproveMetrics }: { canApproveMetrics: boolean }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Settings sections" className="lg:w-60 lg:shrink-0">
      <ul className="no-scrollbar flex gap-1 overflow-x-auto border-b border-ink-200 pb-2 lg:flex-col lg:border-b-0 lg:pb-0">
        {SECTIONS.map((section) => {
          const active = section.exact ? pathname === section.href : pathname.startsWith(section.href)
          return (
            <li key={section.href} className="shrink-0 lg:shrink">
              <Link
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors lg:whitespace-normal',
                  active ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
                )}
              >
                <section.icon
                  className={cn('size-4 shrink-0', active ? 'text-brand-600' : 'text-ink-500')}
                  aria-hidden
                />
                <span>
                  {section.label}
                  {section.href === '/settings/metrics' && canApproveMetrics ? (
                    <span className="ml-1.5 hidden rounded bg-warning-100 px-1 py-0.5 text-[10px] font-semibold text-warning-800 lg:inline">
                      approvals
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
