import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { AppError } from '@/src/lib/appError';
import type { WorkOrderCloseoutItem } from '@/src/lib/db/closeoutChecklist';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  items: undefined as unknown,
  state: { isError: false, refetch: vi.fn() },
  docs: [] as unknown[],
  closer: null as { closedAt: string | null; closedByName: string | null } | null,
  attach: vi.fn(),
  complete: vi.fn(),
}));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx: Record<string, unknown> = {}) => can(action, entity, { realRole: h.role, ...ctx } as never) };
});
vi.mock('@/src/hooks/useCloseoutChecklist', () => ({
  useWorkOrderCloseoutItems: () => ({ data: h.items, ...h.state }),
  useWorkOrderCloser: () => ({ data: h.closer }),
  useCloseoutItemMutations: () => ({
    attachDocument: { mutateAsync: h.attach, isPending: false },
    completeItem: { mutateAsync: h.complete, isPending: false },
  }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: h.docs, isPending: false, isError: false }) }));
import { CloseoutSection } from './CloseoutSection';

const doc = (id: string, title: string, status = 'Approved', file: string | null = `o/p/${id}/f.pdf`) => ({ id, title, status, file_path: file });
const item = (p: Partial<WorkOrderCloseoutItem> & Pick<WorkOrderCloseoutItem, 'id' | 'position' | 'name'>): WorkOrderCloseoutItem => ({
  required: true, startedOn: null, doneOn: null, documentId: null, doneBy: null, doneByName: null, ...p,
});

function items(): WorkOrderCloseoutItem[] {
  return [
    item({ id: 'i1', position: 1, name: 'Item one', startedOn: '2026-03-01', doneOn: '2026-03-04', documentId: 'd1', doneBy: 'u1', doneByName: 'Dewi Finance' }),
    item({ id: 'i2', position: 2, name: 'Item two', startedOn: '2026-03-04', documentId: 'd2' }),
    item({ id: 'i3', position: 3, name: 'Item three', required: false }),
  ];
}

function renderIt(props: Partial<React.ComponentProps<typeof CloseoutSection>> = {}) {
  render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={{} as AuthContextValue}><MemoryRouter><CloseoutSection workOrderId="w1" projectId="p1" status="Issued" today="2026-03-11" {...props} /></MemoryRouter></AuthContext.Provider></QueryClientProvider>);
  return userEvent.setup();
}

beforeEach(() => {
  h.role = 'Finance';
  h.items = items();
  h.state = { isError: false, refetch: vi.fn() };
  h.docs = [doc('d1', 'Certificate A'), doc('d2', 'Letter B'), doc('d3', 'Draft note', 'Draft'), doc('d4', 'No file yet', 'Approved', null)];
  h.closer = null;
  h.attach.mockReset().mockResolvedValue(undefined);
  h.complete.mockReset().mockResolvedValue(undefined);
});

describe('CloseoutSection', () => {
  it('AC-WCO-011 shows each item in order with its age, document, date and person, and how many required items remain', () => {
    renderIt();
    const rows = within(screen.getByRole('list', { name: 'Close-out checklist' })).getAllByRole('listitem', { name: /./ });
    expect(rows.map((li) => li.getAttribute('aria-label'))).toEqual(['Item one', 'Item two', 'Item three']);
    expect(within(rows[0]).getByText('Done 4 Mar 2026')).toBeInTheDocument();
    expect(within(rows[0]).getByText('3 days')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('link', { name: 'Certificate A' })).toHaveAttribute('href', '/projects/p1/documents?open=d1');
    expect(within(rows[0]).getByText('Marked done by Dewi Finance')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Current')).toBeInTheDocument();
    expect(within(rows[1]).getByText('7 days')).toBeInTheDocument();
    expect(within(rows[2]).getByText('optional')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Current')).toBeInTheDocument(); // an optional item never waits
    expect(screen.getByTestId('closeout-summary')).toHaveTextContent('Required items not done: 1');
  });

  it('AC-WCO-011 Finance marks the current item done with its document and the chosen date', async () => {
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: 'Mark Item two done' }));
    expect(h.complete).toHaveBeenCalledWith({ itemId: 'i2', doneOn: '2026-03-11' });
  });

  it('AC-WCO-003 an item with no document offers only issued or approved documents with a file, and attaches the pick', async () => {
    h.items = [item({ id: 'i1', position: 1, name: 'Item one', startedOn: '2026-03-01' })];
    const user = renderIt();
    expect(screen.queryByRole('button', { name: /Mark Item one done/ })).toBeNull();
    const select = screen.getByRole('combobox', { name: 'Document for Item one' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a document', 'Certificate A', 'Letter B']);
    await user.selectOptions(select, 'd2');
    await user.click(screen.getByRole('button', { name: 'Attach to Item one' }));
    expect(h.attach).toHaveBeenCalledWith({ itemId: 'i1', documentId: 'd2' });
  });

  it('AC-WCO-004 a refusal from the database is explained in words', async () => {
    h.complete.mockRejectedValue(new AppError('x', 'item-out-of-order'));
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: 'Mark Item two done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Complete the earlier items first.');
  });

  it('AC-WCO-011 once every required item is done it says the work order can be closed', () => {
    h.items = items().map((i) => (i.required ? { ...i, doneOn: '2026-03-05', documentId: 'd1' } : i));
    renderIt();
    expect(screen.getByTestId('closeout-summary')).toHaveTextContent('Every required item is done. This work order can be closed.');
  });

  it('FR-WCO-031 an Executive sees the checklist but no recording controls', () => {
    h.role = 'Executive';
    renderIt();
    expect(screen.getByRole('list', { name: 'Close-out checklist' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark/ })).toBeNull();
  });

  it('FR-WCO-021 a closed work order shows who closed it and when', () => {
    h.closer = { closedAt: '2026-03-12T08:00:00Z', closedByName: 'Budi PM' };
    renderIt({ status: 'Closed' });
    expect(screen.getByTestId('closeout-summary')).toHaveTextContent('Closed 12 Mar 2026 by Budi PM.');
  });

  it('FR-WCO-012 a work order that is no longer issued shows the record without controls', () => {
    renderIt({ status: 'Closed' });
    expect(screen.queryByRole('button', { name: /Mark/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('NFR-WCO-001 outside the auth and query providers it renders nothing', () => {
    render(<MemoryRouter><CloseoutSection workOrderId="w1" projectId="p1" status="Issued" /></MemoryRouter>);
    expect(screen.queryByText('Close-out checklist')).toBeNull();
  });

  it('NFR-WCO-001 a work order with no checklist shows no section at all', () => {
    h.items = [];
    renderIt();
    expect(screen.queryByText('Close-out checklist')).toBeNull();
  });

  it('shows a retry when the checklist cannot be read', async () => {
    h.items = undefined;
    h.state = { isError: true, refetch: vi.fn() };
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.state.refetch).toHaveBeenCalled();
  });
});
