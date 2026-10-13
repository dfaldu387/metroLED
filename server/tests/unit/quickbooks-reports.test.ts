import { describe, expect, it } from 'vitest'
import { accountAmountsByClass, classColumns, type PlReport } from '@/lib/integrations/quickbooks-reports'

/**
 * Parsing the QuickBooks Profit and Loss report summarised by class.
 *
 * The fixture mirrors the real shape: a "TOTAL" column that must be dropped, a
 * "Not Specified" column for unclassed postings, nested sub-accounts, and a
 * Summary row that repeats its children and must not be double-counted.
 */

const REPORT: PlReport = {
  Columns: {
    Column: [
      { ColTitle: '', ColType: 'Account', MetaData: [{ Name: 'ColKey', Value: 'account' }] },
      { ColTitle: 'Eco LED Mart', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: '733382' }] },
      { ColTitle: 'MetroLED', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: '733380' }] },
      { ColTitle: 'Not Specified', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: 'not_specified' }] },
      { ColTitle: 'TOTAL', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: 'total' }] },
    ],
  },
  Rows: {
    Row: [
      {
        type: 'Section',
        group: 'COGS',
        Header: { ColData: [{ value: 'Cost of Goods Sold' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }] },
        Rows: {
          Row: [
            {
              type: 'Data',
              ColData: [
                { value: 'Cost of Goods Sold', id: '80' },
                { value: '40.00' },
                { value: '20.00' },
                { value: '405.00' },
                { value: '465.00' },
              ],
            },
          ],
        },
        Summary: {
          ColData: [{ value: 'Total Cost of Goods Sold' }, { value: '40.00' }, { value: '20.00' }, { value: '405.00' }, { value: '465.00' }],
        },
      },
      {
        type: 'Section',
        group: 'Expenses',
        Header: { ColData: [{ value: 'Expenses' }] },
        Rows: {
          Row: [
            {
              type: 'Data',
              // An operating expense: never part of the cost basis.
              ColData: [{ value: 'Advertising', id: '7' }, { value: '100.00' }, { value: '' }, { value: '' }, { value: '100.00' }],
            },
          ],
        },
      },
    ],
  },
}

describe('classColumns', () => {
  it('returns the class columns and drops the TOTAL column', () => {
    const columns = classColumns(REPORT)
    expect(columns.map((c) => c.classId)).toEqual(['733382', '733380', null])
    expect(columns.map((c) => c.title)).toEqual(['Eco LED Mart', 'MetroLED', 'Not Specified'])
  })
})

describe('accountAmountsByClass', () => {
  it('sums only the included accounts, per class, ignoring zero cells', () => {
    const amounts = accountAmountsByClass(REPORT, new Set(['80']))
    expect(amounts).toEqual([
      { accountId: '80', accountName: 'Cost of Goods Sold', classId: '733382', classTitle: 'Eco LED Mart', amount: 40 },
      { accountId: '80', accountName: 'Cost of Goods Sold', classId: '733380', classTitle: 'MetroLED', amount: 20 },
      { accountId: '80', accountName: 'Cost of Goods Sold', classId: null, classTitle: 'Not Specified', amount: 405 },
    ])
  })

  it('excludes accounts that are not flagged as direct cost', () => {
    const amounts = accountAmountsByClass(REPORT, new Set(['80']))
    expect(amounts.some((a) => a.accountId === '7')).toBe(false)
  })

  it('returns nothing when no account is included', () => {
    expect(accountAmountsByClass(REPORT, new Set())).toEqual([])
  })
})
