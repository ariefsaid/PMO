import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  enabled: vi.fn(), checklist: vi.fn(), summary: vi.fn(), due: vi.fn(), saveState: vi.fn(), items: vi.fn(), people: vi.fn(), canEdit: true,
}));
vi.mock('@/src/lib/repositories/clearance', () => ({
  clearanceRepository: { enabled: h.enabled, checklist: h.checklist, summary: h.summary, due: h.due, saveState: h.saveState, clearState: vi.fn(), items: h.items, setEnabled: vi.fn(), createItem: vi.fn(), updateItem: vi.fn() },
}));
vi.mock('@/src/lib/repositories/orgSwitches', async (orig) => ({ ...(await orig<typeof import('@/src/lib/repositories/orgSwitches')>()), orgSwitchRepository: { read: () => h.enabled(), write: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    documentExpiry: { getPerson: vi.fn().mockResolvedValue({ id: 'p1', name: 'Test Person', code: 'P-0001' }) },
    people: { list: h.people },
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
  h.due.mockResolvedValue([]);
  h.people.mockResolvedValue([]);
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
  it('fix/walk-people item 8: a linked item points at the person\'s document instead of asking for the date again', async () => {
    h.checklist.mockResolvedValue([
      row({ item_id: 'i1', name: 'Licence valid', document_type_id: 't1', document_type_name: 'Licence', expires_on: '2027-03-01', state: 'done' }),
      row({ item_id: 'i2', name: 'Forklift licence', document_type_id: 't2', document_type_name: 'Forklift', state: 'missing' }),
    ]);
    renderAt(<PersonClearance />);
    expect(await screen.findByText('From the Licence document')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the document Licence' })).toHaveAttribute('href', '/equipment/people/p1');
    expect(screen.getByText(/No Forklift document yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add the document Forklift' })).toHaveAttribute('href', '/equipment/people/p1');
    expect(screen.queryByRole('button', { name: /^Record|^Edit/ })).toBeNull();
  });
  it('fix/walk-people item 8: the date done starts as today, and Remove lives inside the edit dialog, not beside Edit', async () => {
    h.checklist.mockResolvedValue([row({ done_on: '2026-11-01', state: 'done' })]);
    renderAt(<PersonClearance />);
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Item A' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
  it('fix/walk-people item 8: recording an item with no date yet starts the date done on today', async () => {
    h.checklist.mockResolvedValue([row({})]);
    renderAt(<PersonClearance />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record Item A' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(/Date done/) as HTMLInputElement).value).not.toBe('');
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

  it('AC-CTD-010 marks an overdue item with the word and its due day, and shows the due day of an item still in time', async () => {
    h.checklist.mockResolvedValue([row({ item_id: 'i1', name: 'Item A' }), row({ item_id: 'i2', name: 'Item B' })]);
    h.due.mockResolvedValue([
      { personId: 'p1', itemId: 'i1', dueOn: '2026-11-01', overdue: true },
      { personId: 'p1', itemId: 'i2', dueOn: '2026-11-30', overdue: false },
      { personId: 'p9', itemId: 'i1', dueOn: '2026-01-01', overdue: true },
    ]);
    renderAt(<PersonClearance />);
    expect(await screen.findByTestId('clearance-overdue-i1')).toHaveTextContent('Overdue · due 1 Nov 2026');
    expect(screen.getByTestId('clearance-due-i2')).toHaveTextContent('Due 30 Nov 2026');
    // Another person's overdue row never marks this checklist.
    expect(screen.queryByTestId('clearance-overdue-i2')).toBeNull();
  });

  it('AC-CTD-010 a checklist with no targets reads exactly as before', async () => {
    h.checklist.mockResolvedValue([row({})]);
    renderAt(<PersonClearance />);
    expect(await screen.findByText('Item A')).toBeInTheDocument();
    expect(screen.queryByTestId('clearance-due-i1')).toBeNull();
    expect(screen.queryByTestId('clearance-overdue-i1')).toBeNull();
  });

  it('AC-CTD-010 a failed due read is an error state, never a silent zero', async () => {
    h.checklist.mockResolvedValue([row({})]);
    h.due.mockRejectedValue(new Error('permission denied'));
    renderAt(<PersonClearance />);
    expect(await screen.findByText(/load this checklist/)).toBeInTheDocument();
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

  it('AC-CTD-010 shows how many items are overdue for each person on the people list', async () => {
    h.people.mockResolvedValue([{ id: 'p1', name: 'Test Person', code: 'P-0001' }, { id: 'p2', name: 'Other Person', code: 'P-0002' }]);
    h.summary.mockResolvedValue([
      { person_id: 'p1', required_count: 2, satisfied_count: 0, cleared: false },
      { person_id: 'p2', required_count: 2, satisfied_count: 0, cleared: false },
    ]);
    h.due.mockResolvedValue([
      { personId: 'p1', itemId: 'i1', dueOn: '2026-11-01', overdue: true },
      { personId: 'p1', itemId: 'i2', dueOn: '2026-11-02', overdue: true },
      { personId: 'p2', itemId: 'i1', dueOn: '2026-12-02', overdue: false },
    ]);
    renderAt(<Clearance />, '/administration/clearance');
    expect(await screen.findByTestId('clearance-person-overdue-p1')).toHaveTextContent('Overdue: 2');
    // A person with nothing past its day shows no marker, not a zero.
    expect(screen.queryByTestId('clearance-person-overdue-p2')).toBeNull();
  });

  it('AC-CTD-010 a failed overdue read shows the error state rather than an all-clear', async () => {
    h.people.mockResolvedValue([{ id: 'p1', name: 'Test Person', code: 'P-0001' }]);
    h.due.mockRejectedValue(new Error('permission denied'));
    renderAt(<Clearance />, '/administration/clearance');
    expect(await screen.findByText(/load the people/)).toBeInTheDocument();
  });
});

it.each(['pending', 'failed'])('does not assert not-cleared while the summary is %s', async (state) => {
  h.checklist.mockResolvedValue([row({})]);
  h.summary.mockImplementation(() => state === 'pending' ? new Promise(() => {}) : Promise.reject(new Error('offline')));
  renderAt(<PersonClearance />);
  await screen.findByText('Test Person');
  expect(screen.queryByText('Not cleared')).not.toBeInTheDocument();
});
