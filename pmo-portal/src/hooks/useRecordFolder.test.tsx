// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppError } from '@/src/lib/appError';

const ensure = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/repositories', () => ({ repositories: { m365RecordFolders: { ensure: (...a: unknown[]) => ensure(...a) } } }));
const auth = vi.hoisted(() => ({ current: { id: 'u1', org_id: 'org-1' } as { id: string; org_id: string } | null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.current }) }));

import { useRecordFolder } from './useRecordFolder';

const target = { kind: 'procurement' as const, id: '11111111-1111-4111-8111-111111111111' };
let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  ensure.mockReset();
  auth.current = { id: 'u1', org_id: 'org-1' };
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('AC-M365DOC-071 useRecordFolder', () => {
  it('does nothing until ensure() is called, then runs the mutation once without retry', async () => {
    ensure.mockRejectedValue(new AppError('x', 'GRAPH_ERROR'));
    const { result } = renderHook(() => useRecordFolder(target), { wrapper });
    expect(ensure).not.toHaveBeenCalled();
    expect(result.current.state).toBeNull();
    act(() => result.current.ensure());
    await waitFor(() => expect(result.current.settledCopy?.key).toBe('error.generic'));
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('is inert when signed out', () => {
    auth.current = null;
    const { result } = renderHook(() => useRecordFolder(target), { wrapper });
    act(() => result.current.ensure());
    expect(ensure).not.toHaveBeenCalled();
  });

  it('a second ensure() while pending is ignored', async () => {
    ensure.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRecordFolder(target), { wrapper });
    act(() => { result.current.ensure(); result.current.ensure(); });
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    expect(result.current.pending).toBe(true);
  });

  it('H20 an unavailable result refreshes the case register so a late-linked folder clears the notice', async () => {
    ensure.mockRejectedValue(Object.assign(new Error('x'), { code: 'external-unreachable' }));
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRecordFolder(target), { wrapper });
    act(() => result.current.ensure());
    await waitFor(() => expect(result.current.settledCopy?.ok).toBe(false));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['procurement-documents', 'org-1', target.id] });
  });

  it('records the linked outcome and refreshes the case register', async () => {
    ensure.mockResolvedValue({ state: 'created', document_id: '22222222-2222-4222-8222-222222222222' });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRecordFolder(target), { wrapper });
    act(() => result.current.ensure());
    await waitFor(() => expect(result.current.settledCopy?.ok).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['procurement-documents', 'org-1', target.id] });
  });
});
