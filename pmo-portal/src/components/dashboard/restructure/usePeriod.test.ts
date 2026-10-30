import { describe, expect, it } from 'vitest';
import { resolvePeriod, updatePeriodParams } from './usePeriod';

const translate = (_key: string, fallback: string) => fallback;

describe('dashboard period URL state', () => {
  it('defaults to year to date using the organization calendar day', () => {
    const period = resolvePeriod(new URLSearchParams(), '2026-10-27', translate);

    expect(period).toMatchObject({ key: 'ytd', from: '2026-01', to: '2026-10' });
    expect(period.label).toBe('Year to date · Jan–Oct 2026');
  });

  it('parses valid custom month bounds and normalizes unsupported periods to year to date', () => {
    const custom = resolvePeriod(new URLSearchParams('period=custom&from=2026-02&to=2026-04'), '2026-10-27', translate);
    const invalid = resolvePeriod(new URLSearchParams('period=week'), '2026-10-27', translate);

    expect(custom).toMatchObject({ key: 'custom', from: '2026-02', to: '2026-04' });
    expect(invalid).toMatchObject({ key: 'ytd', from: '2026-01', to: '2026-10' });
  });

  it('serializes picker changes without dropping layout and tab URL state', () => {
    const next = updatePeriodParams(new URLSearchParams('layout=b&tab=delivery'), {
      key: 'custom', from: '2026-03', to: '2026-05',
    });

    expect(next.get('layout')).toBe('b');
    expect(next.get('tab')).toBe('delivery');
    expect(next.get('period')).toBe('custom');
    expect(next.get('from')).toBe('2026-03');
    expect(next.get('to')).toBe('2026-05');
  });

  it('removes custom month bounds when selecting a preset', () => {
    const next = updatePeriodParams(new URLSearchParams('layout=a&period=custom&from=2026-03&to=2026-05'), {
      key: 'month', from: '2026-10', to: '2026-10',
    });

    expect(next.get('period')).toBe('month');
    expect(next.has('from')).toBe(false);
    expect(next.has('to')).toBe(false);
  });
});
