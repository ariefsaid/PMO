/**
 * useAssistantPanel analytics call-site tests (Phase 2, Tasks 6/7b).
 * AC-APH-003/004/005/006/007/008/009/010/017.
 * AC-APH-001 (agent_panel_opened) is owned by AgentRuntimeProvider.test.tsx (Task 6c) —
 * the true call site is AgentRuntimeProvider.openPanel, not this hook.
 *
 * Follows useAssistantPanel.test.ts's scripted-fake-runtime + AgentRuntimeContext render
 * pattern (self-contained per repo convention — not imported from the existing test file).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { AgentRuntimeContext } from '../lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '../lib/agent/runtime/port';
import { useAssistantPanel } from './useAssistantPanel';

const mockCapture = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/analytics', () => ({
  trackAgentPanelOpened: (...args: unknown[]) => mockCapture('agent_panel_opened', args),
  trackAgentRunStarted: (...args: unknown[]) => mockCapture('agent_run_started', args),
  trackAgentRunCompleted: (...args: unknown[]) => mockCapture('agent_run_completed', args),
  trackAgentRunErrored: (...args: unknown[]) => mockCapture('agent_run_errored', args),
  trackAgentApprovalShown: (...args: unknown[]) => mockCapture('agent_approval_shown', args),
  trackAgentApprovalDecided: (...args: unknown[]) => mockCapture('agent_approval_decided', args),
  trackAgentThreadResumed: (...args: unknown[]) => mockCapture('agent_thread_resumed', args),
}));
vi.mock('../lib/db/agentEvents', () => ({ listRunEvents: vi.fn().mockResolvedValue([]) }));
vi.mock('../lib/db/agentRuns', () => ({ getRunHeartbeat: vi.fn().mockResolvedValue(null) }));

// ── (copied from useAssistantPanel.test.ts, self-contained per repo convention) ──
function makeEvent(type: AgentEvent['type'], overrides: Partial<AgentEvent> = {}): AgentEvent {
  return { id: crypto.randomUUID(), runId: overrides.runId ?? 'test-run', type, createdAt: new Date().toISOString(), ...overrides };
}
function makeAsyncIterable(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  return { [Symbol.asyncIterator]: async function* () { for (const ev of events) yield ev; } };
}
function makeFakeRuntime(events: AgentEvent[] = [], runId = 'test-run') {
  return {
    createRun: vi.fn().mockResolvedValue({ id: runId, title: 'test', status: 'running' } as AgentRun),
    followUp: vi.fn().mockResolvedValue(undefined),
    control: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(makeAsyncIterable(events)),
  } as unknown as AgentRuntime;
}

function wrapper(runtime: AgentRuntime, open = false) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      AgentRuntimeContext.Provider,
      { value: { runtime, open, openPanel: () => {}, closePanel: () => {}, togglePanel: () => {} } },
      children,
    );
}

beforeEach(() => { mockCapture.mockClear(); });

describe('useAssistantPanel analytics', () => {
  it('AC-APH-003 agent_run_started fires on new run', async () => {
    const runtime = makeFakeRuntime([]);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper: wrapper(runtime) });
    await act(async () => { await result.current.send('hello'); });
    expect(mockCapture).toHaveBeenCalledWith('agent_run_started', ['test-run', false]);
  });

  it('AC-APH-004 agent_run_started is_retry true from retry', async () => {
    const runtime = makeFakeRuntime([makeEvent('status', { payload: { status: 'errored', error: 'PROVIDER_ERROR' } })]);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper: wrapper(runtime) });
    await act(async () => { await result.current.send('hello'); });
    mockCapture.mockClear();
    await act(async () => { await result.current.retry(); });
    expect(mockCapture).toHaveBeenCalledWith('agent_run_started', ['test-run', true]);
  });

  it('AC-APH-017 a thrown analytics call does not block phase transition to idle', async () => {
    mockCapture.mockImplementation(() => { throw new Error('posthog boom'); });
    const runtime = makeFakeRuntime([makeEvent('status', { payload: { status: 'completed' } })]);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper: wrapper(runtime) });
    await act(async () => { await result.current.send('hello'); });
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(result.current.transcript.length).toBeGreaterThan(0);
  });

  it('AC-APH-005 agent_run_completed fires once with duration and tool_round_count', async () => {
    const events = [
      makeEvent('tool', { payload: { pendingId: undefined } }),
      makeEvent('tool', { payload: { pendingId: undefined } }),
      makeEvent('status', { payload: { status: 'completed' } }),
    ];
    const runtime = makeFakeRuntime(events);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper: wrapper(runtime) });
    await act(async () => { await result.current.send('hello'); });
    const completedCalls = mockCapture.mock.calls.filter((c) => c[0] === 'agent_run_completed');
    expect(completedCalls).toHaveLength(1);
    const [runId, durationMs, toolRoundCount] = completedCalls[0][1];
    expect(runId).toBe('test-run');
    expect(typeof durationMs).toBe('number');
    expect(toolRoundCount).toBe(2);
  });

  it('AC-APH-006 agent_run_errored does NOT fire for TURN_CAP', async () => {
    const runtime = makeFakeRuntime([makeEvent('status', { payload: { status: 'errored', error: 'TURN_CAP' } })]);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper: wrapper(runtime) });
    await act(async () => { await result.current.send('hello'); });
    expect(mockCapture.mock.calls.some((c) => c[0] === 'agent_run_errored')).toBe(false);
  });

  it('AC-APH-006 agent_run_errored fires with error_code for a real error', async () => {
    const runtime = makeFakeRuntime([makeEvent('status', { payload: { status: 'errored', error: 'PROVIDER_ERROR' } })]);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper: wrapper(runtime) });
    await act(async () => { await result.current.send('hello'); });
    const erroredCalls = mockCapture.mock.calls.filter((c) => c[0] === 'agent_run_errored');
    expect(erroredCalls).toHaveLength(1);
    expect(erroredCalls[0][1][3]).toBe('PROVIDER_ERROR');
  });

  it('AC-APH-007 agent_approval_shown fires when needs-approval is drained', async () => {
    const runtime = makeFakeRuntime([makeEvent('status', { payload: { status: 'needs-approval', pendingId: 'p1' } })]);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper: wrapper(runtime) });
    await act(async () => { await result.current.send('hello'); });
    expect(mockCapture).toHaveBeenCalledWith('agent_approval_shown', ['test-run']);
  });

  it('AC-APH-008 agent_approval_decided fires approved on approve', async () => {
    const runtime = makeFakeRuntime([]);
    (runtime.subscribe as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeAsyncIterable([makeEvent('status', { payload: { status: 'needs-approval', pendingId: 'p1' } })]))
      .mockReturnValueOnce(makeAsyncIterable([makeEvent('system', { payload: { event: 'write_resolved', decision: 'approved', pendingId: 'p1' } })]));
    const { result } = renderHook(() => useAssistantPanel(), { wrapper: wrapper(runtime) });
    await act(async () => { await result.current.send('hello'); });
    await act(async () => { await result.current.approve(); });
    expect(mockCapture).toHaveBeenCalledWith('agent_approval_decided', ['test-run', 'approved']);
  });

  it('AC-APH-009 agent_approval_decided fires denied on deny', async () => {
    const runtime = makeFakeRuntime([]);
    (runtime.subscribe as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeAsyncIterable([makeEvent('status', { payload: { status: 'needs-approval', pendingId: 'p1' } })]))
      .mockReturnValueOnce(makeAsyncIterable([makeEvent('system', { payload: { event: 'write_resolved', decision: 'denied', pendingId: 'p1' } })]));
    const { result } = renderHook(() => useAssistantPanel(), { wrapper: wrapper(runtime) });
    await act(async () => { await result.current.send('hello'); });
    await act(async () => { await result.current.deny(); });
    expect(mockCapture).toHaveBeenCalledWith('agent_approval_decided', ['test-run', 'denied']);
  });

  it('AC-APH-010 agent_thread_resumed fires with event_count', async () => {
    const { listRunEvents } = await import('../lib/db/agentEvents');
    (listRunEvents as ReturnType<typeof vi.fn>).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `ev-${i}`, run_id: 'run-1', seq: i, type: 'user', text: 'hi', payload: null, created_at: new Date().toISOString(),
      })),
    );
    const runtime = makeFakeRuntime([]);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper: wrapper(runtime) });
    // NOTE: the real useAssistantPanel.openThread(runId) is single-arg (no threadId param
    // exists in this codebase's dev HEAD — verified against AssistantPanel.tsx's
    // handleOpenThread, which drops _threadId per "review round item 6, dead param
    // dropped"). This task adds a second OPTIONAL threadId param (backward-compatible with
    // the two existing openThread('run-1') call sites in useAssistantPanel.persistence.test.ts)
    // so AssistantPanel.tsx's already-in-scope _threadId can be forwarded for FR-APH-010's
    // thread_id property — see Task 7's openThread signature.
    await act(async () => { await result.current.openThread('run-1', 'thread-1'); });
    expect(mockCapture).toHaveBeenCalledWith('agent_thread_resumed', ['thread-1', 'run-1', 5]);
  });

  it('AC-APH-010b agent_thread_resumed fires with thread_id null when openThread called without a threadId', async () => {
    const { listRunEvents } = await import('../lib/db/agentEvents');
    (listRunEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const runtime = makeFakeRuntime([]);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper: wrapper(runtime) });
    await act(async () => { await result.current.openThread('run-1'); });
    expect(mockCapture).toHaveBeenCalledWith('agent_thread_resumed', [null, 'run-1', 0]);
  });
});
