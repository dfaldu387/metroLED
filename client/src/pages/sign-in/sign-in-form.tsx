import * as React from 'react'
import { useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FlaskConical, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/form'
import { Alert } from '@/components/ui/feedback'
import { Card, CardContent } from '@/components/ui/card'
import { api, ApiError } from '@/lib/api'
import { resetSession } from '@/lib/session'

const schema = z.object({
  email: z.string().min(1, 'Enter your email address.').email('That does not look like an email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

type FormValues = z.infer<typeof schema>

const DEMO_ROLES = [
  { value: 'OWNER', label: 'Owner (Ali) — full access' },
  { value: 'FINANCE', label: 'Finance (Farida) — revenue, A/R, margin' },
  { value: 'ECOMMERCE', label: 'E-commerce (Sabir) — Eco LED Mart only' },
  { value: 'SALES_REP', label: 'Sales rep — own data, no margin' },
  { value: 'OPERATIONS', label: 'Operations — integration health' },
]

export function SignInForm({
  nextPath,
  databaseReady,
  demoAvailable,
  environment,
}: {
  nextPath: string | null
  databaseReady: boolean
  demoAvailable: boolean
  environment: string
}) {
  const navigate = useNavigate()
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [demoRole, setDemoRole] = React.useState('OWNER')
  const [demoBusy, setDemoBusy] = React.useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })

  const onSubmit = async (values: FormValues) => {
    setServerError(null)
    try {
      const payload = await postAuth<{ ok?: boolean; message?: string; redirectTo?: string }>('/api/auth/sign-in', values)
      if (!payload.ok) {
        setServerError(payload.message ?? 'Sign-in failed. Please try again.')
        return
      }
      await resetSession()
      navigate(nextPath ?? payload.redirectTo ?? '/overview')
    } catch {
      setServerError(
        'Could not reach the server. Check your connection and try again. If this continues, contact your administrator.',
      )
    }
  }

  const startDemo = async () => {
    setDemoBusy(true)
    setServerError(null)
    try {
      const payload = await postAuth<{ ok?: boolean; message?: string }>('/api/auth/demo', { role: demoRole })
      if (!payload.ok) {
        setServerError(payload.message ?? 'Could not start the demo session.')
        return
      }
      await resetSession()
      navigate('/overview')
    } catch {
      setServerError('Could not start the demo session. Check your connection and try again.')
    } finally {
      setDemoBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {!databaseReady ? (
        <Alert tone="warning" title="The reporting database is not connected">
          Account sign-in needs the database. Set <code className="font-mono text-[12px]">DATABASE_URL</code>, run{' '}
          <code className="font-mono text-[12px]">npm run db:deploy</code> and{' '}
          <code className="font-mono text-[12px]">npm run db:seed</code>.
          {demoAvailable ? ' In the meantime you can review the interface with demo data below.' : null}
        </Alert>
      ) : null}

      {serverError ? (
        <Alert tone="negative" title="Sign-in failed">
          {serverError}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="py-5">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <Field label="Email address" htmlFor="email" error={errors.email?.message ?? null} required>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                aria-invalid={Boolean(errors.email)}
                placeholder="you@metroled.com"
                {...register('email')}
              />
            </Field>

            <Field label="Password" htmlFor="password" error={errors.password?.message ?? null} required>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                {...register('password')}
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              loading={isSubmitting}
              disabled={!databaseReady}
            >
              <LogIn aria-hidden />
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>

      {demoAvailable ? (
        <Card className="border-warning-200 bg-warning-50/50">
          <CardContent className="py-4">
            <div className="flex items-start gap-2.5">
              <FlaskConical className="mt-0.5 size-[18px] shrink-0 text-warning-700" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-warning-900">Review the interface with demo data</p>
                <p className="mt-1 text-[12.5px] leading-5 text-warning-800">
                  Generated sample figures, clearly labelled on every screen. Nothing here reflects actual MetroLED
                  performance. Not available in production (this deployment is{' '}
                  <span className="font-medium">{environment}</span>).
                </p>

                <div className="mt-3 space-y-2">
                  <Select value={demoRole} onValueChange={setDemoRole}>
                    <SelectTrigger aria-label="Choose a role to preview">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEMO_ROLES.map((role) => (
                        <SelectItem key={role.value} value={role.value}>
                          {role.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="secondary" size="md" className="w-full" loading={demoBusy} onClick={startDemo}>
                    Continue with demo data
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

/**
 * POST to an auth endpoint. A non-2xx response with a JSON body (`{ ok: false,
 * message }`) is returned like a 2xx one, exactly as the old `fetch` +
 * `response.json()` code read it; a network failure or a non-JSON error throws,
 * so the caller shows its own "could not reach the server" copy.
 */
async function postAuth<T extends { ok?: boolean; message?: string }>(path: string, body: unknown): Promise<T> {
  try {
    return await api.post<T>(path, body)
  } catch (error) {
    if (error instanceof ApiError && error.status > 0 && Object.keys(error.body).length > 0) {
      return { ok: false, ...error.body } as unknown as T
    }
    throw error
  }
}
