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
});
