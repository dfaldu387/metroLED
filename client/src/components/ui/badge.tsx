import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Badge.
 *
 * Colour carries meaning, never decoration:
 *   positive  a good outcome or a healthy connection
 *   negative  something urgent or failing
 *   warning   something that needs attention soon
 *   neutral   a plain label with no judgement attached
 *   demo      the labelled demo dataset
 */

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-medium leading-5 whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'border-ink-200 bg-ink-100 text-ink-700',
        outline: 'border-ink-300 bg-surface text-ink-700',
        brand: 'border-brand-200 bg-brand-50 text-brand-700',
        positive: 'border-positive-200 bg-positive-50 text-positive-800',
        negative: 'border-negative-200 bg-negative-50 text-negative-800',
        warning: 'border-warning-200 bg-warning-50 text-warning-800',
        demo: 'border-warning-300 bg-warning-100 text-warning-800',
      },
      size: {
        sm: 'px-1.5 py-0 text-[11px]',
        md: '',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
}

/** A coloured dot plus a label - used for connection and sync status. */
export function StatusDot({
  tone,
  className,
}: {
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  className?: string
}) {
  const colours: Record<string, string> = {
    positive: 'bg-positive-500',
    negative: 'bg-negative-500',
    warning: 'bg-warning-500',
    neutral: 'bg-ink-400',
  }
  return <span className={cn('size-2 shrink-0 rounded-full', colours[tone], className)} aria-hidden />
}

export { badgeVariants }
