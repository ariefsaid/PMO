import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { AgentRuntimeContext } from '@/src/lib/agent/runtime/AgentRuntimeContext';
import type { AgentEvent, AgentRuntime } from '@/src/lib/agent/runtime/port';
import type { CompositionSpec } from '@/src/lib/viewspec/types';

const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], create: vi.fn(), currentUser: { id: 'test-user', org_id: 'test-org' } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: store.currentUser }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { userView: {
  list: () => Promise.resolve(store.rows),
  get: (id: string) => Promise.resolve(store.rows.find((row) => row.id === id) ?? null),
  create: store.create, update: vi.fn(), archive: vi.fn(), delete: vi.fn(),
} } }));
vi.mock('@/src/lib/viewspec/executor', () => ({ executeCompiledQuery: vi.fn().mockResolvedValue([{ status: 'active', count: 5 }, { status: 'on_hold', count: 2 }]) }));
vi.mock('@/src/lib/features', async (importOriginal) => ({ ...await importOriginal<typeof import('@/src/lib/features')>(), isFeatureEnabled: () => true }));
vi.mock('@/src/lib/db/agentThreads', () => ({ listAgentThreads: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/db/agentEvents', () => ({ listRunEvents: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/db/agentRuns', () => ({ getRunHeartbeat: vi.fn().mockResolvedValue({ last_progress_at: new Date().toISOString(), status: 'running' }) }));

import { AssistantPanel } from './AssistantPanel';
import MyViewsPage from '@/pages/MyViewsPage';
import UserViewRenderer from '@/pages/UserViewRenderer';

const spec: CompositionSpec = { version: 1, panels: [{ id: 'p1', primitive: 'StatusBarChart', querySpec: { entity: 'projects', select: ['status', 'id'], groupBy: 'status', aggregate: { fn: 'count', column: 'id', alias: 'count' } } }] };
const title = 'Active projects by status';
const LocationProbe = () => <output data-testid="location">{useLocation().pathname}</output>;

describe('AC-CV-015 compose and save view', () => {
  it('AC-CV-015: an assistant artifact is explicitly saved and opens from My Views', async () => {
    const user = userEvent.setup();
    store.rows = [];
    store.create.mockReset();
    store.create.mockImplementation(async (input: Record<string, unknown>) => {
      const row = { ...input, id: 'saved-view-1', org_id: 'test-org', user_id: 'test-user', description: null, archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      store.rows.push(row);
      return row;
    });
    const runId = 'compose-run';
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const event = (type: AgentEvent['type'], rest: Partial<AgentEvent>): AgentEvent => ({ id: crypto.randomUUID(), runId, type, createdAt: new Date().toISOString(), ...rest });
    const runtime: AgentRuntime = {
      createRun: vi.fn().mockResolvedValue({ id: runId, title: 'test', status: 'running' }),
      followUp: vi.fn(), control: vi.fn(),
      subscribe: () => ({ [Symbol.asyncIterator]: async function* () {
        await gate;
        yield event('assistant', { text: 'Here is a dashboard of your active projects by status:' });
        yield event('artifact', { payload: { kind: 'compose_view', spec, title, repairAttempts: 0, tokensUsed: 320 } });
        yield event('status', { payload: { status: 'completed' } });
      } }),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><ToastProvider><MemoryRouter initialEntries={['/']}><AgentRuntimeContext.Provider value={{ runtime, open: true, openPanel: vi.fn(), closePanel: vi.fn(), togglePanel: vi.fn() }}><AssistantPanel /><LocationProbe /><Routes><Route path="/" element={<Link to="/views">My Views</Link>} /><Route path="/views" element={<MyViewsPage />} /><Route path="/views/:viewId" element={<UserViewRenderer />} /></Routes></AgentRuntimeContext.Provider></MemoryRouter></ToastProvider></QueryClientProvider>);
    await user.type(screen.getByRole('textbox', { name: /ask a question/i }), 'show me active projects by status{Enter}');
    try {
      expect(await screen.findByRole('button', { name: /stop generating/i })).toBeVisible();
      expect(screen.getByRole('textbox', { name: /ask a question/i })).toBeDisabled();
    } finally { release(); }
    expect(await screen.findByText(/here is a dashboard/i)).toBeVisible();
    const artifact = await screen.findByRole('region', { name: /active projects by status/i });
    expect(artifact).toBeVisible();
    expect(store.create).not.toHaveBeenCalled();
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText('Saved', { exact: true })).toBeVisible();
    expect(screen.getByRole('link', { name: /open view/i })).toBeVisible();
    expect(store.create).toHaveBeenCalledTimes(1);
    // Navigate through the router as a user would when opening My Views.
    await user.click(screen.getByRole('link', { name: 'My Views' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/views');
    await user.click(await screen.findByRole('link', { name: title }));
    expect(screen.getByTestId('location')).toHaveTextContent('/views/saved-view-1');
    expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeVisible();
  });
});
