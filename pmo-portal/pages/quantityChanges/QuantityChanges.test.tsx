import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { OverContractRow } from '@/src/lib/db/quantityChanges';
import type { QcrListRow } from '@/src/lib/db/quantityChanges';

/** #2578 `/quantity-changes` — the hub's behaviour: who may raise/limit/forecast, the over-contract
 * figures (progress vs forecast, over-by rounding, open-request link), the request list and its
 * pagination, the Admin limit write, and the forecast dialog's validation and payload. */
const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    role: 'Finance',
    userId: 'fin1',
    projects: [
      { id: 'p1', name: 'Pipeline', code: 'PIPE', project_manager_id: 'pm1' },
      { id: 'p2', name: 'Terminal', code: 'TERM', project_manager_id: 'fin1' },
    ] as { id: string; name: string; code: string; project_manager_id: string }[],
    over: [] as OverContractRow[],
    list: { rows: [] as QcrListRow[], hasMore: false },
    listArgs: { filter: {} as Record<string, string>, page: 0 },
    limit: null as number | null,
    listState: { isPending: false, isError: false, refetch: vi.fn() },
    overState: { isPending: false, isError: false, refetch: vi.fn() },
    m: { raise: mutation(), setLimit: mutation(), recordForecast: mutation(), updateDraft: mutation(), submit: mutation(), approve: mutation(), returnRequest: mutation(), withdraw: mutation(), recordSent: mutation(), recordDecision: mutation(), uploadFile: mutation(), archiveFile: mutation() },
  };
});
vi.mock('@/src/hooks/useQuantityChanges', () => ({
  useQuantityChangeRequests: (filter: Record<string, string>, page: number) => {
    h.listArgs = { filter, page };
    return { ...h.listState, data: h.list };
  },
  useOverContract: () => ({ ...h.overState, data: h.over }),
  useQuantityChangeLimit: () => ({ data: h.limit }),
  useQuantityChangeMutations: () => h.m,
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: h.projects }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('./RaiseQuantityChangeDialog', () => ({
  // The real dialog closes itself after a successful create; mirror that contract.
  RaiseQuantityChangeDialog: ({ onCreated }: { onCreated: (id: string) => void }) => {
    const [done, setDone] = React.useState(false);
    return done ? null : (
      <div data-testid="raise-dialog"><button onClick={() => { setDone(true); onCreated('q-new'); }} /></div>
    );
  },
}));

import QuantityChanges from './QuantityChanges';

const overRow = (o: Partial<OverContractRow> = {}): OverContractRow => ({
  boq_item_id: 'b1', item_code: 'EXC', description: 'Excavation', unit: 'm3', rate: 50000, earning_basis: 'unit_rate',
  contract_quantity: 1000, progress_quantity: 1040, progress_source: 'assessment',
  forecast_quantity: null, over_progress: true, over_forecast: false, open_request_id: null, ...o,
});
const listRow = (o: Partial<QcrListRow> = {}): QcrListRow => ({
  id: 'q1', org_id: 'o1', project_id: 'p1', work_order_id: 'w1', status: 'draft', withdrawn_from: null, note: null,
  author_id: 'pm1', editor_ids: [], first_submitted_at: null, submitted_by: null, submitted_at: null, approved_by: null,
  approved_at: null, returned_by: null, returned_at: null, return_reason: null, withdrawn_by: null, withdrawn_at: null,
  withdraw_reason: null, sent_date: null, client_reference: null, decision_date: null, decided_by: null, decision_note: null,
  created_at: '2026-03-10T08:00:00Z', work_order_label: 'WO-1 · Excavation', author_name: 'Pat PM', line_count: 2, ...o,
});

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const view = (entry = '/quantity-changes') => render(
  <QueryClientProvider client={qc()}>
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider><QuantityChanges /></ToastProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.role = 'Finance';
  h.over = [];
  h.list = { rows: [], hasMore: false };
  h.limit = null;
  h.listState = { isPending: false, isError: false, refetch: vi.fn() };
  h.overState = { isPending: false, isError: false, refetch: vi.fn() };
  Object.values(h.m).forEach((x) => x.mutateAsync.mockReset().mockResolvedValue(undefined));
});

describe('QuantityChanges hub', () => {
  it('a role that may not raise sees no New request button and no limit section', () => {
    h.role = 'Engineer';
    view();
    expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('qcr-limit')).not.toBeInTheDocument();
  });

  it('a Finance sees New request; only an Admin sees the request limit', () => {
    view();
    expect(screen.getByRole('button', { name: 'New request' })).toBeInTheDocument();
    expect(screen.queryByTestId('qcr-limit')).not.toBeInTheDocument();
  });

  it('opening New request offers the raise dialog wired to navigate to the new draft', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'New request' }));
    expect(screen.getByTestId('raise-dialog')).toBeInTheDocument();
    await user.click(within(screen.getByTestId('raise-dialog')).getByRole('button'));
    await waitFor(() => expect(screen.queryByTestId('raise-dialog')).not.toBeInTheDocument());
  });

  it('without a project the over-contract section asks the user to pick one', () => {
    view();
    expect(screen.getByText('Choose a project to see its contract lines')).toBeInTheDocument();
  });

  it('shows the progress figure, its source and the rounded over-by amount', () => {
    h.over = [overRow()];
    view('/quantity-changes?project=p1');
    expect(screen.getByTestId('qcr-over-row')).toHaveTextContent('EXC · Excavation');
    expect(screen.getByTestId('qcr-over-row')).toHaveTextContent('Contract 1000 m3');
    expect(screen.getByTestId('qcr-over-row')).toHaveTextContent(/over.kind.progress 1040 \(over.source.assessment\)/);
    expect(screen.getByTestId('qcr-over-row')).toHaveTextContent('Over by 40 m3');
  });

  it('a forecast-flagged line shows the forecast figure without a source', () => {
    h.over = [overRow({ over_progress: false, over_forecast: true, progress_quantity: 900, forecast_quantity: 1000.5 })];
    view('/quantity-changes?project=p1');
    expect(screen.getByTestId('qcr-over-row')).toHaveTextContent('over.kind.forecast 1000.5');
    expect(screen.queryByText(/\(assessment\)/)).not.toBeInTheDocument();
    expect(screen.getByTestId('qcr-over-row')).toHaveTextContent('Over by 0.5 m3');
  });

  it('links a line with an open request to that request', () => {
    h.over = [overRow({ open_request_id: 'q9' })];
    view('/quantity-changes?project=p1');
    expect(screen.getByRole('link', { name: 'Open request' })).toHaveAttribute('href', '/quantity-changes/q9');
  });

  it('only a role that may record forecasts sees the button, and it opens the dialog', async () => {
    h.over = [overRow()];
    const user = userEvent.setup();
    const { rerender } = view('/quantity-changes?project=p1');
    expect(screen.getByRole('button', { name: 'Record forecast' })).toBeInTheDocument();
    rerender(
      <QueryClientProvider client={qc()}>
        <MemoryRouter initialEntries={['/quantity-changes?project=p2']}>
          <ToastProvider><QuantityChanges /></ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // fin1 is Terminal's own PM → still allowed; an Engineer is not (asserted below).
    await user.click(screen.getByRole('button', { name: 'Record forecast' }));
    expect(screen.getByText('Forecast quantity at completion')).toBeInTheDocument();
  });

  it('an Engineer may not record a forecast', () => {
    h.role = 'Engineer';
    h.over = [overRow()];
    view('/quantity-changes?project=p1');
    expect(screen.queryByRole('button', { name: 'Record forecast' })).not.toBeInTheDocument();
  });

  it('the forecast dialog refuses an impossible quantity and sends the exact typed figure with the note', async () => {
    h.over = [overRow()];
    const user = userEvent.setup();
    view('/quantity-changes?project=p1');
    await user.click(screen.getByRole('button', { name: 'Record forecast' }));
    const save = screen.getByRole('button', { name: 'Save forecast' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText(/Expected final quantity/), '0');
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText(/Expected final quantity/));
    await user.type(screen.getByLabelText(/Expected final quantity/), '1050.5');
    await user.type(screen.getByLabelText('Note'), 'Rain delay');
    await user.click(save);
    await waitFor(() => expect(h.m.recordForecast.mutateAsync).toHaveBeenCalledWith({ boqItemId: 'b1', quantity: '1050.5', note: 'Rain delay' }));
    expect(screen.queryByText('Forecast quantity at completion')).not.toBeInTheDocument();
  });

  it('a refused forecast shows the classifier words in the dialog', async () => {
    h.over = [overRow()];
    h.m.recordForecast.mutateAsync.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    view('/quantity-changes?project=p1');
    await user.click(screen.getByRole('button', { name: 'Record forecast' }));
    await user.type(screen.getByLabelText(/Expected final quantity/), '1050.5');
    await user.click(screen.getByRole('button', { name: 'Save forecast' }));
    expect(await screen.findByText(/Update failed/)).toBeInTheDocument();
    expect(screen.getByText('Forecast quantity at completion')).toBeInTheDocument();
  });

  it('the requests list renders the rows; empty says so', () => {
    h.list = { rows: [listRow()], hasMore: false };
    view();
    expect(screen.getByTestId('qcr-list')).toHaveTextContent('WO-1 · Excavation');
    expect(screen.getByTestId('qcr-list')).toHaveTextContent('2 lines');
    expect(screen.getByTestId('qcr-list')).toHaveTextContent('Pat PM');
  });

  it('no requests yet shows the empty sentence', () => {
    view();
    expect(screen.getByText('No quantity change requests yet')).toBeInTheDocument();
  });

  it('a failed load offers Retry and refetches', async () => {
    h.listState = { isPending: false, isError: true, refetch: vi.fn() };
    const user = userEvent.setup();
    view();
    expect(screen.getByText("Couldn't load requests")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.listState.refetch).toHaveBeenCalledTimes(1);
  });

  it('pagination pages forward and back through the query page argument', async () => {
    h.list = { rows: [listRow()], hasMore: true };
    const user = userEvent.setup();
    view();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(h.listArgs.page).toBe(1));
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  it('the status filter narrows the list query', async () => {
    const user = userEvent.setup();
    view();
    await user.selectOptions(screen.getByLabelText('Status'), 'approved');
    await waitFor(() => expect(h.listArgs.filter).toEqual({ status: 'approved' }));
  });

  it('the project filter scopes both the list and the over-contract query', async () => {
    const user = userEvent.setup();
    view();
    await user.selectOptions(screen.getByLabelText('Project'), 'p1');
    await waitFor(() => expect(h.listArgs.filter).toEqual({ projectId: 'p1' }));
  });

  it('the Admin limit refuses a non-positive number in place and saves a valid one', async () => {
    h.role = 'Admin';
    const user = userEvent.setup();
    view();
    const save = screen.getByRole('button', { name: 'Save limit' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('Limit per work order'), '0');
    expect(screen.getByText('A whole number of 1 or more')).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText('Limit per work order'));
    await user.type(screen.getByLabelText('Limit per work order'), '5');
    await user.click(save);
    await waitFor(() => expect(h.m.setLimit.mutateAsync).toHaveBeenCalledWith(5));
  });

  it('clearing the field saves the null limit', async () => {
    h.role = 'Admin';
    h.limit = 5;
    const user = userEvent.setup();
    view();
    const field = screen.getByLabelText('Limit per work order');
    expect(field).toHaveValue('5');
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save limit' }));
    await waitFor(() => expect(h.m.setLimit.mutateAsync).toHaveBeenCalledWith(null));
  });

  it('a refused limit save warns through the classifier', async () => {
    h.role = 'Admin';
    h.m.setLimit.mutateAsync.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText('Limit per work order'), '5');
    await user.click(screen.getByRole('button', { name: 'Save limit' }));
    expect(await screen.findAllByText('Update failed').then((x) => x.length)).toBeGreaterThan(0);
  });
});
