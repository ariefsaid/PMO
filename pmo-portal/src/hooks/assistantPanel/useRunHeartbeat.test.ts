/**
 * useRunHeartbeat — the polling/staleness seam extracted from useAssistantPanel
 * (THEME-CROSS-84, FR-AGP-022). Pins:
 *   - while active, the server heartbeat (`agent_runs.last_progress_at` via the
 *     repository) is polled on the 5s cadence and OVERWRITES the client-observed
 *     stamp whenever a poll returns a value
 *   - noteProgress() advances the opportunistic client-side stamp (drain per event)
 *   - isStuck is true only while active, a stamp exists, and the elapsed time since
 *     it exceeds STUCK_RUN_STALE_MS — and a pending ask_user question excludes stuck
 *   - inactive → no polling, isStuck false
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRunHeartbeat } from './useRunHeartbeat';
import { STUCK_RUN_STALE_MS } from '../../components/panel/stuckRun.constants';

const getHeartbeat = vi.fn();

vi.mock('../../lib/repositories', () => ({
  repositories: {
    agentRun: {
      getHeartbeat: (...args: unknown[]) => getHeartbeat(...args),
    },
  },
}));

describe('useRunHeartbeat — FR-AGP-022 polling + staleness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getHeartbeat.mockReset();
    getHeartbeat.mockResolvedValue({ status: 'running', last_progress_at: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls the server heartbeat immediately and on the 5s cadence while active', async () => {
    renderHook(() => useRunHeartbeat({ active: true, runId: 'run-1', hasPendingQuestion: false }));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getHeartbeat).toHaveBeenCalledWith('run-1');

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(getHeartbeat).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(getHeartbeat).toHaveBeenCalledTimes(3);
  });

  it('does not poll when inactive or runId is null', async () => {
    renderHook(() => useRunHeartbeat({ active: false, runId: 'run-1', hasPendingQuestion: false }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(getHeartbeat).not.toHaveBeenCalled();

    renderHook(() => useRunHeartbeat({ active: true, runId: null, hasPendingQuestion: false }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(getHeartbeat).not.toHaveBeenCalled();
  });

  it('a returned server stamp overwrites the client-observed one', async () => {
    const serverStamp = '2026-07-03T12:00:00.000Z';
    getHeartbeat.mockResolvedValue({ status: 'running', last_progress_at: serverStamp });

    const { result } = renderHook(() =>
      useRunHeartbeat({ active: true, runId: 'run-1', hasPendingQuestion: false }),
    );

    act(() => { result.current.noteProgress(); });
    const clientStamp = result.current.lastProgressAt;
    expect(clientStamp).toBeTruthy();
    expect(clientStamp).not.toBe(serverStamp);

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.lastProgressAt).toBe(serverStamp);
  });

  it('a failed poll keeps the current stamp (fail-open) and retries on the next tick', async () => {
    getHeartbeat.mockRejectedValueOnce(new Error('db read failed'));

    const { result } = renderHook(() =>
      useRunHeartbeat({ active: true, runId: 'run-1', hasPendingQuestion: false }),
    );
    act(() => { result.current.noteProgress(); });
    const clientStamp = result.current.lastProgressAt;

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.lastProgressAt).toBe(clientStamp);

    getHeartbeat.mockResolvedValueOnce({ status: 'running', last_progress_at: '2026-07-03T13:00:00.000Z' });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(result.current.lastProgressAt).toBe('2026-07-03T13:00:00.000Z');
  });

  it('isStuck flips true once the stale window is crossed and stays keyed on activity', async () => {
    const { result } = renderHook(() =>
      useRunHeartbeat({ active: true, runId: 'run-1', hasPendingQuestion: false }),
    );
    act(() => { result.current.noteProgress(); });
    expect(result.current.isStuck).toBe(false);

    // The crossing is scheduled — one render lands on the far side of the window.
    await act(async () => { await vi.advanceTimersByTimeAsync(STUCK_RUN_STALE_MS + 1_000); });
    expect(result.current.isStuck).toBe(true);
  });

  it('a pending ask_user question excludes stuck even past the stale window', async () => {
    const { result, rerender } = renderHook(
      ({ hasPendingQuestion }) =>
        useRunHeartbeat({ active: true, runId: 'run-1', hasPendingQuestion }),
      { initialProps: { hasPendingQuestion: false } },
    );
    act(() => { result.current.noteProgress(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(STUCK_RUN_STALE_MS + 1_000); });
    expect(result.current.isStuck).toBe(true);

    rerender({ hasPendingQuestion: true });
    expect(result.current.isStuck).toBe(false);
  });

  it('setting the stamp to null (thread adoption) resets staleness', () => {
    const { result } = renderHook(() =>
      useRunHeartbeat({ active: false, runId: 'run-1', hasPendingQuestion: false }),
    );
    act(() => { result.current.noteProgress(); });
    expect(result.current.lastProgressAt).toBeTruthy();
    act(() => { result.current.setLastProgressAt(null); });
    expect(result.current.lastProgressAt).toBeNull();
    expect(result.current.isStuck).toBe(false);
  });
});
