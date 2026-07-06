/**
 * TranscriptItem coexistence — markdown assistant prose vs typed widget registry (ADR-0049 §4).
 * FR-AXP-005/007.
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
  // FEATURE_KEYS: consumed transitively (orgFeatures.ts, imported via repositories/index.ts) by
  // TranscriptItem's widget registry — this test doesn't exercise org-feature gating, so it's a
  // module-load-safety stub, not a scenario mock.
  FEATURE_KEYS: ['incidents', 'crm', 'procurement', 'timesheets', 'import_export', 'agent_assistant', 'user_views'],
}));

import { TranscriptItem } from './TranscriptItem';
import type { TranscriptEntry } from '@/src/hooks/useAssistantPanel';
import type { AgentEvent } from '@/src/lib/agent/runtime/port';

function entry(event: AgentEvent): TranscriptEntry {
  return { key: event.id, event };
}

function renderItem(event: AgentEvent) {
  return render(
    <MemoryRouter>
      <TranscriptItem entry={entry(event)} />
    </MemoryRouter>,
  );
}

function widgetEvent(): AgentEvent {
  return {
    id: 'w1',
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
}

describe('TranscriptItem coexistence (ADR-0049 §4)', () => {
  it('AC-AXP-006 typed data_table still renders via registry', () => {
    mockAgentAssistant.value = true;
    renderItem(widgetEvent());

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-markdown')).toBeNull();
  });

  it('flag-off: typed data_table widget renders nothing (FR-AXP-007)', () => {
    mockAgentAssistant.value = false;
    const { container } = renderItem(widgetEvent());

    expect(container.textContent).toBe('');
    expect(screen.queryByRole('table')).toBeNull();
    mockAgentAssistant.value = true;
  });
});
