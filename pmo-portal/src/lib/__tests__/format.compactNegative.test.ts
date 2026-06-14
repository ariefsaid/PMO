/**
 * AC-W2-9-01: formatCompactCurrency compacts negative magnitudes correctly.
 *
 * Current behavior: `formatCompactCurrency(-1_500_000)` returns `-$1,500,000`
 * (the `>= 1_000_000` branch tests the raw value, which is negative, so no branch
 * matches and it falls through to formatCurrency, producing the non-compact form).
 *
 * Fixed behavior: compact on Math.abs(value) then re-apply the sign prefix.
 * `-$1.5M`, `-$2.0K`, positives unchanged.
 */
import { describe, it, expect } from 'vitest';
import { formatCompactCurrency } from '../format';

describe('AC-W2-9-01: formatCompactCurrency — negative magnitudes compact correctly', () => {
  it('compacts negative millions: -1_500_000 → "-$1.5M"', () => {
    expect(formatCompactCurrency(-1_500_000)).toBe('-$1.5M');
  });

  it('compacts negative millions: -2_000_000 → "-$2.0M"', () => {
    expect(formatCompactCurrency(-2_000_000)).toBe('-$2.0M');
  });

  it('compacts negative thousands: -2_000 → "-$2.0K"', () => {
    expect(formatCompactCurrency(-2_000)).toBe('-$2.0K');
  });

  it('compacts negative thousands: -500_000 → "-$500.0K"', () => {
    expect(formatCompactCurrency(-500_000)).toBe('-$500.0K');
  });

  it('falls through to formatCurrency for small negatives: -500 → "-$500" (no compact)', () => {
    // Values < 1000 magnitude fall through to formatCurrency.
    // formatCurrency(-500) produces "-$500".
    const result = formatCompactCurrency(-500);
    expect(result).toMatch(/-\$500/);
  });

  it('positive millions unchanged: 1_500_000 → "$1.5M"', () => {
    expect(formatCompactCurrency(1_500_000)).toBe('$1.5M');
  });

  it('positive thousands unchanged: 200_000 → "$200.0K"', () => {
    expect(formatCompactCurrency(200_000)).toBe('$200.0K');
  });

  it('positive small unchanged: 500 → "$500"', () => {
    const result = formatCompactCurrency(500);
    expect(result).toMatch(/\$500/);
  });
});
