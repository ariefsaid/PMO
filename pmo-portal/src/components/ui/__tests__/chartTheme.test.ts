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

  it('exposes the frozen categorical palette (sanctioned literals, not tokens)', () => {
    expect(Array.isArray(chartTheme.categorical)).toBe(true);
    expect(chartTheme.categorical.length).toBeGreaterThanOrEqual(5);
    // Every categorical hue is an hsl() string (the frozen mockup series set).
    for (const c of chartTheme.categorical) {
      expect(c).toMatch(/^hsl\(/);
    }
  });
});
