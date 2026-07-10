/**
 * Pure helpers for AgentCostMetrics — kept out of the component file so exporting them for unit
 * tests doesn't trip react-refresh/only-export-components.
 */

/**
 * Parse a `month` bucket to a UTC epoch. Postgres `date_trunc('month')::date` yields 'YYYY-MM-DD'
 * (tolerate 'YYYY-MM' too). Parsed as UTC so the epoch matches the chart's UTC axis formatter —
 * a date-only string parsed as LOCAL midnight would shift every label by a month for users east of
 * UTC (code-quality review: Jakarta rendered 2026-06 as "May 26").
 */
export function monthToUtcEpoch(month: string): number {
  const iso = month.length === 7 ? `${month}-01T00:00:00Z` : `${month}T00:00:00Z`;
  return new Date(iso).getTime();
}
