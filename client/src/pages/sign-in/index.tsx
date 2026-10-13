import { Navigate } from 'react-router'
import { Gauge } from 'lucide-react'
import { useDocumentTitle, useSearchParams } from '@/lib/navigation'
import { useSessionInfo } from '@/lib/session'
import { SignInForm } from './sign-in-form'

export default function SignInPage() {
  useDocumentTitle('Sign in')
  const params = useSearchParams()
  const { data: session, isPending } = useSessionInfo()

  // The old page resolved the session on the server before rendering; show the
  // bare background until GET /api/auth/session answers.
  if (isPending) return <div className="min-h-screen bg-ink-50" aria-busy="true" aria-label="Loading" />

  const user = session?.user ?? null
  if (user) return <Navigate to={safeNext(params.get('next')) ?? user.landingPage} replace />

  // If the session endpoint itself failed, the database/server is unreachable.
  const dbReady = session?.databaseReady ?? false
  const demoAvailable = session?.demoAvailable ?? false

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[26rem]">
          <div className="mb-7 flex flex-col items-center text-center">
            <span className="mb-3.5 flex size-11 items-center justify-center rounded-xl bg-brand-600 text-white">
              <Gauge className="size-6" aria-hidden />
            </span>
            <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-ink-900">MetroLED Intelligence</h1>
            <p className="mt-1.5 text-[13.5px] leading-5 text-ink-600">
              Sign in to see how the business is performing.
            </p>
          </div>

          <SignInForm
            nextPath={safeNext(params.get('next')) ?? null}
            databaseReady={dbReady}
            demoAvailable={demoAvailable}
            environment={session?.environment ?? 'development'}
          />

          <p className="mt-6 text-center text-[12px] leading-5 text-ink-500">
            Access is granted by an account owner. If you cannot sign in, contact your MetroLED administrator.
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Only same-site relative paths are accepted as a post-sign-in destination, so
 * a crafted `?next=` cannot be used to bounce a user to another host.
 */
function safeNext(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  return value
}
