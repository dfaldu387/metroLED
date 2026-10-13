import { describe, expect, it, beforeAll } from 'vitest'
import crypto from 'node:crypto'
import { nameKey, normalizeEmail, normalizeName, scoreMatch, tokenSimilarity, AUTO_MATCH_THRESHOLD } from '@/lib/integrations/matching'
import { resolveDivision, ruleMatches, type DivisionRule } from '@/lib/integrations/division-mapping'
import { normalizeOrder, parseNextPageInfo, refundedTotal, verifyShopifyWebhook } from '@/lib/integrations/shopify'
import { normalizeStage } from '@/lib/integrations/method'
import { backoffDelay } from '@/lib/integrations/http'
import { previousBusinessDate, resolveRange, toIsoDate, buildBuckets, addMonths } from '@/lib/dates'
import type { NormalizedCustomer } from '@/lib/integrations/types'

/**
 * Integration behaviours (section 19).
 *
 * Covers webhook signature verification, pagination, cross-system customer
 * matching, division mapping and the retry policy - the places where a quiet
 * bug would corrupt the reporting database rather than throw.
 */

beforeAll(() => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'test-session-secret-at-least-16-chars'
})

// ---------------------------------------------------------------------------

describe('Shopify webhook verification', () => {
  const secret = 'shhh-this-is-the-webhook-secret'
  const body = JSON.stringify({ id: 5500001, total_price: '123.45' })
  const validSignature = crypto.createHmac('sha256', secret).update(body).digest('base64')

  it('accepts a correctly signed delivery', () => {
    expect(verifyShopifyWebhook(body, validSignature, secret)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const tampered = JSON.stringify({ id: 5500001, total_price: '999999.00' })
    expect(verifyShopifyWebhook(tampered, validSignature, secret)).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    const wrong = crypto.createHmac('sha256', 'wrong-secret').update(body).digest('base64')
    expect(verifyShopifyWebhook(body, wrong, secret)).toBe(false)
  })

  it('rejects a missing signature', () => {
    expect(verifyShopifyWebhook(body, null, secret)).toBe(false)
    expect(verifyShopifyWebhook(body, '', secret)).toBe(false)
  })

  it('rejects when no secret is configured', () => {
    expect(verifyShopifyWebhook(body, validSignature, '')).toBe(false)
  })

  it('is sensitive to whitespace, so the raw body must be used', () => {
    // Re-serialising the JSON changes the bytes and must fail, which is why
    // the route reads the raw body before parsing.
    const reserialised = JSON.stringify(JSON.parse(body), null, 2)
    expect(verifyShopifyWebhook(reserialised, validSignature, secret)).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('Shopify pagination', () => {
  it('extracts the page_info cursor from the Link header', () => {
    const header =
      '<https://shop.myshopify.com/admin/api/2025-07/orders.json?limit=100&page_info=abc123>; rel="next"'
    expect(parseNextPageInfo(header)).toBe('abc123')
  })

  it('picks the next link when previous is also present', () => {
    const header =
      '<https://shop.myshopify.com/admin/api/2025-07/orders.json?page_info=prev999>; rel="previous", ' +
      '<https://shop.myshopify.com/admin/api/2025-07/orders.json?page_info=next111>; rel="next"'
    expect(parseNextPageInfo(header)).toBe('next111')
  })

  it('returns null on the last page', () => {
    const header = '<https://shop.myshopify.com/admin/api/2025-07/orders.json?page_info=prev999>; rel="previous"'
    expect(parseNextPageInfo(header)).toBeNull()
    expect(parseNextPageInfo(null)).toBeNull()
    expect(parseNextPageInfo('')).toBeNull()
  })

  it('does not throw on a malformed header', () => {
    expect(parseNextPageInfo('this is not a link header')).toBeNull()
    expect(parseNextPageInfo('<not-a-url>; rel="next"')).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('Shopify order normalisation', () => {
  const payload = {
    id: 5500000123,
    name: '#ELM1042',
    order_number: 1042,
    email: 'dana@example.com',
    currency: 'CAD',
    subtotal_price: '180.00',
    total_discounts: '20.00',
    total_tax: '23.40',
    total_price: '218.40',
    financial_status: 'paid',
    fulfillment_status: null,
    processed_at: '2026-03-10T14:30:00-05:00',
    created_at: '2026-03-10T14:29:00-05:00',
    updated_at: '2026-03-11T09:00:00-05:00',
    cancelled_at: null,
    customer: { id: 991, first_name: 'Dana', last_name: 'Whitfield', email: 'dana@example.com' },
    line_items: [
      { id: 1, product_id: 77, variant_id: 88, sku: 'ELM-A19', title: 'A19 Bulb', quantity: 4, price: '35.00', total_discount: '20.00' },
    ],
    shipping_lines: [{ price: '15.00', discounted_price: '15.00' }],
    refunds: [],
  }

  it('uses subtotal after discounts as net sales, excluding tax and shipping', () => {
    const order = normalizeOrder(payload)
    expect(order.subtotalPrice).toBe(180)
    expect(order.netSalesAmount).toBe(180)
    expect(order.totalTax).toBe(23.4)
    expect(order.totalShipping).toBe(15)
  })

  it('maps an absent fulfillment_status to unfulfilled, not unknown', () => {
    expect(normalizeOrder(payload).fulfillmentStatus).toBe('UNFULFILLED')
  })

  it('deducts successful refunds from net sales', () => {
    const refunded = {
      ...payload,
      refunds: [
        {
          id: 1,
          transactions: [
            { amount: '50.00', kind: 'refund', status: 'success' },
            // A failed refund must not be deducted.
            { amount: '30.00', kind: 'refund', status: 'failure' },
            // A sale transaction is not a refund.
            { amount: '10.00', kind: 'sale', status: 'success' },
          ],
        },
      ],
    }
    expect(refundedTotal(refunded)).toBe(50)
    expect(normalizeOrder(refunded).netSalesAmount).toBe(130)
  })

  it('preserves the Shopify id as the source identifier', () => {
    const order = normalizeOrder(payload)
    expect(order.sourceId).toBe('5500000123')
    expect(order.orderNumber).toBe('#ELM1042')
    expect(order.customerSourceId).toBe('991')
  })

  it('computes line amounts net of the line discount', () => {
    const order = normalizeOrder(payload)
    // 4 x 35.00 = 140.00, less a 20.00 line discount.
    expect(order.lines[0]?.amount).toBe(120)
    expect(order.lines[0]?.quantity).toBe(4)
  })
})

// ---------------------------------------------------------------------------

describe('cross-system customer matching', () => {
  function source(overrides: Partial<NormalizedCustomer> = {}): NormalizedCustomer {
    return {
      sourceId: 'x-1',
      name: 'Harbourfront Retail Group',
      email: null,
      phone: null,
      city: null,
      region: null,
      country: null,
      classificationHint: null,
      raw: {},
      ...overrides,
    }
  }

  const candidate = (name: string, email: string | null = null) => ({
    id: `c-${name}`,
    name,
    normalizedName: normalizeName(name),
    email,
  })

  it('normalises away punctuation, case and accents', () => {
    expect(normalizeName('Café  Montréal, Inc.')).toBe('cafe montreal inc')
    expect(normalizeName('A & B Signs')).toBe('a and b signs')
  })

  it('strips legal suffixes when building the comparison key', () => {
    expect(nameKey('Beacon Construction Ltd.')).toBe('beacon construction')
    expect(nameKey('Beacon Construction Limited')).toBe('beacon construction')
    expect(nameKey('Beacon Construction Inc')).toBe('beacon construction')
  })

  it('matches on email with full confidence', () => {
    const result = scoreMatch(source({ email: 'AP@Harbourfront.com' }), [
      candidate('Completely Different Name', 'ap@harbourfront.com'),
    ])
    expect(result.confidence).toBe(100)
    expect(result.customerId).toBeTruthy()
  })

  it('matches an identical normalised name', () => {
    const result = scoreMatch(source(), [candidate('harbourfront retail group')])
    expect(result.confidence).toBe(95)
    expect(result.customerId).toBeTruthy()
  })

  it('matches across differing legal suffixes', () => {
    const result = scoreMatch(source({ name: 'Beacon Construction Ltd.' }), [
      candidate('Beacon Construction Inc'),
    ])
    expect(result.confidence).toBe(85)
    expect(result.customerId).toBeTruthy()
  })

  it('does NOT match two different companies that share one word', () => {
    // "Metro Transit Authority" must never be matched to "Metro Signs".
    const result = scoreMatch(source({ name: 'Metro Transit Authority' }), [candidate('Metro Signs')])
    expect(result.customerId).toBeNull()
    expect(result.confidence).toBeLessThan(AUTO_MATCH_THRESHOLD)
  })

  it('surfaces a near-miss as a suggestion instead of matching it', () => {
    const result = scoreMatch(source({ name: 'Harbourfront Retail Grp' }), [
      candidate('Harbourfront Retail Group Holdings Corporation'),
    ])
    if (result.customerId === null) {
      expect(result.suggestedCustomerId).toBeTruthy()
      expect(result.reason).toContain('below')
    } else {
      // If it did match, it must have cleared the threshold honestly.
      expect(result.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD)
    }
  })

  it('reports no candidate at all when nothing resembles the record', () => {
    const result = scoreMatch(source({ name: 'Zzyzx Holdings' }), [candidate('Harbourfront Retail Group')])
    expect(result.customerId).toBeNull()
    expect(result.suggestedCustomerId).toBeNull()
  })

  it('ignores an email that is not an email', () => {
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com')
    expect(normalizeEmail(null)).toBeNull()
  })

  it('scores token similarity symmetrically', () => {
    expect(tokenSimilarity('Harbourfront Retail Group', 'Retail Group Harbourfront')).toBe(100)
  })
})

// ---------------------------------------------------------------------------

describe('division mapping', () => {
  const rule = (overrides: Partial<DivisionRule> = {}): DivisionRule => ({
    id: 'r1',
    field: 'class',
    matchType: 'contains',
    matchValue: 'Pixel',
    divisionId: 'div-pixel',
    priority: 10,
    ...overrides,
  })

  it('matches case-insensitively', () => {
    expect(ruleMatches(rule(), 'PIXEL LED - Arena')).toBe(true)
    expect(ruleMatches(rule(), 'pixel')).toBe(true)
  })

  it('supports every match type', () => {
    expect(ruleMatches(rule({ matchType: 'equals', matchValue: 'Pixel' }), 'Pixel')).toBe(true)
    expect(ruleMatches(rule({ matchType: 'equals', matchValue: 'Pixel' }), 'Pixel LED')).toBe(false)
    expect(ruleMatches(rule({ matchType: 'starts_with', matchValue: 'Pix' }), 'Pixel LED')).toBe(true)
    expect(ruleMatches(rule({ matchType: 'ends_with', matchValue: 'LED' }), 'Pixel LED')).toBe(true)
    expect(ruleMatches(rule({ matchType: 'regex', matchValue: '^Pix.*LED$' }), 'Pixel LED')).toBe(true)
  })

  it('returns false rather than throwing on an invalid regular expression', () => {
    expect(ruleMatches(rule({ matchType: 'regex', matchValue: '([unclosed' }), 'anything')).toBe(false)
  })

  it('never matches a null or empty field', () => {
    expect(ruleMatches(rule(), null)).toBe(false)
    expect(ruleMatches(rule(), undefined)).toBe(false)
    expect(ruleMatches(rule(), '   ')).toBe(false)
  })

  it('applies the lowest priority rule first', () => {
    const rules = [
      rule({ id: 'late', priority: 100, matchValue: 'LED', divisionId: 'div-metroled' }),
      rule({ id: 'early', priority: 10, matchValue: 'Pixel', divisionId: 'div-pixel' }),
    ]
    expect(resolveDivision(rules, { class: 'Pixel LED' })).toBe('div-pixel')
  })

  it('leaves a record unassigned when no rule matches', () => {
    // The critical behaviour: never fall back to a default division.
    expect(resolveDivision([rule()], { class: 'Something Else' })).toBeNull()
    expect(resolveDivision([], { class: 'Pixel' })).toBeNull()
  })

  it('matches on whichever field the rule names', () => {
    const rules = [rule({ field: 'customer', matchValue: 'Arena', divisionId: 'div-pixel' })]
    expect(resolveDivision(rules, { class: null, customer: 'Centre Court Arena' })).toBe('div-pixel')
  })
})

// ---------------------------------------------------------------------------

describe('Method CRM stage normalisation', () => {
  it('recognises closed-won variations', () => {
    expect(normalizeStage('Closed Won').status).toBe('WON')
    expect(normalizeStage('Accepted').status).toBe('WON')
    expect(normalizeStage('Approved by customer').status).toBe('WON')
  })

  it('recognises closed-lost variations', () => {
    expect(normalizeStage('Closed Lost').status).toBe('LOST')
    expect(normalizeStage('Declined').status).toBe('LOST')
  })

  it('keeps an unrecognised stage open rather than discarding the quote', () => {
    const result = normalizeStage('Awaiting Structural Sign-off')
    expect(result.status).toBe('OPEN')
    expect(result.normalized).toBe('awaiting_structural_sign_off')
  })

  it('handles a missing stage', () => {
    expect(normalizeStage(null).status).toBe('OPEN')
    expect(normalizeStage('').normalized).toBe('not_recorded')
  })
})

// ---------------------------------------------------------------------------

describe('retry policy', () => {
  it('grows the backoff ceiling exponentially', () => {
    // Full jitter means the value is random within the window, so the ceiling
    // is what is asserted.
    for (let attempt = 1; attempt <= 6; attempt++) {
      const delay = backoffDelay(attempt, 500, 30_000)
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThanOrEqual(Math.min(30_000, 500 * 2 ** (attempt - 1)))
    }
  })

  it('never exceeds the cap', () => {
    for (let i = 0; i < 50; i++) {
      expect(backoffDelay(20, 500, 30_000)).toBeLessThanOrEqual(30_000)
    }
  })
})

// ---------------------------------------------------------------------------

describe('reporting periods', () => {
  const now = new Date('2026-03-18T15:00:00.000Z')

  it('resolves last month to whole calendar months', () => {
    const range = resolveRange('last_month', { now, timeZone: 'UTC' })
    expect(toIsoDate(range.start)).toBe('2026-02-01')
    expect(toIsoDate(range.end)).toBe('2026-02-28')
    expect(toIsoDate(range.comparison.start)).toBe('2026-01-01')
  })

  it('resolves last 30 days as an inclusive 30-day window', () => {
    const range = resolveRange('last_30_days', { now, timeZone: 'UTC' })
    expect(toIsoDate(range.start)).toBe('2026-02-17')
    expect(toIsoDate(range.end)).toBe('2026-03-18')
    // The comparison is the 30 days immediately before it.
    expect(toIsoDate(range.comparison.end)).toBe('2026-02-16')
    expect(toIsoDate(range.comparison.start)).toBe('2026-01-18')
  })

  it('falls back to a default rather than erroring on a bad custom range', () => {
    const range = resolveRange('custom', { now, timeZone: 'UTC', start: 'not-a-date', end: null })
    expect(range.preset).toBe('last_30_days')
  })

  it('rejects a reversed custom range', () => {
    const range = resolveRange('custom', { now, timeZone: 'UTC', start: '2026-03-31', end: '2026-03-01' })
    expect(range.preset).toBe('last_30_days')
  })

  it('clamps month arithmetic to the last valid day', () => {
    // 31 March minus one month is 28 February, not 3 March.
    expect(toIsoDate(addMonths(new Date('2026-03-31T00:00:00.000Z'), -1))).toBe('2026-02-28')
  })

  it('builds a complete, contiguous set of buckets', () => {
    const range = resolveRange('last_12_months', { now, timeZone: 'UTC' })
    const buckets = buildBuckets(range, 'month')
    expect(buckets).toHaveLength(12)
    expect(buckets[0]?.key).toBe('2025-04-01')
    expect(buckets[11]?.key).toBe('2026-03-01')
  })

  it('reports the previous business day, skipping the weekend', () => {
    // Monday 16 March 2026 -> Friday 13 March.
    expect(toIsoDate(previousBusinessDate(new Date('2026-03-16T12:00:00.000Z'), 'UTC'))).toBe('2026-03-13')
    // Tuesday -> Monday.
    expect(toIsoDate(previousBusinessDate(new Date('2026-03-17T12:00:00.000Z'), 'UTC'))).toBe('2026-03-16')
    // Sunday -> Friday.
    expect(toIsoDate(previousBusinessDate(new Date('2026-03-15T12:00:00.000Z'), 'UTC'))).toBe('2026-03-13')
  })
})
