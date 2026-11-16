import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { renderWithQueryClient } from '@/test/renderWithQueryClient';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { ProjectAttention } from './ProjectAttention';

const state = vi.hoisted(() => ({
  canCreate: true,
  receivables: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() },
  finances: { data: { remaining_to_invoice: '500' } as unknown, isPending: false, isError: false },
  billing: { data: { contractLines: [] as unknown[] } as unknown, isPending: false, isError: false },
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => (entity === 'salesInvoice' && action === 'create' ? state.canCreate : true),
}));
vi.mock('@/src/hooks/useProjectPosition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useProjectPosition')>()),
  useOverdueReceivables: () => state.receivables,
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => state.finances }));
vi.mock('@/src/hooks/useProgressBilling', () => ({ useProjectBilling: () => state.billing, useBoqItems: () => ({ data: [], isPending: false, isError: false }) }));

import { PrimaryProjectAction } from './ProjectSections';

const project = { id: 'p1', status: 'Ongoing Project', currency: 'USD', contract_value: 1_000 } as ProjectWithRefs;
const renderAction = (props: { chaseOnly?: boolean } = {}) =>
  renderWithQueryClient(<MemoryRouter><PrimaryProjectAction project={project} isPipeline={false} {...props} /></MemoryRouter>);

beforeEach(() => {
  state.canCreate = true;
  state.receivables = { data: null, isPending: false, isError: false, refetch: vi.fn() };
  state.finances = { data: { remaining_to_invoice: '500' }, isPending: false, isError: false };
  state.billing = { data: { contractLines: [] }, isPending: false, isError: false };
});

describe('AC-NBR-006 primary action holds its slot', () => {
  it('(P) finances pending: the slot shows its loading state with no label, then the right action once', () => {
    state.finances = { data: undefined, isPending: true, isError: false };
    const view = renderAction();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Raise invoice')).toBeNull();
    expect(screen.queryByText('Chase payment')).toBeNull();
    expect(screen.getByTestId('primary-action')).toHaveAttribute('aria-busy', 'true');
    state.finances = { data: { remaining_to_invoice: '500' }, isPending: false, isError: false };
    view.rerender(<MemoryRouter><PrimaryProjectAction project={project} isPipeline={false} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Raise invoice' })).toBeEnabled();
  });

  it('(P) receivables pending: loading state with no label (never a "Raise invoice" that turns into "Chase payment")', () => {
    state.receivables = { data: null, isPending: true, isError: false, refetch: vi.fn() };
    const view = renderAction();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Raise invoice')).toBeNull();
    expect(screen.getByTestId('primary-action')).toHaveAttribute('aria-busy', 'true');
    state.receivables = { data: { to: '/x' }, isPending: false, isError: false, refetch: vi.fn() };
    view.rerender(<MemoryRouter><PrimaryProjectAction project={project} isPipeline={false} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Chase payment' })).toBeEnabled();
  });

  it('(P) chase slot while receivables pending: loading state, no label', () => {
    state.receivables = { data: null, isPending: true, isError: false, refetch: vi.fn() };
    renderAction({ chaseOnly: true });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('primary-action')).toHaveAttribute('aria-busy', 'true');
  });

  it('(F) billing failed: the slot stays as a disabled button with the unavailable explanation', async () => {
    state.billing = { data: undefined, isPending: false, isError: true };
    renderAction();
    const button = screen.getByRole('button', { name: 'Raise invoice' });
    expect(button).toBeDisabled();
    await userEvent.hover(button.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Billing summary is unavailable.');
  });

  it('AC-NBR-006 a viewer without permission still sees none, even while reads are pending', () => {
    state.canCreate = false;
    state.finances = { data: undefined, isPending: true, isError: false };
    renderAction();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('AC-NBR-091 settled and not raisable renders nothing (the decision is unchanged)', () => {
    state.finances = { data: { remaining_to_invoice: '0' }, isPending: false, isError: false };
    renderAction();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('AC-NBR-005 attention card keeps settled rows', () => {
  const item = { key: 'phases', tone: 'danger' as const, what: 'Design is late', action: 'See tasks', to: '/projects/p1/tasks' };
  const view = (props: Partial<React.ComponentProps<typeof ProjectAttention>>) =>
    renderWithQueryClient(<MemoryRouter><ProjectAttention items={[]} {...props} /></MemoryRouter>);

  it('(P) rows from settled sources show beside one loading row; never "nothing needs you"', () => {
    view({ items: [item], isPending: true, pendingSources: ['receivables'] });
    expect(screen.getByTestId('project-attention-count-loading')).toBeInTheDocument();
    expect(screen.getByText('Design is late')).toBeInTheDocument();
    expect(screen.queryByText('Nothing needs you on this project right now.')).toBeNull();
    expect(screen.getAllByTestId('project-attention-pending')).toHaveLength(1);
  });

  it('B2 the count shows only when every source has loaded: no partial count that grows', () => {
    const two = { ...item, key: 'budget', what: 'Budget is over' };
    const v = view({ items: [item], isPending: true, pendingSources: ['receivables'] });
    expect(screen.queryByTestId('project-attention-count')).toBeNull();
    v.rerender(<MemoryRouter><ProjectAttention items={[item, two]} /></MemoryRouter>);
    expect(screen.getByTestId('project-attention-count')).toHaveTextContent('2');
    expect(screen.queryByTestId('project-attention-count-loading')).toBeNull();
  });

  it('(F) a failed source keeps the other rows and names what could not be checked', () => {
    view({ items: [item], error: { what: 'budget', retry: vi.fn() } });
    expect(screen.getByText('Design is late')).toBeInTheDocument();
    expect(screen.getByText(/Couldn't check budget/)).toBeInTheDocument();
  });

  it('AC-NBR-091 an empty pending card does not conclude "nothing needs you"', () => {
    view({ items: [], isPending: true, pendingSources: ['phases'] });
    expect(screen.queryByText('Nothing needs you on this project right now.')).toBeNull();
  });

  it('settled and empty concludes', () => {
    view({ items: [] });
    expect(screen.getByText('Nothing needs you on this project right now.')).toBeInTheDocument();
  });
});
