/**
 * Recharts theming helper — every chart color derives from a DESIGN.md token
 * (so charts inherit the One-Blue / status palette), except the `categorical`
 * array, which is the mockup's FROZEN series set (Open Question 2: kept as
 * sanctioned non-interactive literals, pending promotion to chart-* tokens).
 *
 * Consume as `stroke={chartTheme.series.primary}` etc. The values are CSS
 * `hsl(var(--token))` strings, so they resolve against :root at render time
 * and stay in lockstep with the token pipeline.
 */
export const chartTheme = {
  /** Axis labels / ticks — de-emphasized text. */
  axis: 'hsl(var(--muted-foreground))',
  /** Grid lines / reference rules — the single border value. */
  grid: 'hsl(var(--border))',
  /** Semantic series, derived from brand + status tokens. */
  series: {
    primary: 'hsl(var(--primary))',
    success: 'hsl(var(--success))',
    warning: 'hsl(var(--warning))',
    destructive: 'hsl(var(--destructive))',
    violet: 'hsl(var(--violet))',
  },
  /**
   * Frozen categorical palette for multi-series charts (KPI/legend/timeline).
   * These are the only sanctioned chart literals — taken verbatim from the
   * mockup so the identity is preserved; do NOT invent new chart colors.
   *
   * C1 de-rainbow (2026-06-07): the off-palette cyan (`hsl(199 89% 48%)`) was
   * removed — it maps to no DESIGN.md token and read as the "AI rainbow" the
   * audit flagged. The frozen set is now blue/violet/green/amber/red only. Use
   * `series.*` for status/brand meaning; reach for `categorical` only when a
   * chart genuinely needs >1 non-status hue.
   */
  categorical: [
    'hsl(221 83% 53%)', // blue (primary family)
    'hsl(262 83% 58%)', // violet
    'hsl(142 71% 45%)', // green
    'hsl(43 96% 56%)', // amber
    'hsl(0 84% 60%)', // red
  ],
} as const;

export type ChartTheme = typeof chartTheme;
