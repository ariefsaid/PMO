import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { PipelineProject } from '@/src/lib/db/dashboard';

const dnd = vi.hoisted(() => ({
  props: null as null | {
    onMove: (c: string, k: string) => void;
    canDrop: (c: string, k: string) => boolean;
    isHome: (c: string, k: string) => boolean;
  },
}));
vi.mock('@/src/components/kanban/BoardDnd', () => ({
  BoardDnd: (p: { children: React.ReactNode; onMove: never; canDrop: never; isHome: never }) => {
    dnd.props = p;
    return <>{p.children}</>;
  },
  DroppableColumn: ({ children, testId }: { children: (s: undefined) => React.ReactNode; testId?: string }) => (
    <div data-testid={testId}>{children(undefined)}</div>
  ),
  DraggableCard: ({ children, moveState, disabled }: { children: React.ReactNode; moveState?: string | null; disabled?: boolean }) => (
    <div data-drag-state={moveState ?? undefined} data-drag-disabled={disabled ? 'true' : undefined}>{children}</div>
  ),
}));

let role = 'Project Manager';
const mutateAsync = vi.fn();
const eligibility = vi.fn(async (_id: string): Promise<string> => 'allowed');
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutateAsync, isPending: false, erpSetupPending: false }),
  winEligibilityQueryOptions: (_u: unknown, id: string) => ({ queryKey: ['wel', id], queryFn: () => eligibility(id), staleTime: 0 }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', role, manager_id: null } }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: role, realRole: role, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

import DraggableSalesBoard from '../DraggableSalesBoard';

const deal = (id: string, status: PipelineProject['status']): PipelineProject => ({
  id,
  name: `${id} deal`,
  short_name: null,
  client_name: 'Acme',
  status,
  contract_value: 1000,
  currency: 'USD',
  tax_treatment: 'exclusive',
  win_probability: 0.4,
});
const projects = [deal('tender', 'Tender Submitted')];

let qc: QueryClient;
const renderBoard = () =>
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DraggableSalesBoard projects={projects} onOpen={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  );
const drop = (id: string, col: string) =>
  act(async () => {
    dnd.props!.onMove(id, col);
  });

beforeEach(() => {
  vi.clearAllMocks();
  role = 'Project Manager';
  mutateAsync.mockResolvedValue({ erpSetupPending: false });
  eligibility.mockResolvedValue('allowed');
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

describe('DraggableSalesBoard - Lost Reason (AC-LR-012)', () => {
  it('AC-LR-012: drop on Lost, pick Declined + reason Our capacity submits reason and note', async () => {
    const user = userEvent.setup();
    renderBoard();
    await drop('tender', 'stage-Lost');

    expect(await screen.findByText('Mark project as lost')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Mark lost' });
    expect(confirm).toBeDisabled();

    // Pick Declined
    await user.click(screen.getByRole('radio', { name: 'Declined' }));
    // Still disabled without reason
    expect(confirm).toBeDisabled();

    // Pick reason "Our capacity"
    const reasonSelect = screen.getByRole('combobox', { name: /Reason/i });
    await user.selectOptions(reasonSelect, 'capacity');
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'tender',
      to: 'Declined',
      opts: { lostReason: 'capacity', lostNote: undefined },
    });
  });
});
