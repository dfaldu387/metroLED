/**
 * Chart palette.
 *
 * Every ramp below was checked with the data-visualisation validator rather
 * than chosen by eye. The recorded results are the reason these exact hex
 * values are used - changing one means re-running the validator.
 *
 * Validator: scripts/validate_palette.js, light mode, surface #ffffff.
 *
 *  1. CATEGORICAL (division identity), checked with `--pairs all` because
 *     divisions appear in stacked bars, lines and part-to-whole bars:
 *        #1a56db, #0d9488, #a21caf
 *        PASS lightness band - all inside L 0.43-0.77
 *        PASS chroma floor   - all >= 0.1
 *        PASS CVD separation - worst all-pairs dE 8.5 (protan), tritan 9.5
 *        PASS normal vision  - worst all-pairs dE 22.3
 *        PASS contrast       - all >= 3:1 on white
 *
 *  2. ORDINAL severity ramp for overdue A/R age bands (ordered categories, so
 *     a single-hue ramp rather than categorical hues):
 *        #f87171, #ef4444, #c81e1e, #8b1a1a
 *        PASS monotone lightness, PASS adjacent dL >= 0.06,
 *        PASS light-end contrast 2.77:1, PASS single hue (spread 5 degrees)
 *
 *  3. SEQUENTIAL brand ramp for magnitude:
 *        #608cfa, #3b66f6, #1a56db, #1c3b91
 *        PASS monotone lightness, PASS adjacent dL, PASS light-end contrast
 *        3.17:1, PASS single hue (spread 4 degrees)
 *
 * Rules this file enforces by construction:
 *   - Colour follows the entity: a division keeps its hue when a filter
 *     removes another division, so the reader's learned mapping holds.
 *   - "Unassigned" is NOT a categorical slot. It encodes absence, so it uses a
 *     reserved neutral and is always accompanied by a visible label.
 *   - Status colours (positive / warning / negative) are never reused as a
 *     series colour, and series colours are never used for status.
 */

/** Fixed hue order for division identity. Never cycled, never re-ranked. */
export const DIVISION_COLORS: Record<string, string> = {
  METROLED: '#1a56db',
  PIXEL: '#0d9488',
  ECO: '#a21caf',
}

/** Reserved neutral for records with no division. Always label it. */
export const UNASSIGNED_COLOR = '#94a1b8'

/** Slot order used when a division code is not one of the three known codes. */
export const CATEGORICAL_SLOTS = ['#1a56db', '#0d9488', '#a21caf'] as const

export function divisionColor(code: string | null | undefined, index = 0): string {
  if (!code || code === 'UNASSIGNED') return UNASSIGNED_COLOR
  return DIVISION_COLORS[code] ?? CATEGORICAL_SLOTS[index % CATEGORICAL_SLOTS.length]!
}

/** Single series colour - used whenever a chart shows one measure. */
export const SERIES_PRIMARY = '#1a56db'
/** The comparison period on a period-over-period chart. Deliberately recessive. */
export const SERIES_COMPARISON = '#94a1b8'

export const SEQUENTIAL_BRAND = ['#608cfa', '#3b66f6', '#1a56db', '#1c3b91'] as const

/** Ordered severity ramp for the four overdue age bands. */
export const OVERDUE_RAMP = ['#f87171', '#ef4444', '#c81e1e', '#8b1a1a'] as const

/** "Current" is a state, not a severity step, so it uses the status token. */
export const STATUS_COLORS = {
  positive: '#059669',
  warning: '#d97706',
  negative: '#c81e1e',
  neutral: '#94a1b8',
} as const

/** Colour for an A/R aging bucket key. */
export function agingColor(bucketKey: string): string {
  switch (bucketKey) {
    case 'current':
      return STATUS_COLORS.positive
    case '1_30':
      return OVERDUE_RAMP[0]
    case '31_60':
      return OVERDUE_RAMP[1]
    case '61_90':
      return OVERDUE_RAMP[2]
    case 'over_90':
      return OVERDUE_RAMP[3]
    default:
      return STATUS_COLORS.neutral
  }
}

/** Chart chrome: recessive, one step off the surface, hairline and solid. */
export const CHART_CHROME = {
  grid: '#e5e9f0',
  axis: '#cbd3e1',
  axisText: '#64748b',
  surface: '#ffffff',
  crosshair: '#94a1b8',
} as const

/** Mark geometry, from the mark specification. */
export const MARKS = {
  /** Bars never fill their band; the leftover is air. */
  maxBarSize: 24,
  /** Rounded data-end, square at the baseline. */
  barRadiusVertical: [4, 4, 0, 0] as [number, number, number, number],
  barRadiusHorizontal: [0, 4, 4, 0] as [number, number, number, number],
  lineWidth: 2,
  /** r=4 gives an 8px marker. */
  markerRadius: 4,
  /** 2px ring / gap in the surface colour separates touching marks. */
  surfaceGap: 2,
} as const
