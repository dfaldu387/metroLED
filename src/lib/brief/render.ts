import { env } from '../env'
import { formatCurrency, formatInteger } from '../format'
import type { BriefPayload } from './generate'

/**
 * Daily brief rendering.
 *
 * Produces a matching HTML and plain-text pair from the stored payload.
 *
 * Email HTML constraints applied here deliberately:
 *   - tables for layout, because Outlook ignores flexbox and grid;
 *   - inline styles only, because most clients strip <style> blocks;
 *   - no web fonts or images, so nothing has to be "downloaded" to be read;
 *   - a real plain-text alternative, not a stripped-tags approximation.
 */

const COLORS = {
  ink: '#0f172a',
  muted: '#475569',
  faint: '#64748b',
  border: '#e5e9f0',
  surface: '#ffffff',
  page: '#f8fafc',
  brand: '#1a56db',
  positive: '#047857',
  negative: '#b91c1c',
  warning: '#b45309',
  warningBg: '#fffbeb',
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function appUrl(path: string): string {
  return `${env().APP_URL.replace(/\/+$/, '')}${path}`
}

function formatBriefDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function renderBrief(payload: BriefPayload): { subject: string; html: string; text: string } {
  const dateLabel = formatBriefDate(payload.briefDate)
  const demoPrefix = payload.dataMode === 'demo' ? '[DEMO DATA] ' : ''

  const headline =
    payload.revenue.total > 0
      ? `${formatCurrency(payload.revenue.total)} invoiced`
      : 'No revenue invoiced'

  const subject = `${demoPrefix}MetroLED daily brief — ${dateLabel}: ${headline}`

  return { subject, html: renderHtml(payload, dateLabel), text: renderText(payload, dateLabel) }
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function section(title: string, body: string, actionHref?: string, actionLabel?: string): string {
  return `
  <tr>
    <td style="padding:0 24px 20px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
             style="border:1px solid ${COLORS.border};border-radius:10px;background:${COLORS.surface};">
        <tr>
          <td style="padding:16px 18px 10px 18px;border-bottom:1px solid ${COLORS.border};">
            <span style="font-size:14px;font-weight:600;color:${COLORS.ink};">${escapeHtml(title)}</span>
          </td>
        </tr>
        <tr><td style="padding:14px 18px 16px 18px;">${body}</td></tr>
        ${
          actionHref && actionLabel
            ? `<tr><td style="padding:0 18px 16px 18px;">
                 <a href="${actionHref}" style="font-size:13px;color:${COLORS.brand};text-decoration:none;font-weight:600;">${escapeHtml(actionLabel)} &rarr;</a>
               </td></tr>`
            : ''
        }
      </table>
    </td>
  </tr>`
}

function statRow(items: { label: string; value: string; tone?: 'default' | 'positive' | 'negative' }[]): string {
  const cells = items
    .map(
      (item) => `
      <td style="padding:0 12px 0 0;vertical-align:top;" width="${Math.floor(100 / items.length)}%">
        <div style="font-size:12px;color:${COLORS.faint};margin-bottom:4px;">${escapeHtml(item.label)}</div>
        <div style="font-size:19px;font-weight:600;color:${
          item.tone === 'negative' ? COLORS.negative : item.tone === 'positive' ? COLORS.positive : COLORS.ink
        };">${escapeHtml(item.value)}</div>
      </td>`,
    )
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${cells}</tr></table>`
}

function listTable(rows: string[][], headers: string[]): string {
  if (rows.length === 0) return ''
  const head = headers
    .map(
      (h, i) =>
        `<th align="${i === headers.length - 1 ? 'right' : 'left'}" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${COLORS.faint};padding:0 0 6px 0;font-weight:600;">${escapeHtml(h)}</th>`,
    )
    .join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell, i) =>
              `<td align="${i === row.length - 1 ? 'right' : 'left'}" style="font-size:13px;color:${COLORS.ink};padding:5px 0;border-top:1px solid ${COLORS.border};">${cell}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${head}</tr>${body}</table>`
}

function renderHtml(payload: BriefPayload, dateLabel: string): string {
  const parts: string[] = []

  // Revenue and cash
  const revenueBody =
    statRow([
      { label: 'Revenue invoiced', value: formatCurrency(payload.revenue.total) },
      { label: 'Invoices issued', value: formatInteger(payload.revenue.invoiceCount) },
      { label: 'Cash collected', value: formatCurrency(payload.cash.collected), tone: 'positive' },
    ]) +
    (payload.revenue.byDivision.length > 0
      ? `<div style="margin-top:14px;">${listTable(
          payload.revenue.byDivision.map((d) => [
            escapeHtml(d.name),
            `${formatInteger(d.invoiceCount)} inv.`,
            formatCurrency(d.revenue),
          ]),
          ['Division', 'Invoices', 'Revenue'],
        )}</div>`
      : `<div style="margin-top:12px;font-size:13px;color:${COLORS.muted};">No invoices were issued on this date.</div>`)
  parts.push(section('Yesterday: revenue and cash', revenueBody, appUrl('/revenue'), 'View revenue'))

  // Newly overdue
  const overdueBody =
    payload.receivables.newlyOverdue.length > 0
      ? `<div style="font-size:13px;color:${COLORS.muted};margin-bottom:10px;">
           <strong style="color:${COLORS.negative};">${formatCurrency(payload.receivables.newlyOverdueTotal)}</strong>
           became overdue on this date.
         </div>${listTable(
           payload.receivables.newlyOverdue.map((i) => [
             escapeHtml(i.customerName),
             `#${escapeHtml(i.docNumber)}`,
             formatCurrency(i.balance),
           ]),
           ['Customer', 'Invoice', 'Balance'],
         )}
         <div style="margin-top:12px;font-size:12px;color:${COLORS.faint};">
           Total overdue across all invoices: ${formatCurrency(payload.receivables.overdueAmount)}
           (${formatInteger(payload.receivables.overdueCount)} invoices).
         </div>`
      : `<div style="font-size:13px;color:${COLORS.muted};">Nothing became overdue on this date. Total overdue remains ${formatCurrency(payload.receivables.overdueAmount)} across ${formatInteger(payload.receivables.overdueCount)} invoices.</div>`
  parts.push(
    section('Newly overdue invoices', overdueBody, appUrl('/accounts-receivable?filter=overdue'), 'Review overdue invoices'),
  )

  // Stale quotes
  const quoteBody =
    payload.pipeline.newlyStale.length > 0
      ? `<div style="font-size:13px;color:${COLORS.muted};margin-bottom:10px;">
           <strong style="color:${COLORS.warning};">${formatCurrency(payload.pipeline.newlyStaleTotal)}</strong>
           of pipeline has had no activity for ${payload.pipeline.staleThresholdDays}+ days.
         </div>${listTable(
           payload.pipeline.newlyStale.map((q) => [
             escapeHtml(q.customerName),
             `${formatInteger(q.daysIdle)} days idle`,
             formatCurrency(q.amount),
           ]),
           ['Customer', 'Idle', 'Value'],
         )}`
      : `<div style="font-size:13px;color:${COLORS.muted};">No large quote has gone quiet. Open pipeline is ${formatCurrency(payload.pipeline.openValue)} across ${formatInteger(payload.pipeline.openCount)} quotes.</div>`
  parts.push(section('Large quotes becoming stale', quoteBody, appUrl('/sales-pipeline?filter=stale'), 'Review stale quotes'))

  // Shopify
  const shopifyBody = payload.ecommerce.available
    ? statRow([
        { label: 'Net sales', value: formatCurrency(payload.ecommerce.netSales) },
        { label: 'Orders', value: formatInteger(payload.ecommerce.orderCount) },
        {
          label: 'Average order',
          value:
            payload.ecommerce.averageOrderValue === null
              ? 'Not available'
              : formatCurrency(payload.ecommerce.averageOrderValue, { decimals: true }),
        },
      ]) +
      `<div style="margin-top:12px;font-size:12px;color:${COLORS.faint};">
         Store sales after discounts and refunds, excluding tax and shipping. Not the same basis as accounting revenue.
       </div>`
    : `<div style="font-size:13px;color:${COLORS.muted};">Shopify is not connected, so Eco LED Mart figures are unavailable.</div>`
  parts.push(section('Eco LED Mart (Shopify)', shopifyBody, appUrl('/ecommerce'), 'View e-commerce'))

  // Sync health
  const syncBody =
    `<div style="font-size:13px;color:${payload.sync.healthy ? COLORS.positive : COLORS.warning};margin-bottom:10px;font-weight:600;">
       ${escapeHtml(payload.sync.summary)}
     </div>` +
    listTable(
      payload.sync.sources.map((s) => [
        escapeHtml(s.displayName),
        s.status === 'ERROR'
          ? `<span style="color:${COLORS.negative};">Failing</span>`
          : s.isStale
            ? `<span style="color:${COLORS.warning};">Stale</span>`
            : `<span style="color:${COLORS.positive};">Healthy</span>`,
        escapeHtml(s.lastSuccessLabel),
      ]),
      ['Source', 'Status', 'Last success'],
    )
  parts.push(section('Data synchronisation health', syncBody, appUrl('/data-health'), 'View data health'))

  const warningBanner =
    payload.warnings.length > 0
      ? `<tr><td style="padding:0 24px 20px 24px;">
           <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                  style="background:${COLORS.warningBg};border:1px solid #fde68a;border-radius:10px;">
             <tr><td style="padding:14px 18px;">
               <div style="font-size:13px;font-weight:600;color:${COLORS.warning};margin-bottom:6px;">Please read before acting on these figures</div>
               <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#92400e;line-height:1.55;">
                 ${payload.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}
               </ul>
             </td></tr>
           </table>
         </td></tr>`
      : ''

  const generatedLabel = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: payload.timezone,
  }).format(new Date(payload.generatedAt))

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(`MetroLED daily brief - ${dateLabel}`)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  ${escapeHtml(`${formatCurrency(payload.revenue.total)} invoiced, ${formatCurrency(payload.receivables.overdueAmount)} overdue, ${formatCurrency(payload.pipeline.openValue)} open pipeline.`)}
</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.page};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;">

      <tr><td style="padding:0 24px 18px 24px;">
        <div style="font-size:12px;color:${COLORS.faint};letter-spacing:.04em;text-transform:uppercase;font-weight:600;">MetroLED Intelligence</div>
        <div style="font-size:22px;font-weight:700;color:${COLORS.ink};margin-top:5px;">Daily brief</div>
        <div style="font-size:14px;color:${COLORS.muted};margin-top:3px;">${escapeHtml(dateLabel)}</div>
        ${
          payload.dataMode === 'demo'
            ? `<div style="margin-top:10px;display:inline-block;background:#fef3c7;border:1px solid #fde68a;color:#92400e;font-size:12px;font-weight:600;padding:4px 9px;border-radius:5px;">DEMO DATA — not live business figures</div>`
            : ''
        }
      </td></tr>

      ${warningBanner}
      ${parts.join('')}

      <tr><td style="padding:4px 24px 0 24px;">
        <div style="border-top:1px solid ${COLORS.border};padding-top:14px;font-size:11.5px;color:${COLORS.faint};line-height:1.6;">
          Generated ${escapeHtml(generatedLabel)} (${escapeHtml(payload.timezone)}).<br>
          Revenue is invoiced sales excluding tax, by invoice date. Shopify net sales is a store figure on a
          different basis and is never added to accounting revenue.<br>
          <a href="${appUrl('/daily-brief')}" style="color:${COLORS.brand};text-decoration:none;">Open the daily brief in MetroLED Intelligence</a>
          &nbsp;&middot;&nbsp;
          <a href="${appUrl('/settings/brief')}" style="color:${COLORS.faint};text-decoration:underline;">Manage who receives this</a>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

function renderText(payload: BriefPayload, dateLabel: string): string {
  const lines: string[] = []
  const rule = '-'.repeat(60)

  lines.push('METROLED INTELLIGENCE — DAILY BRIEF')
  lines.push(dateLabel)
  if (payload.dataMode === 'demo') {
    lines.push('')
    lines.push('*** DEMO DATA — NOT LIVE BUSINESS FIGURES ***')
  }
  lines.push('')

  if (payload.warnings.length > 0) {
    lines.push('PLEASE READ BEFORE ACTING ON THESE FIGURES')
    for (const warning of payload.warnings) lines.push(`  - ${warning}`)
    lines.push('')
  }

  lines.push(rule)
  lines.push('YESTERDAY: REVENUE AND CASH')
  lines.push(rule)
  lines.push(`Revenue invoiced:  ${formatCurrency(payload.revenue.total)}`)
  lines.push(`Invoices issued:   ${formatInteger(payload.revenue.invoiceCount)}`)
  lines.push(`Cash collected:    ${formatCurrency(payload.cash.collected)}`)
  if (payload.revenue.byDivision.length > 0) {
    lines.push('')
    lines.push('By division:')
    for (const division of payload.revenue.byDivision) {
      lines.push(
        `  ${division.name.padEnd(26)} ${formatCurrency(division.revenue).padStart(14)}  (${division.invoiceCount} inv.)`,
      )
    }
  } else {
    lines.push('')
    lines.push('No invoices were issued on this date.')
  }
  lines.push('')

  lines.push(rule)
  lines.push('NEWLY OVERDUE INVOICES')
  lines.push(rule)
  if (payload.receivables.newlyOverdue.length > 0) {
    lines.push(`${formatCurrency(payload.receivables.newlyOverdueTotal)} became overdue on this date.`)
    lines.push('')
    for (const invoice of payload.receivables.newlyOverdue) {
      lines.push(
        `  ${invoice.customerName.slice(0, 32).padEnd(33)} #${invoice.docNumber.padEnd(10)} ${formatCurrency(invoice.balance)}`,
      )
    }
  } else {
    lines.push('Nothing became overdue on this date.')
  }
  lines.push('')
  lines.push(
    `Total overdue: ${formatCurrency(payload.receivables.overdueAmount)} across ${formatInteger(payload.receivables.overdueCount)} invoices.`,
  )
  lines.push(`Total outstanding: ${formatCurrency(payload.receivables.totalOutstanding)}`)
  lines.push('')

  lines.push(rule)
  lines.push(`LARGE QUOTES BECOMING STALE (${payload.pipeline.staleThresholdDays}+ DAYS IDLE)`)
  lines.push(rule)
  if (payload.pipeline.newlyStale.length > 0) {
    lines.push(`${formatCurrency(payload.pipeline.newlyStaleTotal)} of pipeline has gone quiet.`)
    lines.push('')
    for (const q of payload.pipeline.newlyStale) {
      lines.push(
        `  ${q.customerName.slice(0, 32).padEnd(33)} ${String(q.daysIdle).padStart(3)}d idle  ${formatCurrency(q.amount)}`,
      )
    }
  } else {
    lines.push('No large quote has gone quiet.')
  }
  lines.push('')
  lines.push(
    `Open pipeline: ${formatCurrency(payload.pipeline.openValue)} across ${formatInteger(payload.pipeline.openCount)} quotes (unweighted).`,
  )
  lines.push('')

  lines.push(rule)
  lines.push('ECO LED MART (SHOPIFY)')
  lines.push(rule)
  if (payload.ecommerce.available) {
    lines.push(`Net sales:      ${formatCurrency(payload.ecommerce.netSales)}`)
    lines.push(`Orders:         ${formatInteger(payload.ecommerce.orderCount)}`)
    lines.push(
      `Average order:  ${payload.ecommerce.averageOrderValue === null ? 'Not available' : formatCurrency(payload.ecommerce.averageOrderValue, { decimals: true })}`,
    )
    lines.push('')
    lines.push('Store sales after discounts and refunds, excluding tax and shipping.')
    lines.push('This is not the same basis as accounting revenue and is never added to it.')
  } else {
    lines.push('Shopify is not connected, so these figures are unavailable.')
  }
  lines.push('')

  lines.push(rule)
  lines.push('DATA SYNCHRONISATION HEALTH')
  lines.push(rule)
  lines.push(payload.sync.summary)
  lines.push('')
  for (const source of payload.sync.sources) {
    const status = source.status === 'ERROR' ? 'FAILING' : source.isStale ? 'STALE' : 'HEALTHY'
    lines.push(`  ${source.displayName.padEnd(26)} ${status.padEnd(8)} last success ${source.lastSuccessLabel}`)
    if (source.errorMessage) lines.push(`      ${source.errorMessage}`)
  }
  lines.push('')

  lines.push(rule)
  lines.push(`Open in MetroLED Intelligence: ${appUrl('/daily-brief')}`)
  lines.push(`Manage recipients:             ${appUrl('/settings/brief')}`)
  lines.push('')
  lines.push(
    `Generated ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: payload.timezone }).format(new Date(payload.generatedAt))} (${payload.timezone}).`,
  )
  lines.push('Revenue is invoiced sales excluding tax, by invoice date.')

  return lines.join('\n')
}

export { formatBriefDate }
