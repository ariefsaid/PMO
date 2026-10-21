import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { check, auth } = vi.hoisted(() => ({
  check: vi.fn(),
  auth: { user: { id: 'user-1', org_id: 'org-1' } as { id: string; org_id: string } },
}));
vi.mock('@/src/lib/m365/graphClient', () => ({ checkMicrosoftDocuments: check }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.user }) }));

import { staleControlledFileIds, useDocumentVerification, type VerifiableDocument } from './useDocumentVerification';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const doc = (id: string, over: Partial<VerifiableDocument> = {}): VerifiableDocument => ({
  id, source: 'onedrive', status: 'Issued', ms_item_kind: 'file', ms_last_verified_at: null, ...over,
});

const clientWith = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = (client: QueryClient) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  check.mockResolvedValue(undefined);
  auth.user = { id: 'user-1', org_id: 'org-1' };
});
afterEach(() => vi.useRealTimers());

describe('staleControlledFileIds', () => {
  it('AC-M365DOC-064 selects only Microsoft files past Draft whose last successful check is missing or >= 24h old, sorted', () => {
    const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
    const ids = staleControlledFileIds([
      doc('z-never'),
      doc('b-old', { status: 'Approved', ms_last_verified_at: hoursAgo(24) }),
      doc('c-fresh', { ms_last_verified_at: hoursAgo(23) }),
      doc('d-draft', { status: 'Draft' }),
      doc('e-folder', { ms_item_kind: 'folder' }),
      doc('f-upload', { source: 'upload' }),
      doc('g-garbage-time', { ms_last_verified_at: 'not a date' }),
    ], NOW);
    expect(ids).toEqual(['b-old', 'g-garbage-time', 'z-never']);
  });
});

describe('useDocumentVerification', () => {
  it('AC-M365DOC-064 checks the stale displayed files once as one sorted batch and refreshes the register', async () => {
    const client = clientWith();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const rows = [doc('b'), doc('a'), doc('c', { status: 'Draft' })];
    const { rerender } = renderHook(() => useDocumentVerification('p1', rows), { wrapper: wrapper(client) });
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledWith(['a', 'b']);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project-documents', 'org-1', 'p1'] }));
    rerender();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('AC-M365DOC-064 does nothing for Drafts, folders or fresh files, and makes no timer', () => {
    vi.useFakeTimers();
    const rows = [doc('d', { status: 'Draft' }), doc('f', { ms_item_kind: 'folder' }), doc('ok', { ms_last_verified_at: new Date().toISOString() })];
    renderHook(() => useDocumentVerification('p1', rows), { wrapper: wrapper(clientWith()) });
    vi.advanceTimersByTime(7 * 86_400_000);
    expect(check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('AC-M365DOC-064 the table and the Drawer mounting together share a single in-flight check', async () => {
    const client = clientWith();
    let release!: () => void;
    check.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    const rows = [doc('a')];
    renderHook(() => useDocumentVerification('p1', rows), { wrapper: wrapper(client) });
    renderHook(() => useDocumentVerification('p1', rows), { wrapper: wrapper(client) });
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    release();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('AC-M365DOC-064 a failed check is not re-invoked by the same display until an explicit retry', async () => {
    const client = clientWith();
    check.mockRejectedValueOnce(new Error('synthetic')).mockResolvedValue(undefined);
    const rows = [doc('a')];
    const { result, rerender } = renderHook(() => useDocumentVerification('p1', rows), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    rerender();
    expect(check).toHaveBeenCalledTimes(1);
    result.current.retry();
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
  });

  it('AC-M365DOC-064 an account switch checks again under the new caller and never reuses the previous result', async () => {
    const client = clientWith();
    const rows = [doc('a')];
    const { rerender } = renderHook(() => useDocumentVerification('p1', rows), { wrapper: wrapper(client) });
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    auth.user = { id: 'user-2', org_id: 'org-1' };
    rerender();
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
  });
});
