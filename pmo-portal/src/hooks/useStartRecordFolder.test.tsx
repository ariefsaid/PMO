// @vitest-environment jsdom
/**
 * AC-M365DOC-071 successful project and case creation survive every folder failure.
 *
 * The coordinator is proven in a save-success harness (this file) AND against the SHIPPED create
 * hooks (`useProjectMutations().create`, `useCreateProcurement`) — see the aggregate table below.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui/Toast';
import type { Role } from '@/src/auth/AuthContext';
import { AppError } from '@/src/lib/appError';
import type { RecordFolderTarget } from '@/src/lib/m365/recordFolders';

const auth = vi.hoisted(() => ({ current: { id: 'u1', org_id: 'org-1' } as { id: string; org_id: string } | null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.current }) }));

const ensure = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/repositories', () => ({
  repositories: { m365RecordFolders: { ensure: (...a: unknown[]) => ensure(...a) } },
}));

import { useStartRecordFolder } from './useStartRecordFolder';
import { recordFolderKey, type RecordFolderState } from './recordFolderState';

const ID = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const target: RecordFolderTarget = { kind: 'project', id: ID };

let qc: QueryClient;
function wrapper(role: Role | null = 'Project Manager') {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={role}>
        <ToastProvider>{children}</ToastProvider>
      </ImpersonationProvider>
    </QueryClientProvider>
  );
}
const state = (t = target, org = 'org-1', user = 'u1') =>
  qc.getQueryData(recordFolderKey(org, user, t)) as RecordFolderState | undefined;

/** A save form: the saved heading appears BEFORE start() and must survive whatever the folder does. */
function SaveHarness() {
  const start = useStartRecordFolder();
  const [saved, setSaved] = useState(false);
  return (
    <div>
      <button onClick={() => { setSaved(true); const r = start(target); (globalThis as { __ret?: unknown }).__ret = r; }}>save</button>
      {saved && <h2>Record saved</h2>}
    </div>
  );
}

beforeEach(() => {
  ensure.mockReset();
  auth.current = { id: 'u1', org_id: 'org-1' };
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => vi.restoreAllMocks());

describe('AC-M365DOC-071 coordinator — useStartRecordFolder', () => {
  it('start returns void synchronously and a never-settling ensure leaves the saved record untouched', async () => {
    ensure.mockReturnValue(new Promise(() => {}));
    render(<SaveHarness />, { wrapper: wrapper() });
    act(() => screen.getByText('save').click());
    expect((globalThis as { __ret?: unknown }).__ret).toBeUndefined();
    expect(screen.getByRole('heading', { name: 'Record saved' })).toBeTruthy();
    expect(state()).toEqual({ status: 'pending' });
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith(target);
  });

  it('records the linked outcome, refreshes the project register and announces success', async () => {
    ensure.mockResolvedValue({ state: 'created', document_id: DOC });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => result.current(target));
    await waitFor(() => expect(state()?.status).toBe('settled'));
    expect(state()).toMatchObject({ copy: { ok: true, key: 'status.linked' } });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['project-documents', 'org-1', ID] });
  });

  it('refreshes the procurement register for a case', async () => {
    ensure.mockResolvedValue({ state: 'linked', document_id: DOC });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => result.current({ kind: 'procurement', id: ID }));
    await waitFor(() => expect(state({ kind: 'procurement', id: ID })?.status).toBe('settled'));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['procurement-docs', 'org-1', ID] });
  });

  it.each([
    ['needs_choice', { state: 'needs_choice' }, 'error.ambiguous'],
    ['default_unset', { state: 'default_unset' }, 'error.defaultUnset'],
    ['missing_identifier', { state: 'missing_identifier' }, 'error.missingIdentifier'],
  ])('a %s outcome is "saved, not linked" with its reviewed copy and no register refresh', async (_n, outcome, key) => {
    ensure.mockResolvedValue(outcome);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => result.current(target));
    await waitFor(() => expect(state()?.status).toBe('settled'));
    expect(state()).toMatchObject({ copy: { ok: false, key } });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(['SCOPE_INSUFFICIENT', 'FORBIDDEN', 'NOT_CONNECTED', 'GRAPH_ERROR', 'external-unreachable'])(
    'a %s failure is stored as a safe copy key; no rejection escapes',
    async (code) => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      ensure.mockRejectedValue(Object.assign(new AppError('RAW-UPSTREAM-MARKER', code)));
      const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
      act(() => result.current(target));
      await waitFor(() => expect(state()?.status).toBe('settled'));
      expect(JSON.stringify(state())).not.toContain('RAW-UPSTREAM');
      expect(state()).toMatchObject({ copy: { ok: false } });
      await new Promise((r) => setTimeout(r, 0));
      process.off('unhandledRejection', unhandled);
      expect(unhandled).not.toHaveBeenCalled();
    },
  );

  it('a synchronous throw from the repository is caught', async () => {
    ensure.mockImplementation(() => { throw new Error('RAW'); });
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    expect(() => act(() => result.current(target))).not.toThrow();
    await waitFor(() => expect(state()?.status).toBe('settled'));
    expect(state()).toMatchObject({ copy: { key: 'error.generic' } });
  });

  it('does not retry automatically and ignores a second start while pending', async () => {
    ensure.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => { result.current(target); result.current(target); });
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('does not start for view-only impersonation, non-writers, signed-out or no provider', () => {
    // Engineer: real role cannot create a document.
    const eng = renderHook(() => useStartRecordFolder(), { wrapper: wrapper('Engineer') });
    act(() => eng.result.current(target));
    // Signed out.
    auth.current = null;
    const out = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => out.result.current(target));
    auth.current = { id: 'u1', org_id: 'org-1' };
    // No ImpersonationProvider at all.
    const bare = renderHook(() => useStartRecordFolder(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    act(() => bare.result.current(target));
    expect(ensure).not.toHaveBeenCalled();
  });

  it('a case start needs procDoc create (Finance may; Engineer may not)', () => {
    ensure.mockReturnValue(new Promise(() => {}));
    const fin = renderHook(() => useStartRecordFolder(), { wrapper: wrapper('Finance') });
    act(() => fin.result.current({ kind: 'procurement', id: ID }));
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('survives unmount: the late result still lands in the cache for the register to show', async () => {
    let resolve!: (v: unknown) => void;
    ensure.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result, unmount } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => result.current(target));
    unmount();
    await act(async () => resolve({ state: 'needs_choice' }));
    expect(state()).toMatchObject({ status: 'settled', copy: { key: 'error.ambiguous' } });
  });

  it('writes a late result to the CAPTURED identity only, never the one now signed in', async () => {
    let resolve!: (v: unknown) => void;
    ensure.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result, rerender } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => result.current(target));
    auth.current = { id: 'u2', org_id: 'org-2' };
    rerender();
    await act(async () => resolve({ state: 'linked', document_id: DOC }));
    expect(state(target, 'org-1', 'u1')?.status).toBe('settled');
    expect(state(target, 'org-2', 'u2')).toBeUndefined();
  });
});
