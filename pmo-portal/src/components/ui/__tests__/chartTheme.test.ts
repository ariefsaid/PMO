import { describe, it, expect } from 'vitest';
import { chartTheme } from '../chartTheme';

describe('chartTheme (token-derived recharts palette)', () => {
  it('derives axis/grid from DESIGN.md tokens (no invented colors)', () => {
    expect(chartTheme.axis).toBe('hsl(var(--muted-foreground))');
    expect(chartTheme.grid).toBe('hsl(var(--border))');
  });

  it('derives semantic series from the status/brand tokens', () => {
    expect(chartTheme.series.primary).toBe('hsl(var(--primary))');
    expect(chartTheme.series.success).toBe('hsl(var(--success))');
    expect(chartTheme.series.warning).toBe('hsl(var(--warning))');
    expect(chartTheme.series.destructive).toBe('hsl(var(--destructive))');
    expect(chartTheme.series.violet).toBe('hsl(var(--violet))');
  });

  it('exposes the de-rainbowed categorical palette (5 sanctioned hues, no cyan)', () => {
    expect(Array.isArray(chartTheme.categorical)).toBe(true);
    expect(chartTheme.categorical.length).toBeGreaterThanOrEqual(5);
    // Every categorical hue is an hsl() string (the frozen mockup series set).
    for (const c of chartTheme.categorical) {
      expect(c).toMatch(/^hsl\(/);
    }
    // C1 de-rainbow: the off-palette cyan is removed; the frozen set is
    // blue/violet/green/amber/red only — every entry must be one of these.
    const sanctioned = [
      'hsl(221 83% 53%)', // blue (primary family)
      'hsl(262 83% 58%)', // violet
      'hsl(142 71% 45%)', // green
      'hsl(43 96% 56%)', // amber
      'hsl(0 84% 60%)', // red
    ];
    expect(chartTheme.categorical).not.toContain('hsl(199 89% 48%)'); // cyan gone
    for (const c of chartTheme.categorical) {
      expect(sanctioned).toContain(c);
    }
  });
});
