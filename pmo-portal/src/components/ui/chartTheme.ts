/**
 * Recharts theming helper — every chart color derives from a DESIGN.md token
 * (so charts inherit the One-Blue / status palette), including the calm
 * categorical set which now resolves through existing text/status tokens rather
 * than raw HSL literals.
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
   * Calm categorical palette for multi-series charts (KPI/legend/timeline).
   * Every hue resolves through an existing semantic token so dark mode keeps a
   * contrast-safe, non-rainbow series set without hardcoded literals.
   */
  categorical: [
    'hsl(var(--primary-text))',
    'hsl(var(--violet))',
    'hsl(var(--success-text))',
    'hsl(var(--warning-icon))',
    'hsl(var(--destructive-text))',
  ],
} as const;

export type ChartTheme = typeof chartTheme;

/** Tint percentage for status bar fills — the Tinted-Status Rule (~12-18%). */
export const STATUS_BAR_TINT = 18;

/**
 * Tints a resolvable status-hue color string (`hsl(var(--token))`) to the
 * Tinted-Status fill used for status-bar charts — the bar's MEANING is its
 * status, so it carries the status's own hue, TINTED (never a fully-saturated
 * categorical fill, never the One-Blue action color). Uses color-mix so it
 * stays on-token (no raw hex) and resolves against :root at render time. The
 * solid hue is kept for the legend dot, mirroring the StatusPill dot+tint
 * pattern.
 */
export function tintStatusFill(color: string, tint: number = STATUS_BAR_TINT): string {
  return `color-mix(in srgb, ${color} ${tint}%, hsl(var(--card)))`;
}
