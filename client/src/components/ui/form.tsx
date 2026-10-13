
import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Form controls.
 *
 * Every field has a visible label (never placeholder-only), optional help text
 * that explains what the field is for, and an error message that says what to
 * do rather than just "invalid".
 */

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(function Label({ className, required, children, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn('block text-[13px] font-medium text-ink-800', className)}
      {...props}
    >
      {children}
      {required ? (
        <span className="ml-0.5 text-negative-600" aria-hidden>
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  )
})

export const inputClasses =
  'block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 shadow-card transition-colors placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-500 aria-[invalid=true]:border-negative-500 aria-[invalid=true]:ring-negative-500/20'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputClasses, 'h-9', className)} {...props} />
  },
)

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(inputClasses, 'min-h-20 resize-y', className)} {...props} />
})

/** A labelled field wrapper: label, control, help text and error in one place. */
export function Field({
  label,
  htmlFor,
  help,
  error,
  required,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  help?: React.ReactNode
  error?: string | null
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  const helpId = htmlFor ? `${htmlFor}-help` : undefined
  const errorId = htmlFor ? `${htmlFor}-error` : undefined
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {help && !error ? (
        <p id={helpId} className="text-[12.5px] leading-5 text-ink-500">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-[12.5px] leading-5 text-negative-700">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export const Select = SelectPrimitive.Root
export const SelectValue = SelectPrimitive.Value
export const SelectGroup = SelectPrimitive.Group

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 shadow-card transition-colors hover:border-ink-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:cursor-not-allowed disabled:bg-ink-100 [&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-ink-500" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
})

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = 'popper', ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={4}
        collisionPadding={8}
        className={cn(
          'relative z-50 max-h-72 min-w-[10rem] overflow-y-auto rounded-lg border border-ink-200 bg-white p-1 shadow-overlay',
          position === 'popper' && 'w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
})

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-2.5 pr-8 text-sm text-ink-800 outline-none data-[highlighted]:bg-ink-100 data-[state=checked]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5">
        <Check className="size-4 text-brand-600" aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
})

export const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn('px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500', className)}
      {...props}
    />
  )
})
