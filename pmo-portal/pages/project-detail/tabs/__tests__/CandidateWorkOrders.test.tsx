/** #2595 candidate work orders on the project Contract tab: hidden until used (AC-CWO-018), blocked accept names the items, roles, decision. */
import React from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  can: { create: true, edit: true, approve: true } as Record<string, boolean>,
  list: vi.fn(), listTemplate: vi.fn(), decide: vi.fn(), updateItem: vi.fn(), create: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { workOrderCandidate: { list: h.list, listTemplate: h.listTemplate, decide: h.decide, updateItem: h.updateItem, create: h.create, proofUrl: vi.fn() }, profile: { listOrgProfiles: async () => [] } },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u', org_id: 'o', role: 'Project Manager' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string) => h.can[action] ?? false }));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-21' }));
import { CandidateWorkOrders } from '../CandidateWorkOrders';

const item = (over: Record<string, unknown>) => ({
  id: 'i', candidate_id: 'c1', label: 'Item', position: 1, required: true, status: 'open', owner_id: null, owner_name: null, target_date: null, note: null, proofs: [], ...over,
});
const candidate = (over: Record<string, unknown> = {}) => ({
  id: 'c1', org_id: 'o', project_id: 'p1', title: 'Pipe repair', description: null, client_reference: 'REF-1', offered_on: '2026-11-20', status: 'assessing',
  decided_by: null, decided_at: null, decision_reason: null, work_order_id: null, replaces_id: null,
  items: [item({ id: 'i1', label: 'Site check' }), item({ id: 'i2', label: 'Material', position: 2, status: 'passed' })], ...over,
});
const renderTab = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ToastProvider><CandidateWorkOrders projectId="p1" projectManagerId="u" /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  h.can = { create: true, edit: true, approve: true };
  h.list.mockResolvedValue([candidate()]);
  h.listTemplate.mockResolvedValue([{ id: 't1', label: 'Site check', position: 1, required: true }]);
  h.decide.mockResolvedValue({ status: 'rejected', work_order_id: null });
  h.updateItem.mockResolvedValue(undefined);
});

describe('AC-CWO-018 hidden until used', () => {
  it('shows nothing when the organisation has no checklist and the project has no candidate', async () => {
    h.list.mockResolvedValue([]); h.listTemplate.mockResolvedValue([]);
    renderTab();
    await vi.waitFor(() => expect(h.list).toHaveBeenCalled());
    await vi.waitFor(() => expect(h.listTemplate).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('candidate-work-orders')).toBeNull();
    expect(screen.queryByText('Candidate work orders')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New candidate' })).toBeNull();
  });
  it('shows the section once the organisation has a checklist item', async () => {
    h.list.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByRole('region', { name: 'Candidate work orders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New candidate' })).toBeInTheDocument();
  });
  it('shows the section for a project that already has a candidate even with no checklist now', async () => {
    h.listTemplate.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('Pipe repair')).toBeInTheDocument();
  });
});

describe('decision', () => {
  it('explains which required checks block acceptance and disables Accept; Reject stays available', async () => {
    renderTab();
    expect(await screen.findByText('Not ready to accept: Site check')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
    expect(screen.getByText('1 of 2 required checks ready')).toBeInTheDocument();
  });

  it('rejects with a typed reason, which the RPC receives', async () => {
    renderTab();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    await user.type(within(dialog).getByRole('textbox'), 'Site not reachable');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(h.decide).toHaveBeenCalledWith('c1', 'rejected', 'Site not reachable');
  });

  it('accepts when every required check is ready and says a draft work order is created', async () => {
    h.list.mockResolvedValue([candidate({ items: [item({ id: 'i1', label: 'Site check', status: 'passed' })] })]);
    h.decide.mockResolvedValue({ status: 'accepted', work_order_id: 'w1' });
    renderTab();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    expect(within(dialog).getByText(/creates a draft work order/i)).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox'), 'Confirmed');
    await user.click(within(dialog).getByRole('button', { name: 'Accept' }));
    expect(h.decide).toHaveBeenCalledWith('c1', 'accepted', 'Confirmed');
  });

  it('draws no decision buttons and no edit controls for someone who cannot decide or assess', async () => {
    h.can = { create: false, edit: false, approve: false };
    renderTab();
    await screen.findByText('Pipe repair');
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New candidate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attach proof' })).toBeNull();
  });

  it('a decided candidate shows its reason and links the draft work order, with no controls', async () => {
    h.list.mockResolvedValue([candidate({ status: 'accepted', decision_reason: 'Confirmed on site', work_order_id: 'w9' })]);
    renderTab();
    expect(await screen.findByText('Confirmed on site')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the draft work order' })).toHaveAttribute('href', '/work-orders/w9');
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('marking an item not applicable without a note asks for the note instead of writing', async () => {
    renderTab();
    const user = userEvent.setup();
    const selects = await screen.findAllByRole('combobox', { name: 'Result' });
    await user.selectOptions(selects[0], 'not_applicable');
    expect(await screen.findByText('Add a note to mark this not applicable.')).toBeInTheDocument();
    expect(h.updateItem).not.toHaveBeenCalled();
  });

  it('sets an item result through the repository', async () => {
    renderTab();
    const user = userEvent.setup();
    const selects = await screen.findAllByRole('combobox', { name: 'Result' });
    await user.selectOptions(selects[0], 'passed');
    expect(h.updateItem).toHaveBeenCalledWith('i1', { status: 'passed' });
  });
});
