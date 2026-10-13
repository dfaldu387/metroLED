import type { DataMode } from './types'

/** Banner copy for the non-live data modes. */
export function describeDataMode(mode: DataMode): { title: string; detail: string } | null {
  switch (mode) {
    case 'demo':
      return {
        title: 'Demo data — not live business figures',
        detail:
          'Every number on this screen comes from a generated sample dataset so the interface can be reviewed before the QuickBooks, Method CRM and Shopify connections are live. Nothing here reflects actual MetroLED performance.',
      }
    case 'unavailable':
      return {
        title: 'Business data is not available',
        detail:
          'The reporting database is reachable but holds no imported records, or it could not be reached. Connect the data sources on the Data Health page, then run a sync.',
      }
    default:
      return null
  }
}
