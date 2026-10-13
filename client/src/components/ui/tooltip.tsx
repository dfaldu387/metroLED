
import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Tooltip.
 *
 * Required on every metric definition and every icon-only control, so no
 * number and no button is unexplained. Tooltips are keyboard-reachable: the
 * trigger is a real button.
 */

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          'z-50 max-w-xs whitespace-pre-line rounded-lg bg-ink-900 px-3 py-2 text-[12.5px] leading-5 text-white shadow-overlay',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
})

/**
 * The standard "what does this number mean?" affordance.
 * Renders a small info button with an accessible label.
 */
export function InfoTip({
  label,
  content,
  className,
}: {
  /** Accessible name, e.g. "About Total Revenue". */
  label: string
  content: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600',
            className,
          )}
        >
          <Info className="size-[14px]" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  )
}
