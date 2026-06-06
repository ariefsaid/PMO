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
   */
  categorical: [
    'hsl(221 83% 53%)', // blue (primary family)
    'hsl(262 83% 58%)', // violet
    'hsl(142 71% 45%)', // green
    'hsl(43 96% 56%)', // amber
    'hsl(199 89% 48%)', // cyan
    'hsl(0 84% 60%)', // red
  ],
} as const;

export type ChartTheme = typeof chartTheme;
