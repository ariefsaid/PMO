import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ files: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/db/thirdPartyInspections', () => ({ listInspectionFilesBatch: h.files }));
import { useInspectionFilesBatch } from './useThirdPartyInspections';

it('the inspection file caller batches unique ids through the real repository and recovers a refused read', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  h.files.mockRejectedValueOnce(Object.assign(new Error('read unavailable'), { code: 'READ_FAILED' }));
  const { result } = renderHook(() => useInspectionFilesBatch(['i2', 'i1', 'i2']), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(h.files).toHaveBeenCalledExactlyOnceWith(['i1', 'i2']);
  const files = [{ id: 'file-1', inspection_id: 'i1', name: 'Report' }];
  h.files.mockResolvedValue(files);
  await act(async () => { await result.current.refetch(); });
  await waitFor(() => expect(result.current.data).toBe(files));
  expect(h.files).toHaveBeenNthCalledWith(2, ['i1', 'i2']);
});
