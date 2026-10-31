import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';

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
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {} }) }));
vi.mock('@/src/auth/useIsOperator', () => ({ useOperatorMembership: () => ({ isOperator: false, isError: false }) }));
const roleState = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@/src/auth/impersonation', async (importOriginal) => ({ ...await importOriginal<typeof import('@/src/auth/impersonation')>(), useOptionalRealRole: () => roleState.value }));
const setEntity = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/agent/context/useAgentContext', () => ({ useAgentContext: () => ({ setEntity, getContext: () => ({}) }) }));
vi.mock('@/src/components/shell', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/components/shell')>(),
  AppShell: ({ assistant }: { assistant: React.ReactNode }) => <>{assistant}</>,
  Rail: () => null,
  ContextBar: () => null,
}));

import { AgentRuntimeProvider } from '@/src/lib/agent/runtime/AgentRuntimeProvider';
import { ShellChrome } from '@/App';

const LocationProbe = () => <output data-testid="location">{useLocation().pathname}</output>;
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
    render(<MemoryRouter><AgentRuntimeProvider><ShellChrome /></AgentRuntimeProvider></MemoryRouter>);
    const query = 'show me vendor concentration risk';
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), query);
    await user.click(await screen.findByRole('option', { name: /ask ai/i }));
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /agent assistant/i })).toBeVisible();
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
    render(<MemoryRouter><AgentRuntimeProvider><ShellChrome /><LocationProbe /></AgentRuntimeProvider></MemoryRouter>);
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
    render(<MemoryRouter><AgentRuntimeProvider><ShellChrome /></AgentRuntimeProvider></MemoryRouter>);
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeVisible();
    await user.type(screen.getByRole('combobox'), 'my tasks');
    await screen.findByRole('option', { name: /ask ai/i });
    expect(screen.queryByRole('option', { name: /^my tasks/i })).not.toBeInTheDocument();
  });
});
