import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useUsageThresholds } from './useUsageThresholds';
const read = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/repositories/materialRequests', () => ({ materialRequestRepository: { usageThresholds: read } }));

it('exposes a failed threshold read and retries without treating it as disabled warnings', async () => {
  read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ pct1: 80, pct2: 100 });
  const { result } = renderHook(() => useUsageThresholds());
  expect(result.current.isPending).toBe(true);
  await waitFor(() => expect(result.current.isError).toBe(true));
  act(() => result.current.reload());
  expect(result.current.isPending).toBe(true);
  await waitFor(() => expect(result.current.thresholds).toEqual({ pct1: 80, pct2: 100 }));
  expect(result.current.isError).toBe(false);
  expect(result.current.isPending).toBe(false);
});
