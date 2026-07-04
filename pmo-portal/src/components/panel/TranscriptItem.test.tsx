/**
 * TranscriptItem integration tests — widget/question routing (ADR-0045, Task I1).
 * FR-ATC-002/009, OBS-ATC-001/002.
 * Owning render proof for AC-ATC-001..010 lives in WidgetSlot.test.tsx/
 * QuestionChips.test.tsx/registry.test.tsx (unit layer) — this file proves
 * TranscriptItem correctly ROUTES artifact{kind:'widget'}/status{kind:'question'}
 * events to those components (the integration wiring itself).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const { mockAgentAssistant } = vi.hoisted(() => ({
  mockAgentAssistant: { value: true },
}));

vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: (key: string) => (key === 'agentAssistant' ? mockAgentAssistant.value : false),
  FEATURES: { agentAssistant: true, aiComposer: false, userViews: false, incidents: false },
}));

import { TranscriptItem } from './TranscriptItem';
import type { TranscriptEntry } from '@/src/hooks/useAssistantPanel';
import type { AgentEvent } from '@/src/lib/agent/runtime/port';

function entry(event: AgentEvent): TranscriptEntry {
  return { key: event.id, event };
}

function renderItem(event: AgentEvent, props: Partial<React.ComponentProps<typeof TranscriptItem>> = {}) {
  return render(
    <MemoryRouter>
      <TranscriptItem entry={entry(event)} {...props} />
    </MemoryRouter>,
  );
}

describe('TranscriptItem — widget routing (FR-ATC-002)', () => {
  it('AC-ATC-integration-widget artifact{kind:"widget"} renders via WidgetSlot as a real table', () => {
    mockAgentAssistant.value = true;
    const ev: AgentEvent = {
      id: 'e1',
      runId: 'r1',
      type: 'artifact',
      payload: {
        kind: 'widget',
        widget: {
          kind: 'data_table',
          columns: [{ key: 'name', label: 'Project' }],
          rows: [{ name: 'Alpha' }],
        },
      },
      createdAt: 'x',
    };
    renderItem(ev);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('flag-off: artifact{kind:"widget"} renders nothing (OBS-ATC-001 flag guard)', () => {
    mockAgentAssistant.value = false;
    const ev: AgentEvent = {
      id: 'e2',
      runId: 'r1',
      type: 'artifact',
      payload: { kind: 'widget', widget: { kind: 'data_table', columns: [], rows: [] } },
      createdAt: 'x',
    };
    const { container } = renderItem(ev);
    expect(container.textContent).toBe('');
    mockAgentAssistant.value = true;
  });

  it('compose_view artifact path is unregressed (OBS-ATC-001)', () => {
    // aiComposer mocked false above, so compose_view is flag-guarded off — asserts
    // the EXISTING compose_view branch is still reachable/checked, not bypassed.
    mockAgentAssistant.value = true;
    const ev: AgentEvent = {
      id: 'e3',
      runId: 'r1',
      type: 'artifact',
      payload: { kind: 'compose_view', spec: { panels: [] }, title: 't', repairAttempts: 0, tokensUsed: 0 },
      createdAt: 'x',
    };
    const { container } = renderItem(ev);
    // aiComposer is off in this mock → compose_view renders nothing (existing behavior).
    expect(container.textContent).toBe('');
  });
});

describe('TranscriptItem — question routing (FR-ATC-009)', () => {
  it('AC-ATC-integration-question status{kind:"question"} renders via QuestionChips', () => {
    mockAgentAssistant.value = true;
    const ev: AgentEvent = {
      id: 'e4',
      runId: 'r1',
      type: 'status',
      payload: { kind: 'question', questionId: 'q1', prompt: 'Which project?', options: [{ id: 'a', label: 'Alpha' }] },
      createdAt: 'x',
    };
    renderItem(ev);
    expect(screen.getByText('Which project?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('tapping a question chip calls onAnswer(questionId, optionId, undefined)', () => {
    mockAgentAssistant.value = true;
    const onAnswer = vi.fn();
    const ev: AgentEvent = {
      id: 'e5',
      runId: 'r1',
      type: 'status',
      payload: { kind: 'question', questionId: 'q1', prompt: 'Which project?', options: [{ id: 'a', label: 'Alpha' }] },
      createdAt: 'x',
    };
    renderItem(ev, { onAnswer });
    screen.getByRole('button', { name: 'Alpha' }).click();
    expect(onAnswer).toHaveBeenCalledWith('q1', 'a', undefined);
  });

  it('flag-off: status{kind:"question"} renders nothing', () => {
    mockAgentAssistant.value = false;
    const ev: AgentEvent = {
      id: 'e6',
      runId: 'r1',
      type: 'status',
      payload: { kind: 'question', questionId: 'q2', prompt: 'Which project?', options: [] },
      createdAt: 'x',
    };
    const { container } = renderItem(ev);
    expect(container.textContent).toBe('');
    mockAgentAssistant.value = true;
  });

  it('needs-approval status path is unregressed (OBS-ATC-002)', () => {
    mockAgentAssistant.value = true;
    const ev: AgentEvent = {
      id: 'e7',
      runId: 'r1',
      type: 'status',
      payload: { status: 'needs-approval', pendingId: 'p1', actionName: 'create_activity', humanSummary: 'Log a call', structuredArgs: {} },
      createdAt: 'x',
    };
    renderItem(ev);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  // ── Review-remediation item 3 (F3, Discover finding) ────────────────────────

  it('F3 phase="out-of-credits" disables the pending question chips (no dishonest dead-end)', () => {
    mockAgentAssistant.value = true;
    const ev: AgentEvent = {
      id: 'e8',
      runId: 'r1',
      type: 'status',
      payload: { kind: 'question', questionId: 'q1', prompt: 'Which project?', options: [{ id: 'a', label: 'Alpha' }] },
      createdAt: 'x',
    };
    renderItem(ev, { phase: 'out-of-credits' });
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeDisabled();
  });

  it('F3 a resolved question (answeredMap has this questionId) renders chips disabled with the chosen option indicated', () => {
    mockAgentAssistant.value = true;
    const ev: AgentEvent = {
      id: 'e9',
      runId: 'r1',
      type: 'status',
      payload: {
        kind: 'question',
        questionId: 'q1',
        prompt: 'Which project?',
        options: [
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ],
      },
      createdAt: 'x',
    };
    renderItem(ev, { answeredMap: { q1: { optionId: 'a' } } });
    const alpha = screen.getByRole('button', { name: 'Alpha' });
    expect(alpha).toBeDisabled();
    expect(alpha).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Beta' })).toBeDisabled();
  });

  it('F3 a resolved free-text question renders the resolved answer text', () => {
    mockAgentAssistant.value = true;
    const ev: AgentEvent = {
      id: 'e10',
      runId: 'r1',
      type: 'status',
      payload: { kind: 'question', questionId: 'q2', prompt: 'Anything else?', options: [], allowFreeText: true },
      createdAt: 'x',
    };
    renderItem(ev, { answeredMap: { q2: { freeText: 'Yes, urgent' } } });
    expect(screen.getByText(/yes, urgent/i)).toBeInTheDocument();
  });
});
