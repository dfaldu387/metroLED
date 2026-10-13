import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Button.
 *
 * One clear primary action per page (`variant="primary"`). Everything else is
 * `secondary`, `ghost` or `link` so the page has a visual hierarchy rather
 * than a row of equally loud buttons.
 */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand-600 text-white shadow-raised hover:bg-brand-700 active:bg-brand-800',
        secondary:
          'border border-ink-300 bg-surface text-ink-800 shadow-card hover:bg-ink-50 active:bg-ink-100',
        ghost: 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
        danger: 'bg-negative-600 text-white shadow-raised hover:bg-negative-700 active:bg-negative-800',
        link: 'text-brand-600 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-[13px] [&_svg]:size-4',
        md: 'h-9 px-3.5 [&_svg]:size-4',
        lg: 'h-10 px-4 [&_svg]:size-[18px]',
        icon: 'size-9 [&_svg]:size-4',
        'icon-sm': 'size-8 [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Shows a spinner and blocks interaction. Keeps the label visible. */
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
})

export { buttonVariants }
