import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Gauge } from 'lucide-react'
import { getSession } from '@/lib/auth/session'
import { databaseReachable } from '@/lib/db'
import { demoDataAllowed, env } from '@/lib/env'
import { defaultLandingPage } from '@/lib/navigation'
import { SignInForm } from './sign-in-form'

export const metadata: Metadata = {
  title: 'Sign in',
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  const user = await getSession()
  if (user) redirect(safeNext(params.next) ?? defaultLandingPage(user.permissions))

  const dbReady = await databaseReachable()
  const demoAvailable = demoDataAllowed()

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
            nextPath={safeNext(params.next) ?? null}
            databaseReady={dbReady}
            demoAvailable={demoAvailable}
            environment={env().APP_ENV}
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
function safeNext(value: string | undefined): string | null {
  if (!value) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  return value
}
