import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const runtime = vi.hoisted(() => ({ createRun: vi.fn(), followUp: vi.fn(), control: vi.fn(), subscribe: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ session: { access_token: 'test' } }) }));
vi.mock('@/src/lib/agent/runtime/pmoNativeRuntime', () => ({
  PmoNativeRuntime: class {
    createRun = runtime.createRun;
    followUp = runtime.followUp;
    control = runtime.control;
    subscribe = runtime.subscribe;
  },
}));
vi.mock('@/src/lib/features', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/lib/features')>(),
  isFeatureEnabled: (key: string) => key === 'agentAssistant',
}));
vi.mock('@/src/hooks/useReferenceRecordSearch', () => ({
  useReferenceRecordSearch: () => ({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/lib/db/agentThreads', () => ({ listAgentThreads: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/db/agentEvents', () => ({ listRunEvents: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/db/agentRuns', () => ({ getRunHeartbeat: vi.fn().mockResolvedValue({ last_progress_at: new Date().toISOString(), status: 'running' }) }));

vi.mock('@/src/hooks/useCachedRecordLists', () => ({ useCachedRecordLists: () => ({ lists: { projects: [], opportunities: [], procurements: [], companies: [], contacts: [], userViews: [] }, resolved: true }) }));
vi.mock('@/src/hooks/useRecordSearch', async (importOriginal) => ({ ...await importOriginal<typeof import('@/src/hooks/useRecordSearch')>(), useRecordSearch: () => ({ records: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: { agent_assistant: true } }) }));
vi.mock('@/src/auth/useIsOperator', () => ({ useOperatorMembership: () => ({ isOperator: false, isError: false }) }));
const roleState = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@/src/auth/impersonation', async (importOriginal) => ({ ...await importOriginal<typeof import('@/src/auth/impersonation')>(), useOptionalRealRole: () => roleState.value }));
const setEntity = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/agent/context/useAgentContext', () => ({ useAgentContext: () => ({ setEntity, getContext: () => ({}) }), useAgentContextPublisher: () => ({ setEntity }), useAgentContextChange: () => '' }));
vi.mock('@/src/components/shell', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/components/shell')>(),
  AppShell: ({ assistant }: { assistant: React.ReactNode }) => <>{assistant}</>,
  Rail: () => null,
  ContextBar: () => null,
}));

import { AgentRuntimeProvider } from '@/src/lib/agent/runtime/AgentRuntimeProvider';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import { ShellChrome } from '@/App';

const LocationProbe = () => <output data-testid="location">{useLocation().pathname}</output>;
/** `App` mounts a QueryClientProvider above the shell (#2699's price-visibility sync reads the cache), so a
 * shell render has one too — a fresh client per render keeps the three tests from sharing a cache. */
const withQueryClient = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);
/** One harness for every shell render below: production mounts ImpersonationProvider in Shell,
 * above ShellChrome, and the shell's permission gates (ADR-0016 React bindings) read the real
 * role from it — so the harness mounts the same provider around the shell. */
const renderShell = (ui: React.ReactNode) =>
  render(
    withQueryClient(
      <MemoryRouter>
        <AgentRuntimeProvider>
          <ImpersonationProvider realRole={roleState.value as Role | null}>{ui}</ImpersonationProvider>
        </AgentRuntimeProvider>
      </MemoryRouter>,
    ),
  );
// The slot imports the panel chunk on first open; warm it so the cold jsdom import is not inside findByRole's 1 s.
beforeAll(async () => { await import('@/src/components/panel/AssistantPanel'); }, 60_000);
beforeEach(() => { roleState.value = null; });

describe('Ask AI palette integration', () => {
  it('AC-AT2-007: Ask AI opens a draft without sending until the user sends it', async () => {
    runtime.createRun.mockResolvedValue({ id: 'prefill-run', title: 'test', status: 'running' });
    runtime.subscribe.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { id: 'a', runId: 'prefill-run', type: 'assistant', text: 'I can help with that.', createdAt: new Date().toISOString() };
        yield { id: 'b', runId: 'prefill-run', type: 'status', payload: { status: 'completed' }, createdAt: new Date().toISOString() };
      },
    });
    const user = userEvent.setup();
    renderShell(<ShellChrome />);
    const query = 'show me vendor concentration risk';
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), query);
    await user.click(await screen.findByRole('option', { name: /ask ai/i }));
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();
    // The panel is lazy-loaded (#1978): wait for it to mount; the oracle is unchanged.
    expect(await screen.findByRole('complementary', { name: /agent assistant/i })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /ask a question/i })).toHaveValue(query);
    expect(screen.getByText(/ask your agent/i)).toBeVisible();
    expect(runtime.createRun).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /send message/i }));
    expect(await screen.findByText('I can help with that.')).toBeVisible();
    expect(runtime.createRun).toHaveBeenCalledTimes(1);
    expect(runtime.createRun).toHaveBeenCalledWith(expect.objectContaining({ goal: query }));
  });
});

describe('UXS-007 command palette discovery', () => {
  it('UXS-007: a Project Manager finds My Tasks, reads its context, and navigates there', async () => {
    roleState.value = 'Project Manager';
    const user = userEvent.setup();
    renderShell(<><ShellChrome /><LocationProbe /></>);
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), 'my tasks');
    const option = await screen.findByRole('option', { name: /my tasks/i });
    expect(option).toHaveTextContent('Your assigned work across projects');
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/my-tasks');
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();
  });

  it('UXS-007: Executive has no My Tasks option in the actual shell palette', async () => {
    roleState.value = 'Executive';
    const user = userEvent.setup();
    renderShell(<ShellChrome />);
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeVisible();
    await user.type(screen.getByRole('combobox'), 'my tasks');
    await screen.findByRole('option', { name: /ask ai/i });
    expect(screen.queryByRole('option', { name: /^my tasks/i })).not.toBeInTheDocument();
  });
});
