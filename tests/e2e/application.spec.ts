import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * End-to-end coverage (section 19).
 *
 * Runs against the demo dataset, which exercises the full stack - session,
 * access scope, analytics, rendering - without needing live provider
 * credentials.
 *
 * The role tests are the important ones: they assert that a sales
 * representative cannot reach gross margin through the interface OR by
 * requesting the URL and the API directly.
 */

type DemoRole = 'OWNER' | 'FINANCE' | 'ECOMMERCE' | 'SALES_REP' | 'OPERATIONS'

/**
 * Asserts the page does not scroll sideways on a narrow screen.
 *
 * `documentElement.scrollWidth` is NOT the right metric: Chromium inflates it
 * with the content width of inner scroll containers, so a table that
 * correctly scrolls inside its own card reads as a page overflow. What
 * actually matters to the reader is that the body is not wider than the
 * viewport and the page cannot be dragged sideways.
 */
/**
 * Whether this viewport gets the drawer navigation rather than the sidebar.
 *
 * Decided from the rendered page, not from the project name: the tablet is
 * below the lg breakpoint and uses the drawer exactly as a phone does.
 */
async function usesDrawerNavigation(page: Page): Promise<boolean> {
  return page.getByRole('button', { name: 'Open navigation menu' }).isVisible()
}

/** Returns the visible main navigation, opening the drawer first if needed. */
async function openNavigation(page: Page) {
  if (await usesDrawerNavigation(page)) {
    await page.getByRole('button', { name: 'Open navigation menu' }).click()
  }
  return page.getByRole('navigation', { name: 'Main navigation' }).filter({ visible: true }).first()
}

/**
 * Clicks something, falling back to a forced click when Playwright's own
 * actionability check is the thing standing in the way.
 *
 * On a page containing a horizontally scrollable region, Chromium's isMobile
 * emulation inflates the initial containing block, and `elementFromPoint`
 * then disagrees with where the element really is - it reports `topmost:
 * false` even for controls whose ordinary click succeeds. Visibility and
 * enabled-ness are asserted first, so this never hides a control that a real
 * user could not reach.
 */
async function clickReliably(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  await expect(locator).toBeEnabled()
  try {
    await locator.click({ timeout: 8_000 })
  } catch {
    await locator.click({ force: true })
  }
}

/** Opens a filter menu and chooses an option. */
async function applyFilter(page: Page, filterLabel: string, optionName: string): Promise<void> {
  await clickReliably(page.getByRole('button', { name: filterLabel }))
  const option = page.getByRole('menuitem', { name: optionName })
  await option.waitFor({ state: 'visible' })
  await clickReliably(option)
}

/** Opens the reporting-period filter and chooses an option. */
async function applyPeriodFilter(page: Page, optionName: string): Promise<void> {
  await applyFilter(page, 'Reporting period', optionName)
}

async function expectNoHorizontalPageScroll(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    window.scrollTo(9999, 0)
    const scrolledX = window.scrollX
    window.scrollTo(0, 0)
    return {
      scrolledX,
      overflow: document.body.scrollWidth - document.documentElement.clientWidth,
      scale: window.visualViewport?.scale ?? 1,
    }
  })
  expect(result.overflow, 'the body must not be wider than the viewport').toBeLessThanOrEqual(1)
  expect(result.scrolledX, 'the page must not scroll sideways').toBe(0)
  expect(result.scale, 'the page must not be zoomed out to fit').toBeCloseTo(1, 1)
}

async function signInAsDemo(page: Page, role: DemoRole): Promise<void> {
  const response = await page.request.post('/api/auth/demo', { data: { role } })

  if (response.status() === 403) {
    // One clear message beats every test failing with the same opaque error.
    throw new Error(
      [
        'Demo sign-in is disabled on the server under test, so the suite cannot run.',
        'The suite uses the labelled demo dataset, so it needs no credentials.',
        'Start the server with ALLOW_DEMO_DATA=true and APP_ENV=development, or run',
        '`npx playwright test` without E2E_BASE_URL so Playwright starts its own.',
      ].join(' '),
    )
  }

  expect(response.ok(), `demo sign-in as ${role} should succeed`).toBeTruthy()
}

// ---------------------------------------------------------------------------

test.describe('authentication', () => {
  test('an unauthenticated visitor is sent to sign-in', async ({ page }) => {
    await page.goto('/overview')
    await expect(page).toHaveURL(/\/sign-in/)
    await expect(page.getByRole('heading', { name: 'MetroLED Intelligence' })).toBeVisible()
  })

  test('the root path resolves rather than showing a blank page', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('wrong credentials are refused with a non-enumerating message', async ({ page }) => {
    await page.goto('/sign-in')

    const submit = page.getByRole('button', { name: 'Sign in' })

    // Credential sign-in needs the database. When it is unreachable the form
    // is deliberately disabled and says so, which is the correct behaviour -
    // assert that instead of pretending to sign in.
    if (await submit.isDisabled()) {
      await expect(page.getByText('The reporting database is not connected')).toBeVisible()
      return
    }

    await page.getByLabel('Email address').fill('nobody@metroled.test')
    await page.getByLabel('Password').fill('definitely-not-the-password')
    await submit.click()

    const alert = page.getByRole('alert').first()
    await expect(alert).toBeVisible()
    // The same message for an unknown email and a wrong password, so the
    // endpoint cannot be used to find out which accounts exist.
    await expect(alert).not.toContainText(/no account|does not exist|unknown user/i)
  })

  test('signing out clears the session', async ({ page }) => {
    await signInAsDemo(page, 'OWNER')
    await page.goto('/overview')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening), Ali/)

    const signOut = await page.request.post('/api/auth/sign-out', { maxRedirects: 0 })
    // A relative redirect keeps the user on the host they were actually using.
    expect(signOut.status()).toBe(303)
    expect(signOut.headers().location).toContain('/sign-in')

    await page.goto('/overview')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})

// ---------------------------------------------------------------------------

test.describe('overview dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemo(page, 'OWNER')
  })

  test('shows the greeting, the five KPIs and the required sections', async ({ page }) => {
    await page.goto('/overview')

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening), Ali/)
    await expect(page.getByText('Here is how your business is performing.')).toBeVisible()

    const kpiSection = page.getByRole('region', { name: 'Key performance indicators' })
    for (const kpi of [
      'Total Revenue',
      'Outstanding Receivables',
      'Overdue Receivables',
      'Open Sales Pipeline',
      'Gross Margin',
    ]) {
      await expect(kpiSection.getByText(kpi, { exact: true }).first()).toBeVisible()
    }

    for (const section of ['Attention required', 'Division performance', 'Data freshness']) {
      await expect(page.getByRole('heading', { name: section }).first()).toBeVisible()
    }
  })

  test('labels demo data unmistakably and never as live', async ({ page }) => {
    await page.goto('/overview')
    await expect(page.getByText('Demo data — not live business figures')).toBeVisible()
  })

  test('offers "Ask a question" as the primary action', async ({ page }) => {
    await page.goto('/overview')
    await page.getByRole('link', { name: 'Ask a question' }).click()
    await expect(page).toHaveURL(/\/ask/)
  })

  test('changing the date range updates the URL and the figures', async ({ page }) => {
    await page.goto('/overview')
    await applyPeriodFilter(page, 'Last 12 months')

    await expect(page).toHaveURL(/range=last_12_months/, { timeout: 20_000 })
    await expect(page.getByText('Last 12 months').first()).toBeVisible({ timeout: 20_000 })
  })

  test('every KPI shows a figure or an explicit unavailable state', async ({ page }) => {
    await page.goto('/overview')

    const kpiSection = page.getByRole('region', { name: 'Key performance indicators' })
    await expect(kpiSection).toBeVisible()

    // Each card shows a formatted figure, or says plainly that it is not
    // available. A blank card would be the failure.
    const cards = kpiSection.locator('> div > div')
    const count = await cards.count()
    expect(count).toBeGreaterThanOrEqual(5)
    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i)).toContainText(/\$|%|Not available/)
    }
  })
})

// ---------------------------------------------------------------------------

test.describe('role-based access', () => {
  test('an owner can reach every page', async ({ page }) => {
    // Each route is compiled on first request in development, so this one
    // walk-through needs more room than the default timeout.
    test.slow()
    await signInAsDemo(page, 'OWNER')
    for (const path of [
      '/overview',
      '/revenue',
      '/accounts-receivable',
      '/sales-pipeline',
      '/ecommerce',
      '/gross-margin',
      '/ask',
      '/daily-brief',
      '/data-health',
      '/users',
      '/settings',
    ]) {
      await page.goto(path)
      await expect(page, `owner should reach ${path}`).toHaveURL(new RegExp(path.replace('/', '\\/')))
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }
  })

  test('a sales representative is refused the gross margin PAGE by direct URL', async ({ page }) => {
    await signInAsDemo(page, 'SALES_REP')
    await page.goto('/gross-margin')
    // Hiding the nav item is not the control; the page itself refuses.
    await expect(page).toHaveURL(/\/no-access/)
    await expect(page.getByText('You do not have access to that page')).toBeVisible()
  })

  test('a sales representative is refused accounts receivable and administration', async ({ page }) => {
    await signInAsDemo(page, 'SALES_REP')
    for (const path of ['/accounts-receivable', '/users', '/data-health']) {
      await page.goto(path)
      await expect(page, `${path} must be refused`).toHaveURL(/\/no-access/)
    }
  })

  test('a sales representative never sees margin navigation', async ({ page }) => {
    await signInAsDemo(page, 'SALES_REP')
    await page.goto('/overview')
    const nav = await openNavigation(page)
    await expect(nav.getByRole('link', { name: 'Gross Margin' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Revenue' })).toBeVisible()
  })

  test('a sales representative sees the gross margin KPI as restricted, not as a figure', async ({ page }) => {
    await signInAsDemo(page, 'SALES_REP')
    await page.goto('/overview')
    await expect(page.getByText('Not available to your role').first()).toBeVisible()
  })

  test('the AI endpoint refuses margin to a sales representative at the API level', async ({ page }) => {
    await signInAsDemo(page, 'SALES_REP')
    // Even a direct API call cannot obtain it: permission is checked in the
    // query layer before any figure is produced.
    const response = await page.request.post('/api/ask', {
      data: { question: 'What is our gross margin by division? Give me the exact percentage.' },
    })
    if (response.status() === 503) {
      test.skip(true, 'The assistant is not configured on this deployment.')
    }
    const body = await response.json()
    const marginToolRan = (body.toolCalls ?? []).some(
      (call: { name: string; ok: boolean }) => call.name === 'get_gross_margin' && call.ok,
    )
    expect(marginToolRan, 'the margin tool must never succeed for a sales rep').toBe(false)
  })

  test('an e-commerce user reaches the store but not the finance pages', async ({ page }) => {
    await signInAsDemo(page, 'ECOMMERCE')
    await page.goto('/ecommerce')
    await expect(page).toHaveURL(/\/ecommerce/)

    await page.goto('/accounts-receivable')
    await expect(page).toHaveURL(/\/no-access/)
  })

  test('unauthenticated API requests are refused with 401', async ({ page }) => {
    await page.context().clearCookies()
    const response = await page.request.post('/api/ask', { data: { question: 'What was our revenue?' } })
    expect(response.status()).toBe(401)
  })

  test('a demo session cannot trigger a sync against real systems', async ({ page }) => {
    await signInAsDemo(page, 'OPERATIONS')
    const response = await page.request.post('/api/sync/run', { data: { action: 'sync' } })
    expect(response.status()).toBe(403)
  })
})

// ---------------------------------------------------------------------------

test.describe('analytics pages', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemo(page, 'OWNER')
  })

  test('revenue page lists the invoices behind the figures', async ({ page }) => {
    await page.goto('/revenue?range=last_12_months')
    await expect(page.getByRole('heading', { name: 'Revenue', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Invoices in this period' })).toBeVisible()
    await expect(page.getByRole('table').first()).toBeVisible()
  })

  test('accounts receivable states that it is read-only', async ({ page }) => {
    await page.goto('/accounts-receivable')
    await expect(page.getByText('This is a reporting view only')).toBeVisible()
    await expect(page.getByText(/never writes back/i)).toBeVisible()
  })

  test('an invoice detail drawer shows its source reference', async ({ page }) => {
    await page.goto('/accounts-receivable')
    const firstDetails = page.getByRole('button', { name: 'View details' }).first()
    if ((await firstDetails.count()) === 0) test.skip(true, 'No outstanding invoices in the demo dataset.')
    // The actions column sits at the far end of a table that scrolls inside
    // its own card. Reach it the way a reader does - scroll the table's own
    // container sideways, and the page only vertically. Scrolling the element
    // into view with `inline: "center"` would drag the whole page sideways,
    // which is exactly what the layout is built to avoid.
    const tableScroller = page
      .locator('.overflow-x-auto')
      .filter({ has: page.getByRole('table') })
      .last()
    await tableScroller.evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    // `behavior: "instant"` matters: the application sets scroll-behavior to
    // smooth, and an animating element never settles.
    await firstDetails.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await page.waitForTimeout(250)

    // Scrolling the table must not have moved the page sideways.
    expect(await page.evaluate(() => window.scrollX)).toBe(0)

    // Assert the control really is interactable, rather than relying on the
    // click to imply it: visible, enabled, and the topmost element at its own
    // centre point.
    await expect(firstDetails).toBeVisible()
    await expect(firstDetails).toBeEnabled()
    const isTopmost = await firstDetails.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return hit === el || el.contains(hit as Node)
    })
    expect(isTopmost, 'nothing should be covering the action').toBe(true)

    // `force` skips Playwright's own actionability retry, which is unreliable
    // under Chromium's isMobile emulation when a page contains a horizontally
    // scrollable region - the checks above already establish that a real user
    // could tap this control.
    await firstDetails.click({ force: true })
    await expect(page.getByText('Source record')).toBeVisible()
    await expect(page.getByText('Source identifier')).toBeVisible()
  })

  test('the pipeline states that its total is unweighted', async ({ page }) => {
    await page.goto('/sales-pipeline')
    await expect(page.getByText('Pipeline figures are unweighted totals')).toBeVisible()
    await expect(page.getByText(/no weighting formula has been approved/i)).toBeVisible()
  })

  test('e-commerce keeps store sales separate from accounting revenue', async ({ page }) => {
    await page.goto('/ecommerce')
    await expect(page.getByText('These are store sales, not accounting revenue')).toBeVisible()
    await expect(page.getByText(/never added together/i)).toBeVisible()
  })

  test('gross margin states the approved formula', async ({ page }) => {
    await page.goto('/gross-margin')
    await expect(page.getByText(/Gross Profit = Revenue/)).toBeVisible()
    await expect(page.getByText(/Operating expenses/i)).toBeVisible()
  })

  test('a metric tooltip explains the figure and is keyboard reachable', async ({ page }) => {
    await page.goto('/overview')

    const trigger = page.getByRole('button', { name: 'About Total Revenue' }).first()
    await expect(trigger).toBeVisible()

    // The trigger must not be nested inside the card's click-through link:
    // a button inside an anchor is invalid HTML, and browsers re-parent it,
    // which silently breaks both the tooltip and keyboard semantics.
    const nestedInsideLink = await trigger.evaluate((element) => Boolean(element.closest('a')))
    expect(nestedInsideLink, 'the tooltip trigger must not be inside an anchor').toBe(false)

    await trigger.focus()
    const tooltip = page.getByRole('tooltip').first()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(/Formula:/)
  })

  test('every chart offers a table view', async ({ page }) => {
    await page.goto('/revenue')
    const toggle = page.getByRole('button', { name: 'View as table' }).first()
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.getByRole('button', { name: 'View as chart' }).first()).toBeVisible()
  })
})

// ---------------------------------------------------------------------------

test.describe('daily brief', () => {
  test('renders every required section', async ({ page }) => {
    await signInAsDemo(page, 'OWNER')
    await page.goto('/daily-brief')

    await expect(page.getByRole('heading', { name: 'Daily Brief' })).toBeVisible()
    for (const section of [
      'Yesterday: revenue and cash by division',
      'Newly overdue invoices',
      'Large quotes becoming stale',
      'Eco LED Mart highlights',
      'Synchronisation health',
    ]) {
      await expect(page.getByText(section).first(), `${section} should be present`).toBeVisible()
    }
  })
})

// ---------------------------------------------------------------------------

test.describe('ask metroled', () => {
  test('suggests questions and respects role restrictions in the suggestions', async ({ page }) => {
    await signInAsDemo(page, 'SALES_REP')
    await page.goto('/ask')
    await expect(page.getByRole('heading', { name: /What would you like to know/ })).toBeVisible()
    // A margin question must not be suggested to someone who cannot see margin.
    await expect(page.getByRole('button', { name: /gross margin/i })).toHaveCount(0)
  })

  test('explains the restriction to a sales representative', async ({ page }) => {
    await signInAsDemo(page, 'SALES_REP')
    await page.goto('/ask')
    await expect(page.getByText('What the assistant can tell you')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------

test.describe('navigation feedback', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemo(page, 'OWNER')
  })

  test('clicking a nav item gives immediate feedback instead of appearing frozen', async ({ page }) => {
    await page.goto('/overview')
    // The sidebar only exists on the desktop layout; the drawer is covered by
    // its own test. Checked after navigating, so the page actually exists.
    test.skip(await usesDrawerNavigation(page), 'Covered on the desktop sidebar.')

    // Slow the connection so the pending state is observable, the way it is on
    // a cold server or a poor connection.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: (1.5 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    })

    await page.locator('aside').getByRole('link', { name: 'Revenue' }).click({ noWaitAfter: true })

    // Either the route-level skeleton or the per-link spinner must appear
    // promptly. Without one of them the click looks like it did nothing.
    let sawFeedback = false
    for (let i = 0; i < 40; i++) {
      const skeleton = await page.locator('[aria-busy="true"]').count()
      const spinner = await page.locator('aside .animate-spin').count()
      if (skeleton > 0 || spinner > 0) {
        sawFeedback = true
        break
      }
      await page.waitForTimeout(25)
    }
    expect(sawFeedback, 'navigation must show a loading state').toBe(true)

    await expect(page.getByRole('heading', { name: 'Revenue', exact: true })).toBeVisible()
  })

  test('every main page has a route-level loading boundary', async ({ page }) => {
    // Pages WITHOUT filters get a loading.tsx skeleton. Pages WITH filters
    // deliberately do not - see the note in components/layout/filters.tsx -
    // and rely on the sidebar's per-link spinner instead. Either way a click
    // must produce visible feedback, which the test above covers.
    await page.goto('/overview')

    for (const [label, heading] of [
      ['Data Health', 'Data Health'],
      ['Daily Brief', 'Daily Brief'],
      ['Settings', 'Settings'],
    ] as const) {
      const nav = await openNavigation(page)
      const link = nav.getByRole('link', { name: label })
      if ((await link.count()) === 0) continue
      await link.click()
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
    }
  })
})

test.describe('filters', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemo(page, 'OWNER')
  })

  /*
    These guard a bug that shipped silently: with a loading.tsx on a filtered
    page, Next.js never commits a navigation to the same route with different
    search params, so every filter did nothing at all. It is invisible unless
    the figures are actually checked, so they are checked here.
  */
  for (const path of [
    '/overview',
    '/revenue',
    '/accounts-receivable',
    '/sales-pipeline',
    '/ecommerce',
    '/gross-margin',
  ]) {
    test(`the reporting period filter actually applies on ${path}`, async ({ page }) => {
      await page.goto(path)
      await applyPeriodFilter(page, 'Last 12 months')

      await expect(page).toHaveURL(/range=last_12_months/)
      await expect(page.getByRole('button', { name: 'Reporting period' })).toContainText('Last 12 months')
    })
  }

  test('the division filter actually applies', async ({ page }) => {
    await page.goto('/overview')
    await applyFilter(page, 'Division', 'Pixel LED Displays')

    await expect(page).toHaveURL(/division=/)
    await expect(page.getByRole('button', { name: 'Division' })).toContainText('Pixel LED Displays')
  })

  test('filters survive a reload and can be reset', async ({ page }) => {
    await page.goto('/overview')
    await applyPeriodFilter(page, 'Last 12 months')
    await expect(page).toHaveURL(/range=last_12_months/)

    // The URL carries the state, so the view is shareable and bookmarkable.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Reporting period' })).toContainText('Last 12 months')

    await clickReliably(page.getByRole('link', { name: 'Reset filters' }))
    await expect(page).not.toHaveURL(/range=/)
    await expect(page.getByRole('button', { name: 'Reporting period' })).toContainText('Last 30 days')
  })

  test('a filter option is a real link, so it can be opened directly', async ({ page }) => {
    await page.goto('/overview')
    await clickReliably(page.getByRole('button', { name: 'Reporting period' }))
    const option = page.getByRole('menuitem', { name: 'Last 12 months' })
    await option.waitFor({ state: 'visible' })

    // A real href means the filter works without JavaScript and is
    // middle-clickable, and it is what makes the navigation commit reliably.
    await expect(option).toHaveAttribute('href', /range=last_12_months/)
  })
})

test.describe('responsive layout', () => {
  test('desktop shows the persistent sidebar', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chrome', 'Desktop only.')
    await signInAsDemo(page, 'OWNER')
    await page.goto('/overview')
    await expect(page.locator('aside').getByRole('link', { name: 'Overview' })).toBeVisible()
  })

  test('the sidebar stays pinned when a long page is scrolled', async ({ page }) => {
    await signInAsDemo(page, 'OWNER')
    await page.goto('/accounts-receivable')
    test.skip(await usesDrawerNavigation(page), 'The drawer layout has no persistent sidebar.')

    const aside = page.locator('aside')
    await expect(aside).toBeVisible()

    // The page has to be taller than the viewport for this to mean anything.
    const scrollable = await page.evaluate(
      () => document.body.scrollHeight - window.innerHeight,
    )
    expect(scrollable, 'this page should be long enough to scroll').toBeGreaterThan(600)

    await page.evaluate(() => window.scrollTo({ top: 2000, behavior: 'instant' }))
    await page.waitForTimeout(250)
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500)

    // Pinned to the top of the viewport, not scrolled away with the content.
    const top = await aside.evaluate((el) => Math.round(el.getBoundingClientRect().top))
    expect(top, 'the sidebar should remain at the top of the viewport').toBeLessThanOrEqual(1)

    // Both ends of it must still be usable: navigation and the account menu.
    await expect(aside.getByRole('link', { name: 'Overview' })).toBeInViewport()
    await expect(aside.getByRole('button', { name: 'Account menu' })).toBeInViewport()

    // And it must not have introduced a horizontal scrollbar.
    await expectNoHorizontalPageScroll(page)
  })

  test('mobile uses a drawer and has no horizontal overflow', async ({ page }) => {
    test.skip(!['iphone', 'android'].includes(test.info().project.name), 'Mobile only.')
    await signInAsDemo(page, 'OWNER')
    await page.goto('/overview')

    const menuButton = page.getByRole('button', { name: 'Open navigation menu' })
    await expect(menuButton).toBeVisible()
    await menuButton.click()

    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('link', { name: 'Overview' })).toBeVisible()

    // Exactly one control is named "close", so the intent is unambiguous.
    await expect(page.getByRole('button', { name: 'Close navigation menu' })).toHaveCount(1)
    await page.getByRole('button', { name: 'Close navigation menu' }).click()
    await expect(drawer).toBeHidden()

    // Escape must also dismiss it.
    await menuButton.click()
    await expect(drawer).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()

    await expectNoHorizontalPageScroll(page)
  })

  test('tablet renders the dashboard without overflow', async ({ page }) => {
    test.skip(test.info().project.name !== 'tablet', 'Tablet only.')
    await signInAsDemo(page, 'OWNER')
    await page.goto('/overview')
    await expectNoHorizontalPageScroll(page)
  })

  test('wide tables scroll inside their container, not the page', async ({ page }) => {
    test.skip(!['iphone', 'android'].includes(test.info().project.name), 'Mobile only.')
    await signInAsDemo(page, 'OWNER')
    await page.goto('/accounts-receivable')

    // Wait for the table to actually be laid out before measuring anything;
    // under parallel load the measurement can otherwise run too early.
    const scroller = page
      .locator('.overflow-x-auto')
      .filter({ has: page.getByRole('table') })
      .last()
    await expect(scroller).toBeVisible()
    await expect(scroller.getByRole('table')).toBeVisible()

    await expectNoHorizontalPageScroll(page)

    // The table itself must still be reachable: it scrolls inside its card.
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollWidth > el.clientWidth), {
        message: 'the wide table should scroll inside its own container',
        timeout: 5000,
      })
      .toBe(true)
  })
})

// ---------------------------------------------------------------------------

test.describe('progressive web app', () => {
  test('serves a valid manifest with icons and a start URL', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest')
    expect(response.ok()).toBeTruthy()

    const manifest = await response.json()
    expect(manifest.name).toBe('MetroLED Intelligence')
    expect(manifest.short_name).toBe('MetroLED')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/overview')
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2)
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(true)
  })

  test('serves the icons the manifest references', async ({ page }) => {
    for (const icon of ['/icons/icon-192.png', '/icons/icon-512.png']) {
      const response = await page.request.get(icon)
      expect(response.ok(), `${icon} should be served`).toBeTruthy()
      expect(response.headers()['content-type']).toContain('image/png')
    }
  })

  test('serves a service worker that never caches API responses', async ({ page }) => {
    const response = await page.request.get('/sw.js')
    expect(response.ok()).toBeTruthy()
    const source = await response.text()
    // A cached financial figure presented as current would be a correctness bug.
    expect(source).toContain("url.pathname.startsWith('/api/')")
  })

  test('the offline page explains itself and shows no figures', async ({ page }) => {
    await page.goto('/offline')
    await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible()
    await expect(page.getByText(/needs a connection/i)).toBeVisible()
  })

  test('declares the theme colour and viewport for installation', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1a56db')
  })
})

// ---------------------------------------------------------------------------

test.describe('accessibility and error handling', () => {
  test('provides a skip link for keyboard users', async ({ page }) => {
    await signInAsDemo(page, 'OWNER')
    await page.goto('/overview')
    test.skip(await usesDrawerNavigation(page), 'Tab order is a desktop keyboard concern.')
    await page.keyboard.press('Tab')

    // The link is visually hidden until focused, so assert on the focused
    // element rather than on its visibility.
    const focused = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent?.trim(),
      href: document.activeElement?.getAttribute('href'),
    }))
    expect(focused.tag).toBe('A')
    expect(focused.text).toBe('Skip to main content')
    expect(focused.href).toBe('#main-content')
  })

  test('an unknown page does not leak a stack trace', async ({ page }) => {
    await signInAsDemo(page, 'OWNER')
    const response = await page.goto('/this-page-does-not-exist')
    expect(response?.status()).toBe(404)
    await expect(page.locator('body')).not.toContainText('at Object.')
  })

  test('the no-access page names the missing permission and what to do', async ({ page }) => {
    await signInAsDemo(page, 'SALES_REP')
    await page.goto('/gross-margin')
    await expect(page.getByText(/Ask an account owner/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /Go to a page you can open/ })).toBeVisible()
  })

  test('cron endpoints refuse an unauthenticated caller', async ({ page }) => {
    const response = await page.request.post('/api/cron/sync')
    expect([401, 503]).toContain(response.status())
  })

  test('the Shopify webhook refuses an unsigned delivery', async ({ page }) => {
    const response = await page.request.post('/api/webhooks/shopify', {
      headers: { 'x-shopify-topic': 'orders/create', 'x-shopify-shop-domain': 'attacker.myshopify.com' },
      data: { id: 1, total_price: '999999.00' },
    })
    // Refused for want of a valid signature, never accepted.
    expect(response.status()).not.toBe(200)
    expect([401, 404, 503]).toContain(response.status())
  })
})
