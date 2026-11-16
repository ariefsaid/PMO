/**
 * #2047 / #2392 — under Bahasa the panel's own chrome carries no English: not as visible text,
 * not as an accessible name (aria-label / title), not as sr-only text. Covers the empty, streaming,
 * tool-call and error states, docked and undocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { AgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '@/src/lib/agent/runtime/port';
import { AssistantPanel } from './AssistantPanel';
import { BahasaProvider } from '@/test/bahasa';

vi.mock('@/src/lib/db/agentThreads', () => ({ listAgentThreads: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/db/agentEvents', () => ({
  listRunEvents: vi.fn().mockResolvedValue([]),
  rateAgentEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/db/agentRuns', () => ({
  getRunHeartbeat: vi.fn().mockResolvedValue({ last_progress_at: new Date().toISOString(), status: 'running' }),
}));

const MODE_KEY = 'pmo.agentPanel.mode';
const ENGLISH = [/\bGood\b/, /\bBad\b/, /\bDock\b/, /\bHistory\b/, /\bNew conversation\b/, /\bClose\b/, /\bAgent assistant\b/, /Assistant:/];

const ev = (type: AgentEvent['type'], o: Partial<AgentEvent> = {}): AgentEvent => ({
  id: crypto.randomUUID(), runId: 'r1', type, createdAt: new Date().toISOString(), ...o,
});

function runtimeWith(events: AgentEvent[]): AgentRuntime {
  return {
    createRun: vi.fn().mockResolvedValue({ id: 'r1', title: 't', status: 'running' } as AgentRun),
    followUp: vi.fn().mockResolvedValue(undefined),
    control: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e; },
    }),
  };
}

function renderPanel(runtime: AgentRuntime) {
  const W: React.FC = () => {
    const [open, setOpen] = React.useState(true);
    return (
      <BahasaProvider>
        <AgentRuntimeContext.Provider
          value={{ runtime, open, openPanel: () => setOpen(true), closePanel: () => setOpen(false), togglePanel: () => setOpen((o) => !o) }}
        >
          <MemoryRouter><AssistantPanel /></MemoryRouter>
        </AgentRuntimeContext.Provider>
      </BahasaProvider>
    );
  };
  return render(<W />);
}

/** Every string a user or a screen reader can get from the panel: text, aria-label, title. */
function readable(): string[] {
  const out: string[] = [];
  document.body.querySelectorAll('*').forEach((el) => {
    for (const a of ['aria-label', 'title']) { const v = el.getAttribute(a); if (v) out.push(v); }
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim();
    if (own) out.push(own);
  });
  return out;
}
const expectNoEnglish = () => {
  const all = readable();
  for (const re of ENGLISH) expect(all.filter((s) => re.test(s)), String(re)).toEqual([]);
};

const SCENARIOS: Record<string, AgentEvent[]> = {
  empty: [],
  streaming: [ev('assistant', { text: 'Jawaban sebagian' })],
  'tool call': [ev('tool', { payload: { entity: 'projects', rowCount: 5 } }), ev('assistant', { text: 'Ada 5 proyek.' }), ev('status', { payload: { status: 'completed' } })],
  error: [ev('status', { payload: { status: 'errored', error: 'UPSTREAM_ERROR' } })],
};

describe.each(['overlay', 'docked'])('AssistantPanel under Bahasa (%s)', (mode) => {
  beforeEach(() => { localStorage.setItem(MODE_KEY, mode); vi.clearAllMocks(); });

  it.each(Object.keys(SCENARIOS))('#2392 no English chrome in the %s state', async (name) => {
    const user = userEvent.setup();
    renderPanel(runtimeWith(SCENARIOS[name]));
    if (name !== 'empty') {
      await user.type(screen.getByRole('textbox'), 'Halo{Enter}');
      await waitFor(() => expect(screen.getAllByText(/Halo/).length).toBeGreaterThan(0));
      if (name === 'tool call') await screen.findByText(/Ada 5 proyek/);
      if (name === 'error') await screen.findByText(/kesalahan/i);
    }
    expectNoEnglish();
  });
});
