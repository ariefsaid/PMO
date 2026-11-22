import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ orders: vi.fn(), set: vi.fn() }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: [{ id: 'd1', code: 'CIV', name: 'Civil' }] }) }));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => h.orders() }));
vi.mock('@/src/lib/repositories/workOrderCosts', () => ({ workOrderCostRepository: { setAttribution: h.set } }));
vi.mock('@/src/lib/refusals', () => ({ useRefusalLine: () => (e: unknown) => String((e as { message?: string })?.message ?? 'refused') }));

import { LineWorkOrdersPanel } from './LineWorkOrdersPanel';
import { LineWorkOrdersSection } from './LineWorkOrdersSection';

const ORDERS = [
  { id: 'w1', wo_number: 'WO-1', title: 'One', status: 'Issued' },
  { id: 'w2', wo_number: 'WO-2', title: 'Two', status: 'Issued' },
  { id: 'w3', wo_number: 'WO-3', title: 'Three', status: 'Cancelled' },
];
const ITEMS = [
  { id: 'l1', name: 'Cable', work_order_id: null },
  { id: 'l2', name: 'Pipe', work_order_id: 'w1', discipline_id: 'd1' },
];
const renderPanel = (editable: boolean, requestWorkOrder: string | null = 'w2') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LineWorkOrdersPanel items={ITEMS} projectId="p1" requestWorkOrderId={requestWorkOrder} editable={editable} />
  </QueryClientProvider>,
);

describe('AC-WPL-011 LineWorkOrdersPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); h.orders.mockReturnValue({ data: ORDERS, isLoading: false }); h.set.mockResolvedValue(1); });

  it('offers "same as the request" naming the request’s work order, then the open work orders (a cancelled one is not offered)', () => {
    renderPanel(true);
    const select = screen.getAllByRole('combobox', { name: 'Work order for Cable' })[0];
    const labels = Array.from((select as HTMLSelectElement).options).map((o) => o.text);
    expect(labels).toEqual(['Same as the request (WO-2)', 'WO-1', 'WO-2']);
  });

  it('a line whose own work order differs from the request’s carries an information note, not a block', () => {
    renderPanel(true);
    expect(screen.getAllByTestId('line-work-order-differs')).toHaveLength(1);
    expect(screen.getByTestId('line-work-order-differs')).toHaveTextContent('The request is on WO-2');
  });

  it('read-only shows the text and no Save', () => {
    renderPanel(false);
    expect(screen.getAllByTestId('line-work-order-value').map((e) => e.textContent)).toEqual(['Same as the request (WO-2)', 'WO-1']);
    expect(screen.getAllByTestId('line-discipline-value').map((e) => e.textContent)).toEqual(['No discipline', 'Civil']);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('saves only the changed lines, grouped by work order; "same as the request" clears the line', async () => {
    renderPanel(true);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(screen.getByText('Change a line’s work order to save.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Work order for Cable' }), 'w1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Work order for Pipe' }), '');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledTimes(2));
    expect(h.set).toHaveBeenCalledWith('procurement_item', ['l1'], { workOrderId: 'w1', disciplineId: null });
    expect(h.set).toHaveBeenCalledWith('procurement_item', ['l2'], { workOrderId: null, disciplineId: 'd1' });
  });

  it('a discipline picked for a line is saved with the line', async () => {
    renderPanel(true);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Discipline for Cable' }), 'd1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('procurement_item', ['l1'], { workOrderId: null, disciplineId: 'd1' }));
  });

  it('a refusal is shown in words and nothing claims to be saved', async () => {
    h.set.mockRejectedValue({ message: 'That work order belongs to another project.' });
    renderPanel(true);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Work order for Cable' }), 'w1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That work order belongs to another project.')).toBeInTheDocument();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('renders nothing for a purchase with no project', () => {
    const { container } = render(<QueryClientProvider client={new QueryClient()}><LineWorkOrdersPanel items={ITEMS} projectId={null} requestWorkOrderId={null} editable /></QueryClientProvider>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AC-WPL-011 LineWorkOrdersSection empty states', () => {
  const lines = [{ id: 'l1', name: 'Cable' }];
  it('with no project it says to choose one first', () => {
    render(<LineWorkOrdersSection lines={lines} values={{}} onChange={() => {}} workOrders={null} disciplines={[]} />);
    expect(screen.getByTestId('line-work-orders-empty')).toHaveTextContent('Choose a project first');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('with a project that has no work orders it says what is missing and who adds them', () => {
    render(<LineWorkOrdersSection lines={lines} values={{}} onChange={() => {}} workOrders={[]} disciplines={[]} />);
    expect(screen.getByTestId('line-work-orders-empty')).toHaveTextContent('A project manager adds work orders');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('a cancelled work order stays visible, marked, on a line that already carries it', () => {
    render(<LineWorkOrdersSection lines={lines} values={{ l1: { workOrderId: 'w3', disciplineId: '' } }} onChange={() => {}} workOrders={[{ id: 'w3', label: 'WO-3', cancelled: true }, { id: 'w1', label: 'WO-1' }]} disciplines={[]} />);
    const labels = Array.from((screen.getByRole('combobox', { name: 'Work order for Cable' }) as HTMLSelectElement).options).map((o) => o.text);
    expect(labels).toEqual(['Same as the request', 'WO-1', 'WO-3 (cancelled)']);
  });
});
