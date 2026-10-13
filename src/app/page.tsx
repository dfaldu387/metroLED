import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { defaultLandingPage } from '@/lib/navigation'

/** The root path always resolves to a real destination, never a blank page. */
export default async function RootPage() {
  const user = await getSession()
  if (!user) redirect('/sign-in')
  redirect(defaultLandingPage(user.permissions))
}
