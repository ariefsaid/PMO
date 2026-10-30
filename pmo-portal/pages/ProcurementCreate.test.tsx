import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import ProcurementCreate from './ProcurementCreate';
import { ProcurementError } from '@/src/lib/db/procurementLifecycle';

const mocks = vi.hoisted(() => ({
  createRequest: vi.fn(),
  createAtomic: vi.fn(),
  createItem: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  canCreate: true,
  currency: 'USD',
  realRole: 'Admin' as string,
  projectQuery: { data: [{ value: 'p1', label: 'Project One' }], isPending: false, isError: false, refetch: vi.fn() },
  vendorQuery: { data: [{ value: 'v1', label: 'Supplier One', sub: 'Vendor' }], isPending: false, isError: false, refetch: vi.fn() },
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
  useProjectOptions: () => mocks.projectQuery,
  useVendorOptions: () => mocks.vendorQuery,
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: mocks.createRequest, isPending: false }),
  useCreateProcurementWithItems: () => ({ mutateAsync: mocks.createAtomic, isPending: false }),
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
    mocks.projectQuery.isPending = false; mocks.projectQuery.isError = false;
    mocks.vendorQuery.isPending = false; mocks.vendorQuery.isError = false;
    mocks.vendorQuery.data = [{ value: 'v1', label: 'Supplier One', sub: 'Vendor' }];
    mocks.createRequest.mockResolvedValue({ id: 'new-id' });
    mocks.createAtomic.mockResolvedValue({ id: 'new-id' });
    mocks.createItem.mockResolvedValue({});
  });

  it('keeps reference pickers unavailable during loading and offers retry after failure', async () => {
    mocks.projectQuery.isPending = true;
    mocks.vendorQuery.isError = true;
    const view = renderCreate();
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Supplier' })).toBeDisabled();
    expect(screen.getByText(/loading projects/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /retry suppliers/i }));
    expect(mocks.vendorQuery.refetch).toHaveBeenCalled();
    mocks.projectQuery.isPending = false;
    mocks.vendorQuery.isError = false;
    mocks.vendorQuery.data = [{ value: 'v2', label: 'New Supplier', sub: 'Vendor' }];
    view.rerender(<MemoryRouter initialEntries={['/procurement/new?have=need']}><Routes><Route path="/procurement/new" element={<ProcurementCreate />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));
    expect(await screen.findByRole('option', { name: /New Supplier/ })).toBeVisible();
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
    // B3: one choice is no choice — an Engineer starts straight on the request form.
    expect(screen.queryByRole('heading', { name: 'What do you have?' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /new procurement/i })).toBeVisible();
    expect(screen.getByLabelText(/title/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /An order/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /A supplier invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /payment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /A document already in the accounting system/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/document already in hand/i)).not.toBeInTheDocument();
  });

  it('B3: an Engineer\'s back control leaves for the Procurement list, not a one-choice chooser', () => {
    mocks.realRole = 'Engineer';
    renderCreate('/procurement/new');
    expect(screen.queryByRole('button', { name: /What do you have\?/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to Procurement/ })).toBeVisible();
  });

  it('SEC-RS-5: an Engineer following a ?have=invoice link gets the request choice, not an invoice draft', () => {
    mocks.realRole = 'Engineer';
    renderCreate('/procurement/new?have=invoice');
    // The request form opens (never an invoice draft): its note names a purchase request, not a supplier invoice.
    expect(screen.getByRole('heading', { name: /new procurement/i })).toBeVisible();
    expect(screen.getByText(/purchase request remains a draft/i)).toBeVisible();
    expect(screen.queryByText(/then record the supplier invoice/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /A supplier invoice/i })).not.toBeInTheDocument();
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it('SEC-RS-5: the payment choice reads as a scheduled payment that Finance marks paid', () => {
    mocks.realRole = 'Finance';
    renderCreate('/procurement/new');
    const choice = screen.getByRole('button', { name: /A scheduled payment/i });
    expect(choice).toHaveTextContent('Finance marks it paid');
    expect(screen.queryByText(/already made/i)).not.toBeInTheDocument();
  });

  it('holds navigation and unload while the transactional save is pending', async () => {
    let resolve!: (value: unknown) => void;
    mocks.createAtomic.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Pending' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.createAtomic).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: /what do you have/i }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByText(/saving.*wait/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Leave' })).toBeDisabled();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    resolve({ id: 'new-id' });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true }));
  });

  it('starts only one save when submit events arrive together', async () => {
    mocks.createAtomic.mockImplementationOnce(() => new Promise(() => {}));
    const view = renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Once' } });
    const form = view.container.querySelector('form')!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(mocks.createAtomic).toHaveBeenCalledTimes(1);
  });

  it('retries an uncertain save with the same header and line IDs', async () => {
    mocks.createAtomic.mockRejectedValueOnce(new Error('network'));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Retry' } });
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Paper' } });
    fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /add line item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true }));
    expect(mocks.createAtomic).toHaveBeenCalledTimes(2);
    expect(mocks.createAtomic.mock.calls[1][0]).toEqual(mocks.createAtomic.mock.calls[0][0]);
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
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true }));
    expect(mocks.createAtomic).toHaveBeenCalledWith({ id: expect.any(String), header: { title: 'Office supplies', projectId: null, vendorId: null }, lines: [expect.objectContaining({ id: expect.any(String), name: 'Paper', quantity: 2, rate: 10 })] });
    expect(mocks.createItem).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true });
  });

  it('choosing an order saves the header and opens purchase-order capture', async () => {
    renderCreate('/procurement/new');
    fireEvent.click(screen.getByRole('button', { name: /An order/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Cement order' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id/timeline?record=po', { replace: true }));
    expect(mocks.createAtomic).toHaveBeenCalledWith({ id: expect.any(String), header: { title: 'Cement order', projectId: null, vendorId: null }, lines: [] });
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

  it('AC-PROC1-005 preserves the draft and retries the same atomic request after failure', async () => {
    mocks.createAtomic.mockRejectedValueOnce(new Error('network'));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Original request' } });
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Paper' } });
    fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /add line item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByText('Paper')).toBeVisible();
    expect(screen.getByLabelText(/title/i)).toBeDisabled();
    expect(screen.getByLabelText(/project/i)).toBeDisabled();
    expect(screen.getByLabelText(/supplier/i)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true }));
    expect(mocks.createAtomic.mock.calls[1][0]).toEqual(mocks.createAtomic.mock.calls[0][0]);
  });

  it('allows correction when the server definitively rejects invalid input', async () => {
    mocks.createAtomic.mockRejectedValueOnce(new ProcurementError('Invalid input', '22023'));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText(/title/i)).toBeEnabled();
  });

  it('permits correcting an overflow line and retrying the draft', async () => {
    mocks.createAtomic.mockRejectedValueOnce(new ProcurementError('Numeric overflow', '22003'));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Overflow' } });
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Paper' } });
    fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '1000000' } });
    fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '1000000' } });
    fireEvent.click(screen.getByRole('button', { name: /add line item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Paper' }));
    fireEvent.change(screen.getByLabelText('Edit quantity for Paper'), { target: { value: '2' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);
    await waitFor(() => expect(screen.queryByLabelText('Edit quantity for Paper')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true }));
    expect(mocks.createAtomic.mock.calls[1][0].lines[0].quantity).toBe(2);
  });

  it.each([
    ['An order', 'po'], ['A supplier invoice', 'invoice'], ['A scheduled payment', 'payment'],
  ])('retains %s capture mode through an uncertain save and intake', async (choice, record) => {
    mocks.createAtomic.mockRejectedValueOnce(new Error('network'));
    renderCreate('/procurement/new');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(choice, 'i') }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Existing document' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /what do you have/i }));
    expect(screen.getByRole('button', { name: /A new need/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(choice, 'i') }));
    expect(screen.getByLabelText(/title/i)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(`/procurement/new-id/timeline?record=${record}`, { replace: true }));
    expect(mocks.createAtomic.mock.calls[1][0]).toEqual(mocks.createAtomic.mock.calls[0][0]);
  });

  it('allows a stale supplier to be corrected after a definitive reference rejection', async () => {
    mocks.createAtomic.mockRejectedValueOnce(new ProcurementError('Reference unavailable', '23503'));
    mocks.vendorQuery.data = [{ value: 'v1', label: 'Supplier One', sub: 'Vendor' }, { value: 'v2', label: 'Supplier Two', sub: 'Vendor' }];
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Supplies' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));
    fireEvent.click(await screen.findByRole('option', { name: /Supplier One/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('combobox', { name: 'Supplier' })).toBeEnabled();
    fireEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));
    fireEvent.click(await screen.findByRole('option', { name: /Supplier Two/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true }));
    expect(mocks.createAtomic.mock.calls[1][0].header.vendorId).toBe('v2');
  });

  it('keeps an uncertain attempt frozen when a later retry rejects a stale reference', async () => {
    mocks.createAtomic.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new ProcurementError('Reference unavailable', '23503'));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Original' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.createAtomic).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.getByLabelText(/title/i)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true }));
    expect(mocks.createAtomic.mock.calls[2][0]).toEqual(mocks.createAtomic.mock.calls[0][0]);
  });

  it('retains the immutable attempt after an authorization denial', async () => {
    mocks.createAtomic.mockRejectedValueOnce(new ProcurementError('Denied', '42501'));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Original' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText(/title/i)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true }));
    expect(mocks.createAtomic.mock.calls[1][0]).toEqual(mocks.createAtomic.mock.calls[0][0]);
  });

  it('shows server reconciliation instructions for a conflicting ID', async () => {
    mocks.createAtomic.mockRejectedValueOnce(new ProcurementError('Open the saved request to reconcile it before retrying.', '23505'));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Office supplies' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/reconcile it before retrying/i);
    expect(screen.getByRole('button', { name: /open saved request/i })).toBeVisible();
  });

  it('AC-PROC1-006 disables line controls while the request is saving', async () => {
    let resolveSave!: (value: unknown) => void;
    mocks.createAtomic.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Office supplies' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.createAtomic).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /add line item/i })).toBeDisabled();
    resolveSave({ id: 'new-id' });
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
