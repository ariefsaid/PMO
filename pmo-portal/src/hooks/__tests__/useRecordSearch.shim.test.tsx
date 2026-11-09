import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  publishRecordSearch,
  registerRecordSearchRefetch,
  useRecordSearch,
} from '../useRecordSearch';

/**
 * #2096: the entry-side ⌘K shim. `App.tsx` must not statically import the live index (six entity
 * hooks → companies/contacts/incidents DAL), so the shell reads this store instead and the live
 * `useRecordSearchData` bridge publishes into it from the first palette open. These tests pin the
 * seam: the closed-palette snapshot (AC-CMDK-001: no list read while closed), publication, and the
 * refetch hand-off the palette's error-retry uses.
 */
describe('useRecordSearch shim (#2096)', () => {
  afterEach(() => {
    act(() => {
      publishRecordSearch({ records: [], isPending: false, isError: false });
      registerRecordSearchRefetch(null);
    });
  });

  it('serves the closed-palette snapshot before the live bridge mounts', () => {
    const { result } = renderHook(() => useRecordSearch());
    expect(result.current.records).toEqual([]);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it('re-renders with the rows the lazily-mounted bridge publishes', () => {
    const { result } = renderHook(() => useRecordSearch());
    act(() => {
      publishRecordSearch({
        records: [{
          id: 'projects:1',
          group: 'Records',
          title: 'Bridge No. 7',
          sub: 'Project',
          icon: 'projects',
          run: () => {},
        }],
        isPending: true,
        isError: false,
      });
    });
    expect(result.current.records.map((r) => r.id)).toEqual(['projects:1']);
    expect(result.current.isPending).toBe(true);
  });

  it('forwards the palette retry to the mounted bridge and stops when it unmounts', () => {
    const refetch = vi.fn();
    const { result } = renderHook(() => useRecordSearch());
    act(() => registerRecordSearchRefetch(refetch));
    act(() => result.current.refetch());
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => registerRecordSearchRefetch(null));
    act(() => result.current.refetch());
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
