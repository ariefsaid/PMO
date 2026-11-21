import { describe, expect, it } from 'vitest';
import { averageMinutes, medianMinutes, responseMinutes, splitMinutes, vendorResponseSummary } from '../vendorResponse';

const r = (vendorId: string, responseMinutes: number | null) => ({ vendorId, responseMinutes });

describe('vendorResponse (#2702)', () => {
  it('AC-EVR-008 three responses and one awaiting: counts, median, average, slowest', () => {
    const [s] = vendorResponseSummary([r('v1', 30), r('v1', 90), r('v1', 600), r('v1', null)]);
    expect(s).toEqual({ vendorId: 'v1', breakdowns: 4, responded: 3, awaiting: 1, medianMinutes: 90, averageMinutes: 240, slowestMinutes: 600 });
  });
  it('AC-EVR-009 an even count takes the mean of the two middle values, rounded half up', () => {
    expect(medianMinutes([91, 30])).toBe(61); // 60.5 -> 61
    expect(averageMinutes([1, 2])).toBe(2); // 1.5 -> 2
  });
  it('AC-EVR-009 no responses: median and average are absent, not zero', () => {
    const [s] = vendorResponseSummary([r('v1', null)]);
    expect(s).toMatchObject({ responded: 0, awaiting: 1, medianMinutes: null, averageMinutes: null, slowestMinutes: null });
    expect(medianMinutes([])).toBeNull();
    expect(averageMinutes([])).toBeNull();
  });
  it('keeps vendors apart', () => {
    const out = vendorResponseSummary([r('a', 10), r('b', 50), r('a', 20)]);
    expect(out.map((v) => [v.vendorId, v.medianMinutes])).toEqual([['a', 15], ['b', 50]]);
  });
  it('responseMinutes floors to whole minutes and never goes negative', () => {
    expect(responseMinutes('2024-03-04T00:00:00Z', '2024-03-04T00:30:59Z')).toBe(30);
    expect(responseMinutes('2024-03-04T00:00:00Z', null)).toBeNull();
    expect(responseMinutes('2024-03-04T01:00:00Z', '2024-03-04T00:00:00Z')).toBeNull();
  });
  it('splitMinutes breaks a total into days, hours and minutes', () => {
    expect(splitMinutes(1500)).toEqual({ days: 1, hours: 1, minutes: 0 });
    expect(splitMinutes(90)).toEqual({ days: 0, hours: 1, minutes: 30 });
  });
});
