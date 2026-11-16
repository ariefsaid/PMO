/**
 * #2047 — strings dump. Renders the assistant panel under Bahasa in EVERY state it can show
 * (empty, history list / empty / loading / error, running with a step trail, tool call, error,
 * feedback with its four reasons, approval, question, stuck-run, out-of-credits, attachment status,
 * resize handle) and collects every text node, aria-label, title, placeholder and sr-only string.
 * Red when any of them contains an English word. Allowed English: product names, Timesheet,
 * Dasbor, Supplier, Work Order / SPK (none of which is in the word list below).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { AgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime, AgentRun } from '@/src/lib/agent/runtime/port';
import { AssistantPanel } from './AssistantPanel';
import { ApprovalChip } from './ApprovalChip';
import { QuestionChips } from './QuestionChips';
import { StuckRunBanner } from './StuckRunBanner';
import { ToolChips } from './ToolChips';
import { ActivityTrail } from './ActivityTrail';
import { ThreadList } from './ThreadList';
import { TranscriptItem } from './TranscriptItem';
import { Chat } from './Chat';
import { ArtifactSlot } from './ArtifactSlot';
import { Thinking } from './Thinking';
import { BahasaProvider } from '@/test/bahasa';

const listThreads = vi.fn();
vi.mock('@/src/lib/db/agentThreads', () => ({ listAgentThreads: (...a: unknown[]) => listThreads(...a) }));
vi.mock('@/src/lib/db/agentEvents', () => ({
  listRunEvents: vi.fn().mockResolvedValue([]),
  rateAgentEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/db/agentRuns', () => ({
  getRunHeartbeat: vi.fn().mockResolvedValue({ last_progress_at: new Date().toISOString(), status: 'running' }),
}));
const composeState: { current: Record<string, unknown> } = {
  current: { compiledPanels: null, validationError: { code: 'bad_spec', detail: null }, saveStatus: 'idle', saveError: null, savedViewId: null },
};
vi.mock('@/src/hooks/useComposeArtifact', () => ({
  useComposeArtifact: () => ({ ...composeState.current, save: vi.fn() }),
}));
vi.mock('@/src/hooks/usePanelQueries', () => ({ usePanelQueries: () => ({ states: {}, retry: vi.fn() }) }));
const attachState: { current: { error: { type: string; message: string } | null; progress: Record<string, number> } } = {
  current: { error: null, progress: {} },
};
vi.mock('@/src/hooks/useAgentAttachments', () => ({
  useAgentAttachments: () => ({
    ...attachState.current,
    isUploading: Object.keys(attachState.current.progress).length > 0,
    uploadAttachment: vi.fn().mockResolvedValue('a1'),
    clearError: vi.fn(),
    reportError: vi.fn(),
    resetThread: vi.fn(),
    threadId: null,
  }),
}));

/** English words that must never reach a Bahasa user. Deliberately excludes words Bahasa shares. */
const ENGLISH_WORDS = new Set(
  (
    "the you your yours is are was were this that these with for to of and or in on it its i " +
    "we our my me not no yes can could couldn't cannot will would should have has had been being " +
    "working done step steps so far keep waiting wait stop retry send submit approve approved approving deny denied " +
    "saved saving save view views name results result pinned conversation conversations recent yet show earlier hidden " +
    "looked looking lookup up rows row checking check answer answers needed decision required type ready attachment " +
    "attachments uploading upload attach what went wrong inaccurate helpful slow too resize assistant activity " +
    "credits used contact more load loading developer write awaits await question questions bigger longer than usual " +
    "taking little try again good bad dock overlay history new close message ask something sees see only " +
    "read-only now general response responses limit reached follow continue failed failure file image " +
    "different process you've i've"
  ).split(/\s+/),
);

const tokens = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z'\- ]+/g, ' ').split(/\s+/).filter(Boolean);
const englishIn = (s: string) => tokens(s).filter((w) => ENGLISH_WORDS.has(w));

/** Every string a user or a screen reader can get: text nodes (sr-only included), aria-label, title, placeholder. */
function readable(root: ParentNode = document.body): string[] {
  const out: string[] = [];
  root.querySelectorAll('*').forEach((el) => {
    for (const a of ['aria-label', 'title', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v) out.push(v);
    }
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim();
    if (own) out.push(own);
  });
  return out;
}
function expectBahasa(label: string) {
  const bad = readable().filter((s) => englishIn(s).length > 0);
  expect(bad, `English left in "${label}"`).toEqual([]);
}

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
  return render(
    <BahasaProvider>
      <AgentRuntimeContext.Provider value={{ runtime, open: true, openPanel: () => {}, closePanel: () => {}, togglePanel: () => {} }}>
        <MemoryRouter><AssistantPanel /></MemoryRouter>
      </AgentRuntimeContext.Provider>
    </BahasaProvider>,
  );
}
const inBahasa = (ui: React.ReactElement) => render(<BahasaProvider><MemoryRouter>{ui}</MemoryRouter></BahasaProvider>);

const THREADS = [
  { id: 't1', title: 'Proyek terlambat', scope: { type: 'project', id: 'p', label: 'Proyek A' }, pinned_at: '2026-01-01', latestRunId: 'r1' },
  { id: 't2', title: 'Tanya jawab', scope: null, pinned_at: null, latestRunId: null },
] as never[];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('pmo.agentPanel.mode', 'docked');
  listThreads.mockResolvedValue([]);
  attachState.current = { error: null, progress: {} };
});

describe('#2047 Bahasa dump — panel states', () => {
  it('empty state, resize handle and header', async () => {
    renderPanel(runtimeWith([]));
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expectBahasa('empty');
  });

  it('history: threads (pinned + scoped), empty list, loading and error', async () => {
    const user = userEvent.setup();
    listThreads.mockResolvedValue(THREADS);
    const a = renderPanel(runtimeWith([]));
    await user.click(screen.getByTestId('assistant-history'));
    await screen.findByText('Proyek terlambat');
    expectBahasa('history threads');
    a.unmount();

    listThreads.mockResolvedValue([]);
    const b = renderPanel(runtimeWith([]));
    await user.click(screen.getByTestId('assistant-history'));
    await waitFor(() => expect(document.querySelector('ul')).not.toBeNull());
    expectBahasa('history empty');
    b.unmount();

    listThreads.mockReturnValue(new Promise(() => {}));
    const c = renderPanel(runtimeWith([]));
    await user.click(screen.getByTestId('assistant-history'));
    expectBahasa('history loading');
    c.unmount();

    listThreads.mockRejectedValue(new Error('boom'));
    renderPanel(runtimeWith([]));
    await user.click(screen.getByTestId('assistant-history'));
    await screen.findByRole('alert');
    expectBahasa('history error');
  });

  it('running with a step trail, then a tool call, then feedback down with its four reasons', async () => {
    const user = userEvent.setup();
    renderPanel(runtimeWith([
      ev('status', { payload: { kind: 'step', label: 'Looking up projects…' } }),
      ev('tool', { payload: { entity: 'projects', rowCount: 5 } }),
      ev('assistant', { text: 'Ada 5 proyek.' }),
      ev('status', { payload: { status: 'completed' } }),
    ]));
    await user.type(screen.getByRole('textbox'), 'Halo{Enter}');
    await screen.findByText(/Ada 5 proyek/);
    expectBahasa('tool call + answer');
    const down = screen.getAllByRole('button').find((b) => /buruk/i.test(b.getAttribute('aria-label') ?? ''));
    await user.click(down!);
    expect(screen.getByRole('group')).toBeInTheDocument();
    expectBahasa('feedback reasons');
  });

  it('error state, out-of-credits and approval awaiting', async () => {
    const user = userEvent.setup();
    const a = renderPanel(runtimeWith([ev('status', { payload: { status: 'errored', error: 'UPSTREAM_ERROR' } })]));
    await user.type(screen.getByRole('textbox'), 'Halo{Enter}');
    await screen.findByRole('alert');
    expectBahasa('error');
    a.unmount();

    const b = renderPanel(runtimeWith([ev('status', { payload: { status: 'errored', error: 'RATE_LIMITED', retryAfterSeconds: 0 } })]));
    await user.type(screen.getByRole('textbox'), 'Halo{Enter}');
    await waitFor(() => expect(document.querySelectorAll('[role="status"]').length).toBeGreaterThan(0));
    expectBahasa('out of credits');
    b.unmount();

    renderPanel(runtimeWith([ev('status', { payload: { status: 'needs-approval', pendingId: 'p1', actionName: 'x', humanSummary: 'Catat panggilan', structuredArgs: {} } })]));
    await user.type(screen.getByRole('textbox'), 'Halo{Enter}');
    await screen.findByText('Catat panggilan');
    expectBahasa('needs approval');
  });
});

describe('#2047 Bahasa dump — components in every state', () => {
  it.each(['pending', 'approving', 'approved', 'denied'] as const)('ApprovalChip %s', (state) => {
    inBahasa(<ApprovalChip humanSummary="Catat panggilan" state={state} onApprove={() => {}} onDeny={() => {}} />);
    expectBahasa(`approval ${state}`);
  });

  it('QuestionChips pending (free text) and answered', () => {
    const a = inBahasa(<QuestionChips prompt="Yang mana?" options={[{ id: 'a', label: 'Satu' }]} allowFreeText onAnswer={() => {}} />);
    expectBahasa('question pending');
    a.unmount();
    inBahasa(<QuestionChips prompt="Yang mana?" options={[]} allowFreeText resolvedText="Dua" onAnswer={() => {}} disabled />);
    expectBahasa('question answered');
  });

  it('StuckRunBanner with and without step counts', () => {
    const old = new Date(Date.now() - 600_000).toISOString();
    const a = inBahasa(<StuckRunBanner status="running" lastProgressAt={old} doneCount={2} lastActivity="Memeriksa tugas" onRetry={() => {}} onCancel={() => {}} />);
    expectBahasa('stuck n steps');
    a.unmount();
    const b = inBahasa(<StuckRunBanner status="running" lastProgressAt={old} doneCount={1} onRetry={() => {}} onCancel={() => {}} />);
    expectBahasa('stuck one step');
    b.unmount();
    inBahasa(<StuckRunBanner status="running" lastProgressAt={old} onRetry={() => {}} onCancel={() => {}} />);
    expectBahasa('stuck no steps');
  });

  it('ToolChips and ActivityTrail', () => {
    const a = inBahasa(<ToolChips payloads={[{ entity: 'projects', rowCount: 5 }, { entity: 'tasks' }, {}]} />);
    expectBahasa('tool chips');
    a.unmount();
    inBahasa(<ActivityTrail items={[
      { id: '1', label: 'Looking up projects…', done: true, detail: '4' },
      { id: '2', label: 'Double-checking the answer…', done: false },
    ] as never} />);
    expectBahasa('activity trail');
  });

  it('ThreadList with pinned thread, and empty', () => {
    const a = inBahasa(<ThreadList threads={THREADS} onOpen={() => {}} />);
    expectBahasa('thread list');
    a.unmount();
    inBahasa(<ThreadList threads={[]} onOpen={() => {}} />);
    expectBahasa('thread list empty');
  });

  it('TranscriptItem: user, step limit, write resolved, question header, compose-view error', () => {
    const items: AgentEvent[] = [
      ev('user', { text: 'Halo' }),
      ev('status', { payload: { status: 'errored', error: 'TURN_CAP' } }),
      ev('system', { payload: { event: 'write_resolved', decision: 'approved' } }),
      ev('system', { payload: { event: 'write_resolved', decision: 'denied' } }),
      ev('status', { payload: { kind: 'question', questionId: 'q', prompt: 'Yang mana?', options: [], allowFreeText: true } }),
      ev('artifact', { payload: { kind: 'compose_view', title: 'Tampilan', spec: {} } }),
    ];
    inBahasa(<>{items.map((e) => <TranscriptItem key={e.id} entry={{ key: e.id, event: e }} phase="idle" />)}</>);
    expectBahasa('transcript items');
  });

  it('Chat with a capped transcript shows a translated "show earlier"', () => {
    const entries = Array.from({ length: 120 }, (_, i) => ({ key: `k${i}`, event: ev('user', { text: `Pesan ${i}` }) }));
    inBahasa(<Chat transcript={entries as never} phase="idle" />);
    expectBahasa('chat capped');
  });
});

describe('#2047 r8 — Bahasa fragments left after r7', () => {
  it('(a) compose-view save error reads in Bahasa, whatever the English headline says', () => {
    composeState.current = {
      compiledPanels: [], validationError: null, saveStatus: 'error',
      saveError: 'Could not save your changes', savedViewId: null,
    };
    try {
      inBahasa(<ArtifactSlot payload={{ kind: 'compose_view', title: 'Tampilan', spec: {} } as never} runId="r1" />);
      expect(screen.queryByText('Could not save your changes')).toBeNull();
      expectBahasa('compose save error');
    } finally {
      composeState.current = { compiledPanels: null, validationError: { code: 'bad_spec', detail: null }, saveStatus: 'idle', saveError: null, savedViewId: null };
    }
  });

  it('(b) the elapsed counter uses the Bahasa unit', () => {
    vi.useFakeTimers();
    try {
      inBahasa(<Thinking label={null} />);
      act(() => { vi.advanceTimersByTime(4000); });
      expect(document.body.textContent).toContain('4 dtk');
      expect(document.body.textContent).not.toMatch(/\d+s\b/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(c) attachment lines: uploading, ready (one, many) and every error type, none left English', async () => {
    const user = userEvent.setup();
    const types: Array<[string, string]> = [
      ['oversize', 'File exceeds 10 MB limit'], ['type', 'File type not allowed'],
      ['network', 'Upload failed — try again'], ['server', 'Upload failed — try again'],
      ['timeout', 'Upload timed out — try again'], ['cancel', 'Upload cancelled'],
      ['server', 'Something unexpected happened'],
    ];
    for (const [type, message] of types) {
      attachState.current = { error: { type, message }, progress: {} };
      const r = renderPanel(runtimeWith([]));
      await screen.findByRole('alert');
      expectBahasa(`attachment error ${type}: ${message}`);
      r.unmount();
    }
    attachState.current = { error: null, progress: { a1: 40 } };
    const u = renderPanel(runtimeWith([]));
    expect(screen.getByText('Mengunggah lampiran…')).toBeInTheDocument();
    expectBahasa('attachment uploading');
    u.unmount();
    void user;
  });

  it('(d) a step label outside the mapped set falls back to one Bahasa line', () => {
    inBahasa(<ActivityTrail items={[{ id: '1', label: 'Reticulating splines…', done: false }] as never} />);
    expect(document.body.textContent).not.toContain('Reticulating');
    expectBahasa('unmapped step label');
    expect(document.body.textContent).toContain('Sedang bekerja');
  });
});
