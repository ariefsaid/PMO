import { describe, expect, it } from 'vitest';
import { isValidTimeZone, listTimeZoneIds } from './timezones';

describe('personal timezone preferences', () => {
  it('AC-PLC-006: accepts valid IANA zones and rejects invalid identifiers', () => {
    expect(isValidTimeZone('Asia/Jakarta')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Not/A_Time_Zone')).toBe(false);
  });

  it('offers valid searchable zone values and includes current/default zones omitted by the runtime list', () => {
    const zones = listTimeZoneIds(['UTC', 'Asia/Jakarta', 'Pacific/Honolulu']);
    expect(zones).toContain('UTC');
    expect(zones).toContain('Asia/Jakarta');
    expect(zones).toContain('Pacific/Honolulu');
    expect(zones.every(isValidTimeZone)).toBe(true);
    expect(zones).toEqual([...zones].sort((a, b) => a.localeCompare(b)));
  });

  it('#2103: adds each extra zone once, drops invalid ones, and still returns a fresh sorted list', () => {
    const zones = listTimeZoneIds(['Asia/Jakarta', 'Asia/Jakarta', 'UTC', 'Not/A_Time_Zone', '', 'Pacific/Honolulu']);
    expect(zones.filter((zone) => zone === 'Asia/Jakarta')).toHaveLength(1);
    expect(zones.filter((zone) => zone === 'UTC')).toHaveLength(1);
    expect(zones).not.toContain('Not/A_Time_Zone');
    expect(zones).toEqual([...zones].sort((a, b) => a.localeCompare(b)));
  });

  it('#2103: building the option list on a profile mount takes under 10 ms', () => {
    // The first call builds (and memoises) the runtime's canonical list; the mount path then repeats
    // it with the user's own zones. Validating every canonical zone per call cost 135 ms median.
    listTimeZoneIds();
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      listTimeZoneIds(['Asia/Jakarta', 'UTC', 'Europe/Amsterdam']);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length / 2)]).toBeLessThan(10);
  });
});
