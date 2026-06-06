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
});
