/**
 * Parsing of the QuickBooks Profit and Loss report.
 *
 * The report API returns a nested tree: sections (Income, Cost of Goods Sold,
 * Expenses) containing account rows, which may themselves be sections when the
 * account has sub-accounts. With `summarize_column_by=Classes` every money
 * column is one class, plus "Not Specified" and "TOTAL".
 *
 * Only `Data` rows are summed. A parent account's own postings appear as a
 * Data row inside its section, and the section Summary repeats the children,
 * so counting Summary rows would double-count.
 */

export interface PlReport {
  Columns?: { Column?: { ColTitle?: string; ColType?: string; MetaData?: { Name?: string; Value?: string }[] }[] }
  Rows?: PlRows
}

interface PlRows {
  Row?: PlRow[]
}

interface PlRow {
  type?: string
  group?: string
  ColData?: { value?: string; id?: string }[]
  Header?: { ColData?: { value?: string; id?: string }[] }
  Rows?: PlRows
  Summary?: { ColData?: { value?: string }[] }
}

export interface PlClassColumn {
  /** QuickBooks class id, or `null` for the "Not Specified" column. */
  classId: string | null
  title: string
  index: number
}

export interface PlAccountAmount {
  accountId: string
  accountName: string
  classId: string | null
  classTitle: string
  amount: number
}

/** The class columns of a report summarised by class; the TOTAL column is dropped. */
export function classColumns(report: PlReport): PlClassColumn[] {
  const columns = report.Columns?.Column ?? []
  const out: PlClassColumn[] = []
  columns.forEach((column, index) => {
    if (column.ColType !== 'Money') return
    const key = column.MetaData?.find((m) => m.Name === 'ColKey')?.Value ?? ''
    if (key === 'total') return
    out.push({
      classId: key === 'not_specified' || key === '' ? null : key,
      title: column.ColTitle?.trim() || 'Not specified',
      index,
    })
  })
  return out
}

function parseMoney(value: string | undefined): number {
  if (!value) return 0
  const n = Number(value.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Amounts per (account, class) for the accounts in `accountIds`. Rows for any
 * other account are ignored, so operating expenses never leak into the cost
 * basis even though the report lists them.
 */
export function accountAmountsByClass(report: PlReport, accountIds: ReadonlySet<string>): PlAccountAmount[] {
  const columns = classColumns(report)
  const out: PlAccountAmount[] = []

  const walk = (rows: PlRows | undefined) => {
    for (const row of rows?.Row ?? []) {
      if (row.type === 'Data' && row.ColData) {
        const first = row.ColData[0]
        const id = first?.id
        if (id && accountIds.has(id)) {
          for (const column of columns) {
            const amount = parseMoney(row.ColData[column.index]?.value)
            if (amount === 0) continue
            out.push({
              accountId: id,
              accountName: first?.value?.trim() || `Account ${id}`,
              classId: column.classId,
              classTitle: column.title,
              amount: Math.round(amount * 100) / 100,
            })
          }
        }
      }
      if (row.Rows) walk(row.Rows)
    }
  }
  walk(report.Rows)
  return out
}
