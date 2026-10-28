import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import ProcurementCreate from './ProcurementCreate';
import { ProcurementError } from '@/src/lib/db/procurementLifecycle';

const mocks = vi.hoisted(() => ({
  createRequest: vi.fn(),
  createItem: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  canCreate: true,
  currency: 'USD',
  realRole: 'Admin' as string,
}));
vi.mock('react-router', async (importOriginal) => ({ ...await importOriginal<typeof import('react-router')>(), useNavigate: () => mocks.navigate }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return {
    usePermission: () => (action: never, entity: string) => entity === 'procurement'
      ? mocks.canCreate
      : can(action, entity as never, { realRole: mocks.realRole } as never),
  };
});
vi.mock('@/src/auth/impersonation', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/auth/impersonation')>(),
  useOptionalRealRole: () => mocks.realRole,
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => mocks.currency }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'p1', label: 'Project One' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Supplier One', sub: 'Vendor' }] }),
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: mocks.createRequest, isPending: false }),
  useCreateProcurementItem: () => ({ mutateAsync: mocks.createItem, isPending: false }),
}));
vi.mock('@/src/components/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/components/ui')>(),
  useToast: () => ({ toast: mocks.toast }),
}));

function renderCreate(path = '/procurement/new?have=need') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/procurement/new" element={<ProcurementCreate />} /></Routes>
    </MemoryRouter>,
  );
}

describe('AC-PROC1 one-page request creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canCreate = true;
    mocks.currency = 'USD';
    mocks.realRole = 'Admin';
    mocks.createRequest.mockResolvedValue({ id: 'new-id' });
    mocks.createItem.mockResolvedValue({});
  });

  it('SEC-RS-5: shows the five intake choices to Finance and only the plain request to an Engineer', () => {
    mocks.realRole = 'Finance';
    const finance = renderCreate('/procurement/new');
    expect(screen.getByRole('heading', { name: 'What do you have?' })).toBeVisible();
    expect(screen.getByRole('button', { name: /A new need/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /An order/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /A supplier invoice/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /A scheduled payment/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /A document already in the accounting system/i })).toBeVisible();
    finance.unmount();

    mocks.realRole = 'Engineer';
    renderCreate('/procurement/new');
    expect(screen.getByRole('button', { name: /A new need/i })).toBeVisible();
    expect(screen.queryByRole('button', { name: /An order/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /A supplier invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /payment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /A document already in the accounting system/i })).not.toBeInTheDocument();
  });

  it('SEC-RS-5: an Engineer following a ?have=invoice link gets the request choice, not an invoice draft', () => {
    mocks.realRole = 'Engineer';
    renderCreate('/procurement/new?have=invoice');
    expect(screen.getByRole('heading', { name: 'What do you have?' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /A supplier invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument();
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it('SEC-RS-5: the payment choice reads as a scheduled payment that Finance marks paid', () => {
    mocks.realRole = 'Finance';
    renderCreate('/procurement/new');
    const choice = screen.getByRole('button', { name: /A scheduled payment/i });
    expect(choice).toHaveTextContent('Finance marks it paid');
    expect(screen.queryByText(/already made/i)).not.toBeInTheDocument();
  });

  it('AC-PROC1-001 shows the need form fields and line editor but no quotations', () => {
    renderCreate();
    expect(screen.getByRole('heading', { name: /new procurement/i })).toBeVisible();
    expect(screen.getByLabelText(/title/i)).toBeVisible();
    expect(screen.getByLabelText(/project/i)).toBeVisible();
    expect(screen.getByLabelText(/supplier/i)).toBeVisible();
    expect(screen.getByLabelText(/budget category/i)).toBeVisible();
    expect(screen.getByTestId('line-items-section')).toBeVisible();
    expect(screen.queryByText(/quotation/i)).not.toBeInTheDocument();
  });

  it('AC-PROC1-002 choosing a new need saves the request and its entered line before replacing to detail', async () => {
    renderCreate('/procurement/new');
    fireEvent.click(screen.getByRole('button', { name: /A new need/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Office supplies' } });
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Paper' } });
    fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /add line item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.createItem).toHaveBeenCalledWith({
      procurementId: 'new-id', input: expect.objectContaining({ id: expect.any(String), name: 'Paper', quantity: 2, rate: 10 }),
    }));
    expect(mocks.createRequest).toHaveBeenCalledWith({ title: 'Office supplies', projectId: null, vendorId: null });
    expect(mocks.createRequest.mock.invocationCallOrder[0]).toBeLessThan(mocks.createItem.mock.invocationCallOrder[0]);
    expect(mocks.createItem.mock.invocationCallOrder[0]).toBeLessThan(mocks.navigate.mock.invocationCallOrder[0]);
    expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true });
  });

  it('choosing an order saves the header and opens purchase-order capture', async () => {
    renderCreate('/procurement/new');
    fireEvent.click(screen.getByRole('button', { name: /An order/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Cement order' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id/timeline?record=po', { replace: true }));
    expect(mocks.createRequest).toHaveBeenCalledWith({ title: 'Cement order', projectId: null, vendorId: null });
    expect(mocks.createItem).not.toHaveBeenCalled();
  });

  it.each([
    ['invoice', 'A supplier invoice', 'invoice'],
    ['payment', 'A scheduled payment', 'payment'],
  ] as const)('choosing %s opens its matching capture without line items', async (have, choice, record) => {
    renderCreate('/procurement/new');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(choice, 'i') }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: `Existing ${have}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(`/procurement/new-id/timeline?record=${record}`, { replace: true }));
    expect(mocks.createItem).not.toHaveBeenCalled();
  });

  it('takes Finance to accounting-system documents that are not in a procurement', () => {
    mocks.realRole = 'Finance';
    renderCreate('/procurement/new');
    fireEvent.click(screen.getByRole('button', { name: /A document already in the accounting system/i }));
    expect(mocks.navigate).toHaveBeenCalledWith('/procurement?tab=orphans');
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it('uses supplier wording for the supplier option in the shared picker', async () => {
    renderCreate();
    fireEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));
    const supplierOption = await screen.findByRole('option', { name: /Supplier One/ });
    expect(supplierOption).toHaveTextContent('Supplier');
    expect(supplierOption).not.toHaveTextContent('Vendor');
  });

  it('AC-PROC1-004 skips the question for ?have=invoice and omits line items', () => {
    renderCreate('/procurement/new?have=invoice');
    expect(screen.queryByRole('heading', { name: 'What do you have?' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeVisible();
    expect(screen.getByLabelText(/project/i)).toBeVisible();
    expect(screen.getByLabelText(/supplier/i)).toBeVisible();
    expect(screen.queryByLabelText(/budget category/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('line-items-section')).not.toBeInTheDocument();
  });

  it('returns to the question without clearing typed form input', () => {
    renderCreate('/procurement/new');
    fireEvent.click(screen.getByRole('button', { name: /A new need/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Cable' } });
    fireEvent.click(screen.getByRole('button', { name: /what do you have/i }));
    expect(screen.getByRole('heading', { name: 'What do you have?' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /A new need/i }));
    expect(screen.getByLabelText(/title/i)).toHaveValue('Cable');
  });

  it('AC-PROC1-003 preselects project from query and creates nothing when leaving', () => {
    const { unmount } = renderCreate('/procurement/new?project=p1&have=need');
    expect(screen.getByText('Project One')).toBeVisible();
    unmount();
    expect(mocks.createRequest).not.toHaveBeenCalled();
    expect(mocks.createItem).not.toHaveBeenCalled();
  });

  it('AC-PROC1-004 required title error is inline and blocks creation', () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('A procurement title is required.')).toBeVisible();
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it('AC-PROC1-005 keeps failed line data on the saved request and retries only that line', async () => {
    mocks.createItem.mockRejectedValueOnce(new Error('line write failed'));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Office supplies' } });
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Paper' } });
    fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /add line item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/some lines were not saved/i);
    expect(screen.getByText('Paper')).toBeVisible();
    expect(screen.queryByText(/procurement\/new-id/)).not.toBeInTheDocument();
    expect(mocks.createRequest).toHaveBeenCalledTimes(1);
    expect(mocks.createItem).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true }));
    expect(mocks.createRequest).toHaveBeenCalledTimes(1);
    expect(mocks.createItem).toHaveBeenCalledTimes(2);
    const firstLineId = mocks.createItem.mock.calls[0][0].input.id;
    const retriedLineId = mocks.createItem.mock.calls[1][0].input.id;
    expect(firstLineId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(retriedLineId).toBe(firstLineId);
    expect(mocks.createItem.mock.calls[1][0]).toEqual({
      procurementId: 'new-id', input: { id: firstLineId, name: 'Paper', quantity: 2, rate: 10 },
    });
  });

  it('shows the reconcile instructions for a conflicting saved line ID', async () => {
    mocks.createItem.mockRejectedValueOnce(new ProcurementError(
      'This line ID already has different saved data. Open the saved request to reconcile it before retrying.', '23505',
    ));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Office supplies' } });
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Paper' } });
    fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /add line item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Open the saved request to reconcile it before retrying/i);
    expect(screen.queryByText(/Save again to retry/i)).not.toBeInTheDocument();
  });

  it('AC-PROC1-005 freezes saved request fields after a child write needs retry', async () => {
    mocks.createItem.mockRejectedValueOnce(new Error('line write failed'));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Original request' } });
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Paper' } });
    fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /add line item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/some lines were not saved/i);
    expect(screen.getByLabelText(/title/i)).toBeDisabled();
    expect(screen.getByLabelText(/project/i)).toBeDisabled();
    expect(screen.getByLabelText(/supplier/i)).toBeDisabled();
  });

  it('AC-PROC1-006 disables line controls while the request is saving', async () => {
    let resolveLine!: (value: unknown) => void;
    mocks.createItem.mockImplementationOnce(() => new Promise((resolve) => { resolveLine = resolve; }));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Office supplies' } });
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Paper' } });
    fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /add line item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.createItem).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /add line item/i })).toBeDisabled();
    resolveLine({});
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true }));
  });

  it('AC-PROC1-008 formats draft line totals in the organization currency', () => {
    mocks.currency = 'IDR';
    renderCreate();
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Paper' } });
    fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '10' } });
    expect(screen.getByLabelText('New line total')).toHaveTextContent('IDR');
    expect(screen.getByLabelText('New line total')).not.toHaveTextContent('$');
  });

  it('AC-PROC1-006 keeps the create permission gate on the route', () => {
    mocks.canCreate = false;
    renderCreate();
    expect(screen.getByRole('heading', { name: /do not have permission/i })).toBeVisible();
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument();
  });

  it('AC-PROC1-007 holds Back behind a confirm once something is typed, creates nothing', () => {
    renderCreate('/procurement/new');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Procurement' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/procurement');
    mocks.navigate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /A new need/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /what do you have/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Procurement' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/procurement');
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it('AC-PROC1-008 an unpriced line shows an unknown total, never 0', () => {
    renderCreate();
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Paper' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });
});
