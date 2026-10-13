import { chromium, devices } from '@playwright/test'
import fs from 'node:fs'

/**
 * Captures a screenshot of each page for visual review.
 *
 *   node scripts/dev/screenshots.mjs [baseUrl] [role]
 */
const base = process.argv[2] ?? 'http://127.0.0.1:3100'
const role = process.argv[3] ?? 'OWNER'
const outDir = 'scripts/dev/screens'
fs.mkdirSync(outDir, { recursive: true })

const PAGES = [
  ['overview', '/overview'],
  ['revenue', '/revenue?range=last_12_months'],
  ['accounts-receivable', '/accounts-receivable'],
  ['sales-pipeline', '/sales-pipeline'],
  ['ecommerce', '/ecommerce?range=last_30_days'],
  ['gross-margin', '/gross-margin'],
  ['ask', '/ask'],
  ['daily-brief', '/daily-brief'],
  ['data-health', '/data-health'],
  ['users', '/users'],
  ['settings', '/settings'],
  ['settings-metrics', '/settings/metrics'],
]

const browser = await chromium.launch()

// Desktop
const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
await desktop.request.post(`${base}/api/auth/demo`, { data: { role } })
const page = await desktop.newPage()
for (const [name, path] of PAGES) {
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${outDir}/desktop-${name}.png` })
  console.log('desktop', name)
}

// Sign-in (no session)
const anon = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const anonPage = await anon.newPage()
await anonPage.goto(`${base}/sign-in`, { waitUntil: 'networkidle' })
await anonPage.screenshot({ path: `${outDir}/desktop-sign-in.png` })
console.log('desktop sign-in')

// Mobile
const mobile = await browser.newContext({ ...devices['iPhone 13'] })
await mobile.request.post(`${base}/api/auth/demo`, { data: { role } })
const mPage = await mobile.newPage()
for (const [name, path] of [PAGES[0], PAGES[2], PAGES[6]]) {
  await mPage.goto(base + path, { waitUntil: 'networkidle' })
  await mPage.waitForTimeout(700)
  await mPage.screenshot({ path: `${outDir}/mobile-${name}.png` })
  console.log('mobile', name)
}

await browser.close()
console.log('\nSaved to', outDir)
