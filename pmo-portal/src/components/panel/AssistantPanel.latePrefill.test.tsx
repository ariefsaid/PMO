/**
 * AC-AT2-009 — a draft set by openPanel(prefill) before the (lazily loaded) panel mounts still seeds the composer.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { AgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import type { AgentRuntime } from '@/src/lib/agent/runtime/port';
import { AssistantPanel } from './AssistantPanel';

vi.mock('@/src/lib/db/agentThreads', () => ({ listAgentThreads: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/db/agentEvents', () => ({
  listRunEvents: vi.fn().mockResolvedValue([]),
  rateAgentEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/db/agentRuns', () => ({
  getRunHeartbeat: vi.fn().mockResolvedValue({ last_progress_at: new Date().toISOString(), status: 'running' }),
}));

const runtime = { createRun: vi.fn(), followUp: vi.fn(), control: vi.fn(), subscribe: vi.fn() } as unknown as AgentRuntime;

describe('AssistantPanel late mount', () => {
  it('AC-AT2-009 a prefill set before the panel mounts is in the textbox, and nothing is sent', async () => {
    const Late: React.FC = () => {
      const [mounted, setMounted] = React.useState(false);
      React.useEffect(() => setMounted(true), []); // the panel arrives after the draft is already held
      return (
        <AgentRuntimeContext.Provider
          value={{ runtime, open: true, openPanel: () => {}, closePanel: () => {}, togglePanel: () => {}, pendingPrefill: 'show me vendor concentration risk', clearPrefill: () => {} }}
        >
          <MemoryRouter>{mounted && <AssistantPanel />}</MemoryRouter>
        </AgentRuntimeContext.Provider>
      );
    };
    render(<Late />);
    expect(await screen.findByRole('textbox', { name: /ask a question/i })).toHaveValue('show me vendor concentration risk');
    expect(runtime.createRun).not.toHaveBeenCalled();
  });
});
