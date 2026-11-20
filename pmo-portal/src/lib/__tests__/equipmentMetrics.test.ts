import { describe, expect, it } from 'vitest';
import {
  computeEquipmentMetrics,
  type EquipmentStatus,
  type StatusDay,
  type UsageEntry,
} from '../equipmentMetrics';

// Hand calculation (spec): 30-day month, 8 working h/day; days 1-20 ready, 21-23 broken, 24-30 ready;
// approved work 80 h. Available 27/30 = 90.0 %; utilisation 80 / (27 x 8 = 216) = 37.0 %.
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;
function month(over: Partial<Record<number, EquipmentStatus>> = {}): StatusDay[] {
  const out: StatusDay[] = [];
  for (let n = 1; n <= 30; n++) {
    const status: EquipmentStatus | undefined =
      n in over ? over[n] : n >= 21 && n <= 23 ? 'broken' : 'ready';
    if (status) out.push({ date: day(n), status });
  }
  return out;
}
const work = (hours: string, status: UsageEntry['status'] = 'Approved', date = day(5)): UsageEntry => ({
  date, quantity: hours, unit: 'hours', kind: 'work', status,
});
const base = { from: day(1), to: day(30), workingHoursPerDay: '8' };

describe('computeEquipmentMetrics', () => {
  it('AC-EAV-001 the test month gives 90.0% availability and 37.0% utilisation, and the day table sums to it', () => {
    const m = computeEquipmentMetrics({ ...base, statuses: month(), usage: [work('80')] });
    expect(m.availabilityPct).toBe('90.0');
    expect(m.utilisationPct).toBe('37.0');
    expect(m.availableDays).toBe(27);
    expect(m.inServiceDays).toBe(30);
    expect(m.days).toHaveLength(30);
    expect(m.days.filter((d) => d.available).length).toBe(27);
    expect(m.unrecordedDays).toBe(0);
  });

  it('AC-EAV-002 unrecorded days leave both terms and are counted', () => {
    // days 1-3 unrecorded: available 24 of 27 recorded = 88.9 %; utilisation 80 / (24 x 8) = 41.7 %
    const m = computeEquipmentMetrics({ ...base, statuses: month({ 1: undefined, 2: undefined, 3: undefined }), usage: [work('80')] });
    expect(m.unrecordedDays).toBe(3);
    expect(m.inServiceDays).toBe(27);
    expect(m.availableDays).toBe(24);
    expect(m.availabilityPct).toBe('88.9');
    expect(m.utilisationPct).toBe('41.7');
  });

  it('AC-EAV-002 excludes work on unrecorded days from utilisation', () => {
    const m = computeEquipmentMetrics({ from: day(1), to: day(2), workingHoursPerDay: '8', statuses: [{ date: day(1), status: 'ready' }], usage: [work('8', 'Approved', day(2))] });
    expect(m.utilisationPct).toBe('0.0');
  });

  it('AC-EAV-011 only Approved usage counts; pending usage is named', () => {
    const m = computeEquipmentMetrics({
      ...base,
      statuses: month(),
      usage: [work('80'), work('40', 'Submitted'), work('8', 'Draft'), work('8', 'Rejected')],
    });
    expect(m.utilisationPct).toBe('37.0');
    expect(m.pendingUsageEntries).toBe(2); // Submitted + Draft await a decision; Rejected is not pending
  });

  it('standby counts as available but not as utilised; unit days converts at working hours per day', () => {
    const statuses = month({ 1: 'standby' });
    const usage: UsageEntry[] = [
      { date: day(2), quantity: '1', unit: 'days', kind: 'work', status: 'Approved' },
      { date: day(3), quantity: '8', unit: 'hours', kind: 'standby', status: 'Approved' },
    ];
    const m = computeEquipmentMetrics({ ...base, statuses, usage });
    expect(m.availableDays).toBe(27);
    expect(m.utilisationPct).toBe('3.7'); // 8 / 216
  });

  it('a period before the in-service date is outside both terms', () => {
    const m = computeEquipmentMetrics({ ...base, inServiceOn: day(11), statuses: month(), usage: [] });
    expect(m.inServiceDays).toBe(20);
    expect(m.availableDays).toBe(17);
    expect(m.availabilityPct).toBe('85.0');
  });

  it('nothing recorded yields null percentages, not zero', () => {
    const m = computeEquipmentMetrics({ ...base, statuses: [], usage: [work('8')] });
    expect(m.availabilityPct).toBeNull();
    expect(m.utilisationPct).toBeNull();
    expect(m.unrecordedDays).toBe(30);
  });

  it('weeks start on Monday and each grain sums to the same figures', () => {
    const m = computeEquipmentMetrics({ ...base, statuses: month(), usage: [work('80')] });
    const weeks = m.byGrain('week');
    expect(weeks[0].start).toBe('2026-10-26'); // 2026-11-01 is a Sunday
    expect(weeks.reduce((s, w) => s + w.availableDays, 0)).toBe(27);
    expect(m.byGrain('month')).toHaveLength(1);
    expect(m.byGrain('month')[0].availabilityPct).toBe('90.0');
  });
});
