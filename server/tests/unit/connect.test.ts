import { describe, expect, it, beforeAll } from 'vitest'
import { normalizeShopDomain } from '@/lib/integrations/connect'
import { oauthReturnPath } from '@/lib/oauth-state'

/**
 * Connecting a source from the Data Health page.
 *
 * The pure pieces: what the administrator may paste as a shop domain, and
 * where the QuickBooks OAuth callback is allowed to send the browser back to.
 */

beforeAll(() => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'test-session-secret-at-least-16-chars'
})

describe('normalizeShopDomain', () => {
  it('accepts the bare store handle', () => {
    expect(normalizeShopDomain('eco-led-mart')).toBe('eco-led-mart.myshopify.com')
  })

  it('accepts the full myshopify host, trimming and lower-casing', () => {
    expect(normalizeShopDomain('  Eco-LED-Mart.MyShopify.com ')).toBe('eco-led-mart.myshopify.com')
  })

  it('strips a scheme, path, query and fragment', () => {
    expect(normalizeShopDomain('https://eco-led-mart.myshopify.com/admin/settings?x=1#y')).toBe(
      'eco-led-mart.myshopify.com',
    )
  })

  it('rejects hosts that are not myshopify.com', () => {
    expect(normalizeShopDomain('ecoledmart.com')).toBeNull()
    expect(normalizeShopDomain('eco-led-mart.myshopify.com.evil.example')).toBeNull()
    expect(normalizeShopDomain('shopify.com')).toBeNull()
  })

  it('rejects empty and malformed input', () => {
    expect(normalizeShopDomain('')).toBeNull()
    expect(normalizeShopDomain('   ')).toBeNull()
    expect(normalizeShopDomain('-bad.myshopify.com')).toBeNull()
    expect(normalizeShopDomain('has space.myshopify.com')).toBeNull()
  })
})

describe('oauthReturnPath', () => {
  it('returns Data Health by default', () => {
    expect(oauthReturnPath(null)).toBe('/data-health')
    expect(oauthReturnPath(undefined)).toBe('/data-health')
    expect(oauthReturnPath('')).toBe('/data-health')
  })

  it('maps the known hints', () => {
    expect(oauthReturnPath('data-health')).toBe('/data-health')
    expect(oauthReturnPath('settings')).toBe('/settings/integrations')
  })

  it('never redirects anywhere else (open-redirect guard)', () => {
    expect(oauthReturnPath('https://evil.example')).toBe('/data-health')
    expect(oauthReturnPath('//evil.example')).toBe('/data-health')
    expect(oauthReturnPath('/users')).toBe('/data-health')
  })
})
