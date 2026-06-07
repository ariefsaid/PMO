import { describe, it, expect } from 'vitest';
import { Constants } from '@/src/lib/supabase/database.types';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { procurementStatusTone } from './procurementStatusTone';

const SERIES_VALUES = Object.values(chartTheme.series);

describe('procurementStatusTone (new AC — chart status-tone)', () => {
  it('maps every real ProcurementStatus enum value to a defined chartTheme.series token', () => {
    for (const status of Constants.public.Enums.procurement_status) {
      const tone = procurementStatusTone(status);
      expect(SERIES_VALUES).toContain(tone);
    }
  });

  it('does not map every status to the same (all-green) token — the bug under fix', () => {
    const tones = new Set(
      Constants.public.Enums.procurement_status.map((s) => procurementStatusTone(s)),
    );
    expect(tones.size).toBeGreaterThan(1);
    // Paid (terminal-good) is success; Rejected (bad) must NOT also be success.
    expect(procurementStatusTone('Paid')).toBe(chartTheme.series.success);
    expect(procurementStatusTone('Rejected')).toBe(chartTheme.series.destructive);
    expect(procurementStatusTone('Rejected')).not.toBe(procurementStatusTone('Paid'));
  });

  it('C1: Draft maps to primary (was violet) — at most 4 status hues, no categorical violet', () => {
    // Draft is "not-yet-started" (in-flight default), not a category — it must
    // use the blue primary, not the categorical violet (5th hue = the rainbow).
    expect(procurementStatusTone('Draft')).toBe(chartTheme.series.primary);
    // Preserve the meaning-carrying status mappings.
    expect(procurementStatusTone('Received')).toBe(chartTheme.series.success);
    expect(procurementStatusTone('Ordered')).toBe(chartTheme.series.primary);
    expect(procurementStatusTone('Requested')).toBe(chartTheme.series.warning);
    expect(procurementStatusTone('Cancelled')).toBe(chartTheme.series.destructive);
    // No status maps to the categorical violet anymore (≤4 hues on the chart).
    const tones = new Set(
      Constants.public.Enums.procurement_status.map((s) => procurementStatusTone(s)),
    );
    expect(tones.has(chartTheme.series.violet)).toBe(false);
    expect(tones.size).toBeLessThanOrEqual(4);
  });
});
