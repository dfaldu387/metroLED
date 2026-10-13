import { chromium, devices } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3100'
const browser = await chromium.launch()

async function tryFilter(ctxOpts, path, label, optionName, expect) {
  const ctx = await browser.newContext(ctxOpts)
  await ctx.request.post(`${base}/api/auth/demo`, { data: { role: 'OWNER' } })
  const page = await ctx.newPage()
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(250)
  let ok = false
  try {
    await page.getByRole('button', { name: label }).click()
    const item = page.getByRole('menuitem', { name: optionName })
    await item.waitFor({ state: 'visible', timeout: 5000 })
    await item.click()
    for (let j = 0; j < 25; j++) {
      if (page.url().includes(expect)) { ok = true; break }
      await page.waitForTimeout(100)
    }
  } catch (e) {
    console.log('   err:', String(e).split('\n')[0].slice(0, 110))
  }
  await ctx.close()
  return ok
}

const desktop = { viewport: { width: 1440, height: 900 } }
for (const path of ['/overview', '/revenue', '/accounts-receivable', '/sales-pipeline', '/ecommerce', '/gross-margin']) {
  let ok = 0
  for (let i = 0; i < 3; i++) {
    if (await tryFilter(desktop, path, 'Reporting period', 'Last 12 months', 'range=last_12_months')) ok++
  }
  console.log(`period  ${path.padEnd(24)} ${ok}/3`)
}

let ok = 0
for (let i = 0; i < 3; i++) {
  if (await tryFilter(desktop, '/overview', 'Division', 'Pixel LED Displays', 'division=')) ok++
}
console.log(`division /overview                ${ok}/3`)

ok = 0
for (let i = 0; i < 3; i++) {
  if (await tryFilter({ ...devices['Pixel 7'] }, '/overview', 'Reporting period', 'Last 12 months', 'range=last_12_months')) ok++
}
console.log(`period  /overview (Pixel 7 touch) ${ok}/3`)
await browser.close()
