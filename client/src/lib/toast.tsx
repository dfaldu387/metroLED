import { Toaster, toast } from 'sonner'
import { useTheme } from '@/lib/theme'

/**
 * Application toaster.
 *
 * One mount point for transient, self-dismissing notifications (sync finished,
 * a source connected, a setting saved). Steady-state messages — "database
 * unreachable", "not available to your role", stale-data notices — stay as
 * inline <Alert>s, because those must persist while the condition holds.
 *
 * The toaster follows the app's resolved light/dark theme so it matches the
 * surface it sits on.
 */
export function AppToaster() {
  const { resolved } = useTheme()
  return (
    <Toaster
      theme={resolved}
      position="top-right"
      richColors
      closeButton
      expand={false}
      duration={5000}
      toastOptions={{ className: 'text-[13px]' }}
    />
  )
}

/** The shape every server action returns ({ ok, message }). */
type ActionResultish = { ok: boolean; message?: string | null }

/**
 * Turn a server ActionResult into a toast: success or error with the server's
 * own message. Use this wherever a mutation previously rendered an inline
 * result <Alert>.
 */
export function notifyResult(
  result: ActionResultish,
  fallback?: { success?: string; error?: string },
): void {
  const message =
    (result.message && result.message.trim()) ||
    (result.ok ? fallback?.success ?? 'Done.' : fallback?.error ?? 'Something went wrong.')
  if (result.ok) toast.success(message)
  else toast.error(message)
}

/** Tone-named helpers mirroring the inline <Alert> vocabulary. */
export const notify = {
  success: (message: string, description?: string) => toast.success(message, { description }),
  error: (message: string, description?: string) => toast.error(message, { description }),
  info: (message: string, description?: string) => toast.info(message, { description }),
  warning: (message: string, description?: string) => toast.warning(message, { description }),
}

export { toast }
