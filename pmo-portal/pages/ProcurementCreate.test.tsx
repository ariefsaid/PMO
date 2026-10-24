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
}));
vi.mock('react-router', async (importOriginal) => ({ ...await importOriginal<typeof import('react-router')>(), useNavigate: () => mocks.navigate }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => mocks.canCreate }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => mocks.currency }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'p1', label: 'Project One' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Vendor One' }] }),
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: mocks.createRequest, isPending: false }),
  useCreateProcurementItem: () => ({ mutateAsync: mocks.createItem, isPending: false }),
}));
vi.mock('@/src/components/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/components/ui')>(),
  useToast: () => ({ toast: mocks.toast }),
}));

function renderCreate(path = '/procurement/new') {
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
    mocks.createRequest.mockResolvedValue({ id: 'new-id' });
    mocks.createItem.mockResolvedValue({});
  });

  it('AC-PROC1-001 shows inline request fields and line editor but no quotations', () => {
    renderCreate();
    expect(screen.getByRole('heading', { name: /new purchase request/i })).toBeVisible();
    expect(screen.getByLabelText(/title/i)).toBeVisible();
    expect(screen.getByLabelText(/project/i)).toBeVisible();
    expect(screen.getByLabelText(/vendor/i)).toBeVisible();
    expect(screen.getByLabelText(/budget category/i)).toBeVisible();
    expect(screen.getByTestId('line-items-section')).toBeVisible();
    expect(screen.queryByText(/quotation/i)).not.toBeInTheDocument();
  });

  it('AC-PROC1-002 saves the Draft request and its entered line before replacing to detail', async () => {
    renderCreate();
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

  it('the create page asks only for a request: no first-document choice, and Save opens the plain purchase page', async () => {
    renderCreate();
    expect(screen.queryByLabelText('First document')).toBeNull();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Cement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/procurement/new-id', { replace: true }));
  });

  it('AC-PROC1-003 preselects project from query and creates nothing when leaving', () => {
    const { unmount } = renderCreate('/procurement/new?project=p1');
    expect(screen.getByText('Project One')).toBeVisible();
    unmount();
    expect(mocks.createRequest).not.toHaveBeenCalled();
    expect(mocks.createItem).not.toHaveBeenCalled();
  });

  it('AC-PROC1-004 required title error is inline and blocks creation', () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('A request title is required.')).toBeVisible();
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
    expect(screen.getByLabelText(/vendor/i)).toBeDisabled();
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
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: /procurement/i }));
    expect(mocks.navigate).toHaveBeenCalledWith('/procurement');
    mocks.navigate.mockClear();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /procurement/i }));
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
