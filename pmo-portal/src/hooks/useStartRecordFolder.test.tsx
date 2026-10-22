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
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui/Toast';
import type { Role } from '@/src/auth/AuthContext';
import { AppError } from '@/src/lib/appError';
import type { RecordFolderTarget } from '@/src/lib/m365/recordFolders';

const auth = vi.hoisted(() => ({ current: { id: 'u1', org_id: 'org-1' } as { id: string; org_id: string } | null }));
const m365Feature = vi.hoisted(() => ({ on: true }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: (key: string) => key !== 'm365_integration' || m365Feature.on }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.current }) }));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@/src/components/ui/Toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/components/ui/Toast')>()),
  useOptionalToast: () => ({ toast: toastSpy }),
}));

const ensure = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/repositories', () => ({
  repositories: { m365RecordFolders: { ensure: (...a: unknown[]) => ensure(...a) } },
}));

import { useStartRecordFolder } from './useStartRecordFolder';
import { recordFolderKey, resetRecordFolderToastSession, type RecordFolderState } from './recordFolderState';

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
  m365Feature.on = true;
  ensure.mockReset();
  toastSpy.mockReset();
  resetRecordFolderToastSession();
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
    expect(spy).toHaveBeenCalledWith({ queryKey: ['procurement-documents', 'org-1', ID] });
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

  it('does not start, or announce anything, in an org without Microsoft 365', () => {
    m365Feature.on = false;
    render(<QueryClientProvider client={qc}><ImpersonationProvider realRole="Project Manager"><ToastProvider><SaveHarness /></ToastProvider></ImpersonationProvider></QueryClientProvider>);
    act(() => screen.getByText('save').click());
    expect(ensure).not.toHaveBeenCalled();
    expect(state()).toBeUndefined();
    expect(screen.queryByText(/folder/i)).toBeNull();
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


describe('RF-5 the folder start is silent; only an abnormal failure may warn, once, late', () => {
  afterEach(() => vi.useRealTimers());

  it('RF-5 a start toasts nothing while pending and nothing on success', async () => {
    ensure.mockResolvedValue({ state: 'created', document_id: DOC });
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => result.current(target));
    expect(toastSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(state()?.status).toBe('settled'));
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['needs_choice outcome', { state: 'needs_choice' }, false],
    ['default_unset outcome', { state: 'default_unset' }, false],
    ['missing_identifier outcome', { state: 'missing_identifier' }, false],
    ['SCOPE_INSUFFICIENT', new AppError('x', 'SCOPE_INSUFFICIENT'), true],
    ['NOT_CONNECTED', new AppError('x', 'NOT_CONNECTED'), true],
    ['FORBIDDEN', new AppError('x', 'FORBIDDEN'), true],
  ])('RF-5 an expected state (%s) never toasts, even after the quiet period', async (_n, outcome, rejects) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    if (rejects) ensure.mockRejectedValue(outcome); else ensure.mockResolvedValue(outcome);
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => result.current(target));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(state()?.status).toBe('settled');
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('RF-5 an abnormal failure warns once, plainly, only after the create toast had its time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    ensure.mockRejectedValue(new AppError('synthetic-raw-secret', 'GRAPH_ERROR'));
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => result.current(target));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(toastSpy).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0]).toContainEqual('warning');
    expect(JSON.stringify(toastSpy.mock.calls)).not.toContain('synthetic-raw-secret');
  });

  it('RF-5 the same cause warns once per session; a different cause may warn again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    ensure.mockRejectedValue(new AppError('x', 'GRAPH_ERROR'));
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => result.current(target));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    act(() => result.current({ kind: 'project', id: DOC }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(toastSpy).toHaveBeenCalledTimes(1);
    ensure.mockRejectedValue(new AppError('x', 'external-unreachable'));
    act(() => result.current({ kind: 'project', id: '33333333-3333-4333-8333-333333333333' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(toastSpy).toHaveBeenCalledTimes(2);
  });
});

describe('H20 a timed-out ensure re-checks the register', () => {
  it('H20 an unavailable/timeout result refreshes the register so a folder that did get linked clears the notice', async () => {
    ensure.mockRejectedValue(new AppError('timeout', 'external-unreachable'));
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => result.current(target));
    await waitFor(() => expect(state()?.status).toBe('settled'));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['project-documents', 'org-1', ID] });
  });

  it('H20 an expected state (forbidden) does not refetch the register', async () => {
    ensure.mockRejectedValue(new AppError('x', 'FORBIDDEN'));
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => result.current(target));
    await waitFor(() => expect(state()?.status).toBe('settled'));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('RF-5 one ensure per activation', () => {
  it('RF-5 two starts in one tick and one after start exactly one ensure; a settled failure allows one explicit retry', async () => {
    ensure.mockRejectedValueOnce(new AppError('x', 'GRAPH_ERROR'));
    const { result } = renderHook(() => useStartRecordFolder(), { wrapper: wrapper() });
    act(() => { result.current(target); result.current(target); });
    act(() => result.current(target));
    expect(ensure).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state()?.status).toBe('settled'));
    ensure.mockReturnValue(new Promise(() => {}));
    act(() => { result.current(target); result.current(target); });
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('RF-5 view-only impersonation starts nothing', () => {
    const { result } = renderHook(() => useStartRecordFolder(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={qc}>
          <ImpersonationProvider realRole="Admin" demoEligibility="eligible"><ViewAsEngineer />{children}</ImpersonationProvider>
        </QueryClientProvider>
      ),
    });
    act(() => result.current(target));
    expect(ensure).not.toHaveBeenCalled();
  });
});

function ViewAsEngineer() {
  const { viewAs } = useEffectiveRole();
  React.useEffect(() => viewAs('Engineer'), [viewAs]);
  return null;
}
