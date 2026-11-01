/**
 * The real AssistantPanel driven by the real PmoNativeRuntime, with only `fetch` (the agent-chat
 * wire) replaced. Moved down from the browser: the answers are scripted either way, so what these
 * prove is the client contract: what the panel shows, what it POSTs, and what it withholds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';

vi.mock('@/src/lib/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/features')>();
  return {
    ...actual,
    isFeatureEnabled: (key: string) => key === 'agentAssistant',
    FEATURES: { agentAssistant: true, aiComposer: false, userViews: false, incidents: false },
  };
});
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ session: { access_token: 'caller-jwt' }, currentUser: { id: 'u-1', org_id: 'org-1' } }) }));
vi.mock('@/src/lib/db/agentThreads', () => ({ listAgentThreads: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/db/agentEvents', () => ({ listRunEvents: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/db/agentRuns', () => ({
  getRunHeartbeat: vi.fn().mockResolvedValue({ last_progress_at: new Date().toISOString(), status: 'running' }),
}));

import { AgentRuntimeProvider } from '@/src/lib/agent/runtime/AgentRuntimeProvider';
import { useAgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import { AgentContextProvider } from '@/src/lib/agent/context/AgentContextProvider';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
import { encodeSse } from '@/src/lib/agent/runtime/transport';
import type { AgentEvent } from '@/src/lib/agent/runtime/port';
import { AssistantPanel } from './AssistantPanel';

const RUN_ID = 'native-run-1';
const PENDING_ID = 'abc-123';
const CONTACT_ID = 'contact-xyz-001';
const HUMAN_SUMMARY = 'Log a call activity on contact XYZ';
const ARGS = { contactId: CONTACT_ID, kind: 'call', subject: 'Follow-up' };

const ev = (type: AgentEvent['type'], extra: Partial<AgentEvent> = {}): AgentEvent => ({
  id: crypto.randomUUID(),
  runId: RUN_ID,
  type,
  createdAt: new Date().toISOString(),
  ...extra,
});
const needsApproval = (actionName: string, humanSummary: string, structuredArgs: unknown) =>
  ev('status', { payload: { status: 'needs-approval', pendingId: PENDING_ID, actionName, humanSummary, structuredArgs } });
const completed = () => ev('status', { payload: { status: 'completed' } });

function stream(events: AgentEvent[]) {
  const bytes = new TextEncoder().encode(events.map(encodeSse).join(''));
  return {
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
  };
}

/** Replies with `turns[n]` to the n-th POST and records every request body. */
function scriptedFetch(turns: AgentEvent[][]) {
  const posted: Array<Record<string, unknown>> = [];
  const returned: AgentEvent[][] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    const turn = turns[posted.length - 1] ?? [completed()];
    returned.push(turn);
    return stream(turn);
  });
  // The real runtime calls the global fetch: this is the only thing replaced.
  vi.stubGlobal('fetch', fetchImpl);
  return { fetchImpl, posted, returned };
}

const Publisher: React.FC<{ entity?: { type: string; id: string; label: string } }> = ({ entity }) => {
  const { setEntity } = useAgentContext();
  React.useLayoutEffect(() => {
    if (!entity) return;
    setEntity(entity);
    return () => setEntity(undefined);
  }, [entity, setEntity]);
  return null;
};

/** Opens the panel the way the shell does: through the runtime context. */
const OpenPanel: React.FC = () => {
  const { openPanel } = useAgentRuntimeContext();
  React.useEffect(() => { openPanel(); }, [openPanel]);
  return null;
};

function renderPanel(_fetchImpl: unknown, opts: { route?: string; entity?: { type: string; id: string; label: string } } = {}) {
  return render(
    <MemoryRouter initialEntries={[opts.route ?? '/']}>
      <AgentContextProvider>
        <AgentRuntimeProvider>
          <OpenPanel />
          <Publisher entity={opts.entity} />
          <AssistantPanel />
        </AgentRuntimeProvider>
      </AgentContextProvider>
    </MemoryRouter>,
  );
}

async function ask(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: /ask a question/i }), text);
  await user.keyboard('{Enter}');
  return user;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AssistantPanel + PmoNativeRuntime: write approval', () => {
  it('AC-AW-012 Approve: propose → chip → Approve → write dispatched and acknowledged; composer re-enables', async () => {
    const { fetchImpl, posted, returned } = scriptedFetch([
      [needsApproval('create_activity', HUMAN_SUMMARY, ARGS)],
      [
        ev('tool', { payload: { name: 'create_activity', pendingId: PENDING_ID, args: ARGS, result: { id: 'act-1' } } }),
        ev('system', { text: 'approved', payload: { event: 'write_resolved', decision: 'approved', actionName: 'create_activity', pendingId: PENDING_ID } }),
        ev('assistant', { text: "Done — I've logged the call activity." }),
        completed(),
      ],
    ]);
    renderPanel(fetchImpl);
    const user = await ask('Log a call with the Acme contact');

    expect(await screen.findByText(HUMAN_SUMMARY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
    // Composer is locked while the approval is pending (Stop replaces Send).
    expect(screen.getByRole('button', { name: /stop generating/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /approve/i }));

    expect(await screen.findByText(/logged the call activity/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /send message/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /stop generating/i })).not.toBeInTheDocument();

    // The second POST really carried the approval for the proposed action.
    expect(posted).toHaveLength(2);
    expect(posted[0].decision).toBeUndefined();
    expect(posted[1].decision).toEqual({ pendingId: PENDING_ID, verdict: 'approve' });
    // The approved turn returned the write for the same args the chip proposed.
    const tool = returned[1].find((e) => e.type === 'tool');
    expect(tool?.payload).toMatchObject({ name: 'create_activity', pendingId: PENDING_ID, args: ARGS });
  });

  it('AC-AW-012 Deny: propose → chip → Deny → Denied shown; rejection posted; no write result', async () => {
    const { fetchImpl, posted, returned } = scriptedFetch([
      [needsApproval('create_activity', HUMAN_SUMMARY, ARGS)],
      [
        ev('system', { text: 'rejected', payload: { event: 'write_resolved', decision: 'rejected', actionName: 'create_activity', pendingId: PENDING_ID } }),
        ev('assistant', { text: "Understood, I won't log that activity." }),
        completed(),
      ],
    ]);
    renderPanel(fetchImpl);
    const user = await ask('Log a call with the Acme contact');

    await user.click(await screen.findByRole('button', { name: /deny/i }));

    expect((await screen.findAllByText(/denied/i)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/won't log that activity/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /send message/i })).toBeInTheDocument();

    expect(posted).toHaveLength(2);
    expect(posted[1].decision).toEqual({ pendingId: PENDING_ID, verdict: 'reject' });
    // Nothing the panel was given on the deny turn is a write result.
    expect(returned[1].some((e) => e.type === 'tool')).toBe(false);
    expect(returned[1].some((e) => (e.payload as { name?: string } | undefined)?.name === 'create_activity')).toBe(false);
  });

  it('AC-AXP-012 a recurring request renders the create_automation approval UI, not prose', async () => {
    const summary = 'Create an automation: every Monday review overdue tasks';
    const { fetchImpl, posted } = scriptedFetch([
      [needsApproval('create_automation', summary, { kind: 'schedule', prompt: 'review overdue tasks', schedule: '0 9 * * 1' })],
    ]);
    renderPanel(fetchImpl);
    await ask('remind me every Monday to review overdue tasks');

    expect(await screen.findByText(summary)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
    expect(screen.queryByText(/create_automation/i)).not.toBeInTheDocument();
    expect(posted[0].decision).toBeUndefined();
  });
});

describe('AssistantPanel + PmoNativeRuntime: route context', () => {
  it('AC-AXP-016 "summarize this" on a project page grounds the turn to the viewed project', async () => {
    const entity = { type: 'project', id: '40000000-0000-0000-0000-000000000001', label: 'Meridian Rooftop PV' };
    const { fetchImpl, posted } = scriptedFetch([
      [ev('assistant', { text: 'Summary for this project: procurement and budget signals are available.' }), completed()],
    ]);
    renderPanel(fetchImpl, { route: `/projects/${entity.id}`, entity });
    await ask('summarize this');

    expect(await screen.findByText(/summary for this project/i)).toBeInTheDocument();
    await waitFor(() => expect(posted.length).toBeGreaterThanOrEqual(1));
    expect((posted[0].context as { entity?: unknown }).entity).toEqual(entity);
  });
});
