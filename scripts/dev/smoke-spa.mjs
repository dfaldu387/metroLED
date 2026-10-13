// Headless smoke test of the React client: signs in through the UI, opens every
// page, and reports HTTP failures, console errors and render errors.
//
//   BASE_URL=http://localhost:4300 SEED_OWNER_EMAIL=... SEED_OWNER_PASSWORD=... node scripts/dev/smoke-spa.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const PAGES = [
  '/overview', '/revenue', '/accounts-receivable', '/sales-pipeline', '/ecommerce', '/gross-margin',
  '/ask', '/daily-brief', '/data-health', '/users', '/account',
  '/settings', '/settings/brief', '/settings/divisions', '/settings/integrations', '/settings/metrics',
  '/revenue?range=last_12_months', '/no-such-page',
]

const browser = await chromium.launch()
const page = await browser.newPage()
const problems = []
page.on('console', (m) => m.type() === 'error' && problems.push(`[console] ${page.url()} ${m.text()}`))
page.on('pageerror', (e) => problems.push(`[pageerror] ${page.url()} ${e.message}`))
page.on('response', (r) => r.status() >= 500 && problems.push(`[http ${r.status()}] ${r.url()}`))

await page.goto(`${BASE}/overview`)
await page.waitForURL(/\/sign-in/)
await page.getByLabel(/email/i).fill(process.env.SEED_OWNER_EMAIL)
await page.getByLabel(/password/i).first().fill(process.env.SEED_OWNER_PASSWORD)
await page.getByRole('button', { name: /sign in/i }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 15000 })
console.log('signed in ->', new URL(page.url()).pathname)

for (const path of PAGES) {
  await page.goto(`${BASE}${path}`)
  await page.waitForLoadState('networkidle')
  const h1 = (await page.locator('h1').first().textContent({ timeout: 5000 }).catch(() => null))?.trim()
  const errorCard = await page.getByText('This page could not be loaded').count()
  console.log(`${path.padEnd(32)} title="${await page.title()}" h1="${h1 ?? '-'}"${errorCard ? '  <-- ERROR CARD' : ''}`)
  if (path === '/overview') await page.screenshot({ path: process.env.SCREENSHOT ?? 'overview.png', fullPage: true })
}

await browser.close()
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.join('\n')}` : '\nno console/page/5xx errors')
process.exitCode = problems.length ? 1 : 0
