import { AlertTriangle, ArrowRight, CircleAlert, Info } from 'lucide-react'
import { Link } from '@/lib/navigation'
import type { AttentionItem } from '@shared/types'

/**
 * "Attention required" list (section 5).
 *
 * Each row names the problem, quantifies it, and offers one obvious next
 * action with a descriptive label - "Review overdue invoices", not "View".
 */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  const icons = {
    urgent: CircleAlert,
    warning: AlertTriangle,
    info: Info,
  } as const

  const tones = {
    urgent: 'text-negative-600',
    warning: 'text-warning-600',
    info: 'text-ink-400',
  } as const

  return (
    <ul className="divide-y divide-ink-200">
      {items.map((item) => {
        const Icon = icons[item.severity]
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-ink-50 sm:px-5"
            >
              <Icon className={`mt-0.5 size-[18px] shrink-0 ${tones[item.severity]}`} aria-hidden />

              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium leading-5 text-ink-900">{item.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-5 text-ink-600">{item.detail}</p>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                {item.amountLabel ? (
                  <span
                    className={`tabular text-[14px] font-semibold ${
                      item.severity === 'urgent' ? 'text-negative-700' : 'text-ink-900'
                    }`}
                  >
                    {item.amountLabel}
                  </span>
                ) : null}
                <span className="flex items-center gap-1 whitespace-nowrap text-[12px] font-medium text-brand-600 group-hover:underline">
                  {item.actionLabel}
                  <ArrowRight className="size-3" aria-hidden />
                </span>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
