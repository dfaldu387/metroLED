import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createDemoSession, DEMO_PERSONAS } from '@/lib/auth/session'
import { demoDataAllowed } from '@/lib/env'

/**
 * Start a labelled demo session.
 *
 * Refused outright when demo data is not allowed (always the case in
 * production), so there is no code path that creates a demo identity on a
 * production deployment.
 */
const bodySchema = z.object({
  role: z.enum(['OWNER', 'FINANCE', 'ECOMMERCE', 'SALES_REP', 'OPERATIONS']),
})

export async function POST(request: Request) {
  if (!demoDataAllowed()) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Demo sign-in is disabled on this deployment. Sign in with your account credentials.',
      },
      { status: 403 },
    )
  }

  let role: (typeof DEMO_PERSONAS)[number]['role']
  try {
    role = bodySchema.parse(await request.json()).role
  } catch {
    return NextResponse.json({ ok: false, message: 'Choose a role to preview.' }, { status: 400 })
  }

  await createDemoSession(role)
  return NextResponse.json({ ok: true, redirectTo: '/overview' })
}
