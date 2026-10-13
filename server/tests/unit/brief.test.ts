import { describe, expect, it, beforeAll } from 'vitest'
import { renderBrief } from '@/lib/brief/render'
import { briefJobKey } from '@/lib/brief/send'
import type { BriefPayload } from '@/lib/brief/generate'
import { toIsoDate, previousBusinessDate } from '@shared/dates'
import { parseAnswer } from '@shared/ask'
import { resetEnvCache } from '@/lib/env'

/**
 * Daily brief rendering and duplicate prevention (sections 12 and 19).
 */

beforeAll(() => {
  process.env.APP_URL = 'https://intelligence.metroled.test'
  // The environment is parsed once and cached, so it has to be invalidated
  // after overriding a value for the test.
  resetEnvCache()
})

function payload(overrides: Partial<BriefPayload> = {}): BriefPayload {
  return {
    briefDate: '2026-03-17',
    generatedAt: '2026-03-18T11:00:00.000Z',
    timezone: 'America/New_York',
    dataMode: 'live',
    revenue: {
      total: 42350.5,
      invoiceCount: 4,
      byDivision: [
        { divisionId: 'd1', name: 'MetroLED', code: 'METROLED', revenue: 25000, invoiceCount: 3 },
        { divisionId: 'd2', name: 'Pixel LED Displays', code: 'PIXEL', revenue: 17350.5, invoiceCount: 1 },
      ],
      previousBusinessDayTotal: 38000,
    },
    cash: { collected: 19500, paymentCount: 3 },
    receivables: {
      totalOutstanding: 512000,
      overdueAmount: 148000,
      overdueCount: 17,
      newlyOverdue: [
        {
          invoiceId: 'i1',
          docNumber: '10432',
          customerName: 'Harbourfront Retail Group',
          divisionName: 'MetroLED',
          balance: 12400,
          dueOn: '2026-03-16',
          daysOverdue: 1,
        },
      ],
      newlyOverdueTotal: 12400,
    },
    pipeline: {
      openValue: 880000,
      openCount: 41,
      newlyStale: [
        {
          quoteId: 'q1',
          docNumber: 'Q-4120',
          customerName: 'Metro Transit Authority',
          ownerName: 'Jordan Mills',
          amount: 124000,
          daysIdle: 23,
        },
      ],
      newlyStaleTotal: 124000,
      staleThresholdDays: 21,
    },
    ecommerce: { netSales: 3250.75, orderCount: 14, averageOrderValue: 232.2, available: true },
    sync: {
      healthy: true,
      summary: 'All connected sources are up to date. Last successful sync 42 minutes ago.',
      sources: [
        {
          provider: 'QUICKBOOKS',
          displayName: 'QuickBooks Online',
          status: 'CONNECTED',
          lastSuccessLabel: '42 minutes ago',
          isStale: false,
          errorMessage: null,
        },
      ],
    },
    warnings: [],
    ...overrides,
  }
}

describe('daily brief rendering', () => {
  it('produces matching HTML and plain-text versions', () => {
    const { html, text, subject } = renderBrief(payload())
    expect(html).toContain('<!doctype html>')
    expect(text).not.toContain('<')
    expect(subject).toContain('MetroLED daily brief')
  })

  it('leads the subject with the headline figure', () => {
    expect(renderBrief(payload()).subject).toContain('$42,351')
  })

  it('includes every required section', () => {
    const { html, text } = renderBrief(payload())
    for (const content of [html, text]) {
      expect(content.toLowerCase()).toContain('revenue')
      expect(content.toLowerCase()).toContain('overdue')
      expect(content.toLowerCase()).toContain('stale')
      expect(content.toLowerCase()).toContain('eco led mart')
      expect(content.toLowerCase()).toContain('synchronis')
    }
  })

  it('reports each division separately', () => {
    const { html, text } = renderBrief(payload())
    expect(html).toContain('MetroLED')
    expect(html).toContain('Pixel LED Displays')
    expect(text).toContain('Pixel LED Displays')
  })

  it('marks a demo brief unmistakably, in the subject and the body', () => {
    const { html, text, subject } = renderBrief(payload({ dataMode: 'demo' }))
    expect(subject).toContain('[DEMO DATA]')
    expect(html).toContain('DEMO DATA')
    expect(text).toContain('DEMO DATA')
  })

  it('surfaces warnings prominently rather than burying them', () => {
    const { html, text } = renderBrief(
      payload({ warnings: ['Shopify has not synced for 9 hours, so the store figures may be incomplete.'] }),
    )
    expect(html).toContain('Shopify has not synced')
    expect(text).toContain('PLEASE READ BEFORE ACTING')
  })

  it('states plainly when nothing became overdue, rather than showing an empty table', () => {
    const { html, text } = renderBrief(
      payload({
        receivables: { ...payload().receivables, newlyOverdue: [], newlyOverdueTotal: 0 },
      }),
    )
    expect(html).toContain('Nothing became overdue')
    expect(text).toContain('Nothing became overdue')
  })

  it('says so when Shopify is not connected instead of reporting zero', () => {
    const { html, text } = renderBrief(
      payload({ ecommerce: { netSales: 0, orderCount: 0, averageOrderValue: null, available: false } }),
    )
    expect(html).toContain('Shopify is not connected')
    expect(text).toContain('Shopify is not connected')
  })

  it('never presents Shopify sales as accounting revenue', () => {
    const { html, text } = renderBrief(payload())
    expect(html.toLowerCase()).toContain('not the same basis as accounting revenue')
    expect(text.toLowerCase()).toContain('not the same basis as accounting revenue')
  })

  it('escapes HTML in customer names so a name cannot inject markup', () => {
    const { html } = renderBrief(
      payload({
        receivables: {
          ...payload().receivables,
          newlyOverdue: [
            {
              invoiceId: 'i1',
              docNumber: '1',
              customerName: '<script>alert(1)</script>',
              divisionName: null,
              balance: 100,
              dueOn: '2026-03-16',
              daysOverdue: 1,
            },
          ],
        },
      }),
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('links back to the application using the configured base URL', () => {
    const { html } = renderBrief(payload())
    expect(html).toContain('https://intelligence.metroled.test/daily-brief')
  })
})

describe('duplicate send prevention', () => {
  it('derives a stable idempotency key from the business date', () => {
    const date = new Date('2026-03-17T00:00:00.000Z')
    expect(briefJobKey(date)).toBe('brief:2026-03-17')
    // Same date, different time of day -> same key, so a retry cannot
    // enqueue a second send.
    expect(briefJobKey(new Date('2026-03-17T23:59:00.000Z'))).toBe('brief:2026-03-17')
  })

  it('gives consecutive business days different keys', () => {
    expect(briefJobKey(new Date('2026-03-17T00:00:00.000Z'))).not.toBe(
      briefJobKey(new Date('2026-03-18T00:00:00.000Z')),
    )
  })

  it('reports on the previous business day, so Monday covers Friday', () => {
    const monday = new Date('2026-03-16T11:00:00.000Z')
    expect(toIsoDate(previousBusinessDate(monday, 'UTC'))).toBe('2026-03-13')
  })
})

describe('assistant answer parsing', () => {
  it('splits the four-part answer into labelled sections', () => {
    const blocks = parseAnswer(
      [
        '**Answer:** Revenue last month was $1,273,161.',
        '',
        '**Business context:** That is up 179% on the previous month, driven by one large Pixel LED project.',
        '',
        '**Source:** QuickBooks Online, 21 invoices dated in Sep 2026.',
        '',
        '**Data freshness:** QuickBooks last synced 42 minutes ago.',
      ].join('\n'),
    )

    const labels = blocks.map((b) => b.label)
    expect(labels).toContain('Answer')
    expect(labels).toContain('Business context')
    expect(labels).toContain('Source')
    expect(labels).toContain('Data freshness')
    expect(blocks.find((b) => b.label === 'Answer')?.text).toContain('$1,273,161')
  })

  it('renders an unstructured answer as a single block', () => {
    const blocks = parseAnswer('Revenue is invoiced sales excluding tax, by invoice date.')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.label).toBeNull()
  })

  it('strips inline bold markers from the body text', () => {
    const blocks = parseAnswer('**Answer:** Revenue was **$500**.')
    expect(blocks[0]?.text).toBe('Revenue was $500.')
  })
})
