import { beforeEach, describe, expect, it } from 'vitest';
import { readColumnSizing } from '../useTableColumnSizing';

/** #2093 — splitting a shared tableId must not reset the widths people already saved. */
const key = (id: string) => `pmo.table.${id}.widths.v1:u1`;
const cols = [{ key: 'party' }, { key: 'total' }];

describe('AC-TBL-RESIZE-003: saved widths survive a tableId split (#2093)', () => {
  beforeEach(() => window.localStorage.clear());

  it('reads the old key when the new one is empty and copies it to the new key', () => {
    window.localStorage.setItem(key('old'), JSON.stringify({ party: 210, total: 130 }));
    expect(readColumnSizing('new-ap', 'u1', cols, 'old')).toEqual({ party: 210, total: 130 });
    expect(window.localStorage.getItem(key('new-ap'))).toBe(JSON.stringify({ party: 210, total: 130 }));
  });

  it('keeps the old key so the sibling table migrates the same widths, then diverges independently', () => {
    window.localStorage.setItem(key('old'), JSON.stringify({ party: 210 }));
    readColumnSizing('new-ap', 'u1', cols, 'old');
    expect(window.localStorage.getItem(key('old'))).not.toBeNull();
    expect(readColumnSizing('new-ar', 'u1', cols, 'old')).toEqual({ party: 210 });
    window.localStorage.setItem(key('new-ap'), JSON.stringify({ party: 300 }));
    expect(readColumnSizing('new-ar', 'u1', cols, 'old')).toEqual({ party: 210 });
  });

  it('prefers widths already saved under the new key over the old key', () => {
    window.localStorage.setItem(key('old'), JSON.stringify({ party: 210 }));
    window.localStorage.setItem(key('new-ap'), JSON.stringify({ party: 300 }));
    expect(readColumnSizing('new-ap', 'u1', cols, 'old')).toEqual({ party: 300 });
  });

  it('without a legacy id the old key is ignored', () => {
    window.localStorage.setItem(key('old'), JSON.stringify({ party: 210 }));
    expect(readColumnSizing('new-ap', 'u1', cols)).toEqual({});
  });
});
