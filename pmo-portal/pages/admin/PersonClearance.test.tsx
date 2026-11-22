import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  enabled: vi.fn(), checklist: vi.fn(), summary: vi.fn(), saveState: vi.fn(), items: vi.fn(), canEdit: true,
}));
vi.mock('@/src/lib/repositories/clearance', () => ({
  clearanceRepository: { enabled: h.enabled, checklist: h.checklist, summary: h.summary, saveState: h.saveState, clearState: vi.fn(), items: h.items, setEnabled: vi.fn(), createItem: vi.fn(), updateItem: vi.fn() },
}));
vi.mock('@/src/lib/repositories/orgSwitches', async (orig) => ({ ...(await orig<typeof import('@/src/lib/repositories/orgSwitches')>()), orgSwitchRepository: { read: () => h.enabled(), write: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    documentExpiry: { getPerson: vi.fn().mockResolvedValue({ id: 'p1', name: 'Test Person', code: 'P-0001' }) },
    people: { list: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => h.canEdit,
  CanWrite: ({ children }: { children: React.ReactNode }) => (h.canEdit ? <>{children}</> : null),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o' } }) }));

import PersonClearance from './PersonClearance';
import Clearance from './Clearance';

const row = (o: Record<string, unknown>) => ({ item_id: 'i1', name: 'Item A', is_required: true, sort_order: 1, done_on: null, expires_on: null, note: null, state: 'missing', ...o });
const renderAt = (ui: React.ReactNode, path = '/administration/clearance/p1') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter initialEntries={[path]}><Routes><Route path="/administration/clearance/:personId" element={ui} /><Route path="*" element={ui} /></Routes></MemoryRouter></ToastProvider>
  </QueryClientProvider>,
);

beforeEach(() => {
  vi.clearAllMocks(); h.canEdit = true;
  h.enabled.mockResolvedValue(true);
  h.summary.mockResolvedValue([{ person_id: 'p1', required_count: 1, satisfied_count: 0, cleared: false }]);
  h.items.mockResolvedValue([]);
});

describe('AC-CLR-009 the person checklist', () => {
  it('lists items with their state and the not-cleared badge', async () => {
    h.checklist.mockResolvedValue([row({}), row({ item_id: 'i2', name: 'Item B', state: 'done', done_on: '2026-11-01' })]);
    renderAt(<PersonClearance />);
    expect(await screen.findByText('Item A')).toBeInTheDocument();
    expect(screen.getByText('Not done')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Not cleared')).toBeInTheDocument();
  });
  it('shows the Cleared badge when the database says cleared', async () => {
    h.checklist.mockResolvedValue([row({ state: 'done', done_on: '2026-11-01' })]);
    h.summary.mockResolvedValue([{ person_id: 'p1', required_count: 1, satisfied_count: 1, cleared: true }]);
    renderAt(<PersonClearance />);
    expect(await screen.findByText('Cleared')).toBeInTheDocument();
  });
  it('records a done date through the repository', async () => {
    h.checklist.mockResolvedValue([row({})]);
    h.saveState.mockResolvedValue(undefined);
    renderAt(<PersonClearance />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record Item A' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Date done/), '2026-11-02');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.saveState).toHaveBeenCalledWith('p1', 'i1', expect.objectContaining({ expires_on: null })));
  });
  it('hides the edit controls from a read-only role', async () => {
    h.canEdit = false;
    h.checklist.mockResolvedValue([row({})]);
    renderAt(<PersonClearance />);
    await screen.findByText('Item A');
    expect(screen.queryByRole('button', { name: 'Record Item A' })).toBeNull();
  });
  it('shows generic empty guidance when no items exist', async () => {
    h.checklist.mockResolvedValue([]);
    renderAt(<PersonClearance />);
    expect(await screen.findByText('No checklist items yet')).toBeInTheDocument();
  });
  it('AC-CLR-013 shows a not-enabled state while the setting is off', async () => {
    h.enabled.mockResolvedValue(false);
    renderAt(<PersonClearance />);
    expect(await screen.findByText('The clearance checklist is not turned on')).toBeInTheDocument();
    expect(h.checklist).not.toHaveBeenCalled();
  });
});

describe('AC-CLR-009 the Clearance section', () => {
  it('shows the not-enabled state while the setting is off', async () => {
    h.enabled.mockResolvedValue(false);
    renderAt(<Clearance />, '/administration/clearance');
    expect(await screen.findByText('The clearance checklist is not turned on')).toBeInTheDocument();
  });
  it('shows the generic empty guidance, with no item names, when enabled and no items exist', async () => {
    renderAt(<Clearance />, '/administration/clearance');
    expect(await screen.findByText('No checklist items yet')).toBeInTheDocument();
  });
});
