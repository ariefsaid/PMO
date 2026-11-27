import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  planningOn: false,
  categories: [] as { id: string; name: string; archived_at: string | null }[],
  setLine: vi.fn(),
  required: { data: false as boolean | undefined, isPending: false, isError: false, refetch: vi.fn() },
  header: { data: null as string | null | undefined, isPending: false, isError: false, refetch: vi.fn() },
  setNeededBy: vi.fn(),
  orders: vi.fn(),
  setAttribution: vi.fn(),
}));
vi.mock('@/src/hooks/usePurchaseLinePlanning', () => ({
  useLinePlanningEnabled: () => h.planningOn,
  useLineCategories: () => ({ data: h.categories }),
}));
vi.mock('@/src/lib/db/procurementLinePlanning', () => ({ setProcurementLinePlanning: h.setLine }));
vi.mock('@/src/hooks/usePoNeededBy', () => ({ usePoNeededByRequired: () => h.required, useProcurementNeededBy: () => h.header }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement: { setNeededBy: h.setNeededBy } } }));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => h.orders() }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: [{ id: 'd1', code: 'CIV', name: 'Civil' }] }) }));
vi.mock('@/src/lib/repositories/workOrderCosts', () => ({ workOrderCostRepository: { setAttribution: h.setAttribution } }));
vi.mock('@/src/lib/refusals', async (original) => ({ ...await original<typeof import('@/src/lib/refusals')>(), useRefusalLine: () => (e: unknown) => String((e as { message?: string })?.message ?? 'refused') }));

import { LinePlanPanel, type LinePlanPanelProps } from './LinePlanPanel';

const ORDERS = [
  { id: 'w1', wo_number: 'WO-1', title: 'One', status: 'Issued' },
  { id: 'w2', wo_number: 'WO-2', title: 'Two', status: 'Issued' },
  { id: 'w3', wo_number: 'WO-3', title: 'Three', status: 'Cancelled' },
];
const ITEMS = [
  { id: 'l1', name: 'Cable', category_id: null, needed_by: null, work_order_id: null },
  { id: 'l2', name: 'Pipe', category_id: 'c2', needed_by: '2026-12-15', work_order_id: 'w1', discipline_id: 'd1' },
];
const renderPanel = (props: Partial<LinePlanPanelProps> = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LinePlanPanel procurementId="p1" items={ITEMS} projectId="proj" requestWorkOrderId="w2"
      planningEditable neededByEditable workOrdersEditable {...props} />
  </QueryClientProvider>,
);
const rowOf = (name: string) => screen.getAllByRole('row').find((r) => r.textContent?.includes(name))!;

beforeEach(() => {
  vi.clearAllMocks();
  h.planningOn = false;
  h.categories = [{ id: 'c1', name: 'Alpha', archived_at: null }, { id: 'c2', name: 'Old', archived_at: '2026-01-01' }];
  h.required = { data: false, isPending: false, isError: false, refetch: vi.fn() };
  h.header = { data: null, isPending: false, isError: false, refetch: vi.fn() };
  h.orders.mockReturnValue({ data: ORDERS, isLoading: false, isError: false, refetch: vi.fn() });
  h.setLine.mockResolvedValue(undefined);
  h.setNeededBy.mockResolvedValue(undefined);
  h.setAttribution.mockResolvedValue(1);
});

describe('LinePlanPanel: when and for what each line is needed, in one table', () => {
  it('names saved and unsaved line changes when a later line write fails', async () => {
    h.planningOn = true;
    h.setLine.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Write failed'));
    renderPanel({ projectId: null, items: ITEMS.map((i) => ({ ...i, category_id: null })) });
    await userEvent.selectOptions(within(rowOf('Cable')).getByRole('combobox'), 'c1');
    await userEvent.selectOptions(within(rowOf('Pipe')).getByRole('combobox'), 'c1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Saved: Cable');
    expect(error).toHaveTextContent('Not saved: Pipe');
    expect(error).toHaveTextContent(/failed/i);
  });
  it('AC-PLP-010 nothing to plan (no setting on, no project) renders nothing', () => {
    const { container } = renderPanel({ projectId: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-PLP-010 one row per line, one column per planned fact, under one heading', () => {
    h.planningOn = true;
    renderPanel({ planningEditable: false, workOrdersEditable: false });
    const headers = screen.getAllByRole('columnheader').map((c) => c.textContent);
    expect(headers).toEqual(['Line', 'Category', 'Needed by', 'Work order', 'Discipline']);
    expect(within(rowOf('Pipe')).getByText('Old')).toBeInTheDocument();
    expect(within(rowOf('Pipe')).getByText(/^15 Dec/)).toBeInTheDocument();
    expect(within(rowOf('Pipe')).getByText('Civil')).toBeInTheDocument();
    expect(within(rowOf('Cable')).getAllByText('—').length).toBe(2);
  });

  it('AC-PLP-010 with no category yet, an editable table says so and who adds them', () => {
    h.planningOn = true;
    h.categories = [];
    renderPanel();
    expect(screen.getByTestId('line-planning-no-categories')).toHaveTextContent('An Admin adds them under Line planning');
  });

  it('AC-PLP-010 saves the category of the changed line only', async () => {
    h.planningOn = true;
    renderPanel({ projectId: null });
    await userEvent.selectOptions(within(rowOf('Cable')).getByRole('combobox', { name: 'Line category' }), 'c1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setLine).toHaveBeenCalledTimes(1));
    expect(h.setLine).toHaveBeenCalledWith('l1', 'c1', null);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('AC-NBY-009 the order date is saved alone, so the database fills every line', async () => {
    h.required.data = true;
    renderPanel({ projectId: null, items: ITEMS.map((i) => ({ ...i, needed_by: null })) });
    await userEvent.type(screen.getByLabelText('Order needed by'), '2026-12-31');
    await userEvent.tab();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setNeededBy).toHaveBeenCalledWith('p1', '2026-12-31', []));
  });

  it('AC-NBY-009 a line with its own date is sent as its own date; setting it back to the order date removes the exception', async () => {
    h.required.data = true;
    h.header.data = '2026-12-31';
    renderPanel({ projectId: null });
    const pipeDate = within(rowOf('Pipe')).getByLabelText('Needed by');
    await userEvent.clear(pipeDate);
    await userEvent.type(pipeDate, '2026-12-31');
    await userEvent.tab();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setNeededBy).toHaveBeenCalledWith('p1', '2026-12-31', [{ itemId: 'l2', neededBy: null }]));
  });

  it('AC-NBY-009 a pending or failed setting read shows loading or a retry, never an empty date input', async () => {
    h.required = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const { unmount } = renderPanel({ projectId: null });
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByLabelText('Order needed by')).toBeNull();
    unmount();
    h.required = { data: true, isPending: false, isError: false, refetch: vi.fn() };
    h.header = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderPanel({ projectId: null });
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.header.refetch).toHaveBeenCalled();
    expect(screen.queryByLabelText('Order needed by')).toBeNull();
  });

  it('AC-NBY-009 once the order is sent the order date is read, not edited', () => {
    h.required.data = true;
    h.header.data = '2026-12-31';
    renderPanel({ projectId: null, neededByEditable: false, planningEditable: false });
    expect(screen.getByTestId('order-needed-by-value')).toHaveTextContent(/31 Dec/);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('AC-WPL-011 offers "same as the request" naming its work order, then the open work orders only', () => {
    renderPanel();
    const labels = Array.from((screen.getByRole('combobox', { name: 'Work order for Cable' }) as HTMLSelectElement).options).map((o) => o.text);
    expect(labels).toEqual(['Same as the request (WO-2)', 'WO-1', 'WO-2']);
  });

  it('AC-WPL-011 a line on another work order than the request carries a note, never a block', () => {
    renderPanel();
    expect(screen.getAllByTestId('line-work-order-differs')).toHaveLength(1);
    expect(within(rowOf('Pipe')).getByTestId('line-work-order-differs')).toHaveTextContent('WO-2');
  });

  it('AC-WPL-011 saves only changed lines, grouped by what they name; "same as the request" clears the line', async () => {
    renderPanel();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Work order for Cable' }), 'w1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Work order for Pipe' }), '');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setAttribution).toHaveBeenCalledTimes(2));
    expect(h.setAttribution).toHaveBeenCalledWith('procurement_item', ['l1'], { workOrderId: 'w1', disciplineId: null });
    expect(h.setAttribution).toHaveBeenCalledWith('procurement_item', ['l2'], { workOrderId: null, disciplineId: 'd1' });
  });

  it('AC-WPL-011 a refusal is shown in words and nothing claims to be saved', async () => {
    h.setAttribution.mockRejectedValue({ message: 'That work order belongs to another project.' });
    renderPanel();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Discipline for Cable' }), 'd1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That work order belongs to another project.');
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('AC-WPL-011 a failed work-orders read offers a retry, not "no work orders yet"', async () => {
    const refetch = vi.fn();
    h.orders.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderPanel();
    expect(screen.queryByTestId('line-work-orders-empty')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('AC-WPL-011 a project with no work orders says what is missing and who adds them', () => {
    h.orders.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    renderPanel({ items: ITEMS.map((i) => ({ ...i, work_order_id: null, discipline_id: null })) });
    expect(screen.getByTestId('line-work-orders-empty')).toHaveTextContent('A project manager adds them');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
