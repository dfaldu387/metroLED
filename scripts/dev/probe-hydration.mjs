import { chromium } from '@playwright/test'

/**
 * Reproduces the React hydration mismatch and prints the exact diff React
 * reports, plus the server HTML and the post-hydration DOM for the element it
 * complains about.
 *
 *   npx tsx/node scripts/dev/probe-hydration.mjs [baseUrl] [path]
 */
const base = process.argv[2] ?? 'http://localhost:3000'
const target = process.argv[3] ?? '/overview'

const email = process.env.PROBE_EMAIL ?? 'ali@metroled.example'
const password = process.env.PROBE_PASSWORD ?? 'ChangeMeOnFirstLogin!'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: process.env.PROBE_LOCALE || undefined,
  timezoneId: process.env.PROBE_TZ || undefined,
})
if (process.env.PROBE_LOCALE || process.env.PROBE_TZ) {
  console.log(`context locale=${process.env.PROBE_LOCALE ?? '(default)'} tz=${process.env.PROBE_TZ ?? '(default)'}`)
}

// Sign in over the API so the probe does not depend on the form markup.
const res = await ctx.request.post(`${base}/api/auth/sign-in`, { data: { email, password } })
console.log(`sign-in: HTTP ${res.status()} ${JSON.stringify(await res.json())}\n`)

const page = await ctx.newPage()

const messages = []
page.on('console', (m) => messages.push({ type: m.type(), text: m.text() }))
page.on('pageerror', (e) => messages.push({ type: 'pageerror', text: e.message }))

await page.goto(`${base}${target}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const hydration = messages.filter((m) =>
  /hydrat|did not match|didn't match|server rendered|Warning: Text content|Prop `/i.test(m.text),
)

console.log(`=== console messages: ${messages.length} total, ${hydration.length} hydration-related ===\n`)
for (const m of hydration) {
  console.log(`--- [${m.type}] ---`)
  console.log(m.text.slice(0, 4000))
  console.log()
}

if (hydration.length === 0) {
  console.log('No hydration warnings captured. Other console output:')
  for (const m of messages.slice(0, 20)) console.log(`  [${m.type}] ${m.text.slice(0, 200)}`)
}

// Compare the raw server HTML with the hydrated DOM for the sidebar element
// the overlay pointed at.
const serverHtml = await (await ctx.request.get(`${base}${target}`)).text()
const serverAside = serverHtml.match(/<aside class="([^"]*)"/)?.[1] ?? '(no <aside> in server HTML)'
const clientAside = await page
  .locator('aside')
  .first()
  .getAttribute('class')
  .catch(() => '(no <aside> in DOM)')

console.log('=== <aside> class ===')
console.log('server :', serverAside)
console.log('client :', clientAside)
console.log('match  :', serverAside === clientAside ? 'YES' : 'NO')

await browser.close()
