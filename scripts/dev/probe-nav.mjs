import { chromium } from '@playwright/test'

/**
 * Verifies that clicking a nav item gives immediate feedback: the route-level
 * loading skeleton appears, and the clicked item shows a pending spinner.
 */
const base = process.argv[2] ?? 'http://127.0.0.1:3100'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await ctx.request.post(`${base}/api/auth/demo`, { data: { role: 'OWNER' } })
const page = await ctx.newPage()

// Throttle the network so the loading state is observable, the way it would be
// on a slow connection or a cold server.
const cdp = await ctx.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 400,
  downloadThroughput: (1.5 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
})

await page.goto(`${base}/overview`, { waitUntil: 'networkidle' })

for (const label of ['Revenue', 'Accounts Receivable', 'Sales Pipeline']) {
  const link = page.locator('aside').getByRole('link', { name: label })
  await link.click({ noWaitAfter: true })

  // Did anything appear immediately?
  let sawSkeleton = false
  let sawSpinner = false
  for (let i = 0; i < 40; i++) {
    if (!sawSkeleton && (await page.locator('[aria-busy="true"]').count()) > 0) sawSkeleton = true
    if (!sawSpinner && (await page.locator('aside .animate-spin').count()) > 0) sawSpinner = true
    if (sawSkeleton && sawSpinner) break
    await page.waitForTimeout(25)
  }

  await page.waitForLoadState('networkidle')
  const heading = await page.getByRole('heading', { level: 1 }).first().textContent()
  console.log(
    `${label.padEnd(22)} skeleton: ${sawSkeleton ? 'YES' : 'no '}   nav spinner: ${sawSpinner ? 'YES' : 'no '}   landed on: ${heading?.trim()}`,
  )
}

await browser.close()
