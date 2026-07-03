/**
 * Tests for useAssistantPanel's persistence-era additions (ADR-0043):
 * openThread (resume-on-open, FR-AGP-021) and the derived isStuck flag (FR-AGP-022).
 * [REC-2]: hook lives at src/hooks/useAssistantPanel.ts (not src/components/panel/).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AgentRuntimeContext } from '../lib/agent/runtime/AgentRuntimeContext';
import type { AgentRuntime } from '../lib/agent/runtime/port';
import { useAssistantPanel } from './useAssistantPanel';
import type { AgentEventRow } from '../lib/db/agentEvents';

// ── Mock the agentEvents DAL (listRunEvents) ──────────────────────────────────

const h = vi.hoisted(() => ({ listRunEvents: vi.fn() }));
vi.mock('../lib/db/agentEvents', () => ({ listRunEvents: h.listRunEvents }));

function makeRow(overrides: Partial<AgentEventRow>): AgentEventRow {
  return {
    id: crypto.randomUUID(),
    run_id: 'run-1',
    org_id: 'org-1',
    owner_id: 'user-1',
    seq: 0,
    type: 'user',
    text: null,
    payload: null,
    tool_name: null,
    tool_args_hash: null,
    tool_status: null,
    rating: null,
    downvote_reason: null,
    created_at: '2026-07-03T00:00:00Z',
    ...overrides,
  } as AgentEventRow;
}

function makeWrapper(runtime: AgentRuntime) {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [open, setOpen] = React.useState(false);
    return React.createElement(
      AgentRuntimeContext.Provider,
      {
        value: {
          runtime,
          open,
          openPanel: () => setOpen(true),
          closePanel: () => setOpen(false),
          togglePanel: () => setOpen((o) => !o),
        },
      },
      children,
    );
  };
  return Wrapper;
}

function makeFakeRuntime(): AgentRuntime {
  return {
    createRun: vi.fn(),
    followUp: vi.fn(),
    control: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
  };
}

describe('useAssistantPanel openThread (FR-AGP-021)', () => {
  beforeEach(() => {
    h.listRunEvents.mockReset();
  });

  it('AC-AGP-021 openThread restores transcript in seq order despite out-of-order rows', async () => {
    // Rows arrive from the DAL in a NON-seq order (simulating an unordered fetch/merge) —
    // the hook must still render them in seq order (seq is the ordering key, not
    // array-insertion order — FR-AGP-005/021).
    h.listRunEvents.mockResolvedValue([
      makeRow({ seq: 3, type: 'assistant', text: 'You have 3 active projects.' }),
      makeRow({ seq: 1, type: 'user', text: 'how many active projects?' }),
      makeRow({ seq: 2, type: 'tool', payload: { name: 'query_entity', result: { rowCount: 3 } } }),
    ]);

    const runtime = makeFakeRuntime();
    const wrapper = makeWrapper(runtime);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    await act(async () => {
      await result.current.openThread('thread-1', 'run-1');
    });

    expect(h.listRunEvents).toHaveBeenCalledWith('run-1');
    expect(result.current.transcript.map((e) => e.event.type)).toEqual(['user', 'tool', 'assistant']);
    expect(result.current.transcript[0].event.text).toBe('how many active projects?');
    expect(result.current.transcript[2].event.text).toBe('You have 3 active projects.');
    expect(result.current.runId).toBe('run-1');
  });

  it('AC-AGP-021 consecutive assistant rows merge into one transcript entry (client-side merge reproduced)', async () => {
    h.listRunEvents.mockResolvedValue([
      makeRow({ seq: 1, type: 'assistant', text: 'You have ' }),
      makeRow({ seq: 2, type: 'assistant', text: '3 active projects.' }),
    ]);

    const runtime = makeFakeRuntime();
    const wrapper = makeWrapper(runtime);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    await act(async () => {
      await result.current.openThread('thread-1', 'run-1');
    });

    expect(result.current.transcript).toHaveLength(1);
    expect(result.current.transcript[0].event.text).toBe('You have 3 active projects.');
  });

  it('openThread with an empty journal (fresh run) resolves to an empty transcript, no error', async () => {
    h.listRunEvents.mockResolvedValue([]);
    const runtime = makeFakeRuntime();
    const wrapper = makeWrapper(runtime);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper });

    await act(async () => {
      await result.current.openThread('thread-1', 'run-1');
    });

    expect(result.current.transcript).toEqual([]);
    expect(result.current.runId).toBe('run-1');
  });
});

describe('useAssistantPanel isStuck (FR-AGP-022)', () => {
  it('isStuck is false when no run is active (fresh hook state)', () => {
    const runtime = makeFakeRuntime();
    const wrapper = makeWrapper(runtime);
    const { result } = renderHook(() => useAssistantPanel(), { wrapper });
    expect(result.current.isStuck).toBe(false);
  });
});
