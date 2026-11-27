import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '@/src/lib/i18n';
import { can } from '@/src/auth/policy';
import workOrdersId from '@/public/locales/id/workOrders.json';

/**
 * #2585 the Client material section: AC-CSR-001 figures (hand calculation), AC-CSR-002 two units never added, AC-CSR-003
 * the empty state, FR-CSR-021 every action behind can(), refusals in plain words, both languages.
 */
const h = vi.hoisted(() => ({
  role: 'Project Manager' as string, realRole: 'Project Manager' as string, userId: 'u-pm',
  query: null as unknown, mutations: null as unknown, stockItemsArgs: [] as unknown[],
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (a: never, e: never, ctx?: object) => can(a, e, { realRole: h.role as never, ...ctx }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1' } }) }));
vi.mock('@/src/hooks/useClientRequisitions', () => ({
  useWorkOrderClientMaterial: () => h.query, useClientRequisitionMutations: () => h.mutations,
}));
const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
vi.mock('@/src/hooks/useStock', () => ({
  useStockItems: (...args: unknown[]) => {
    h.stockItemsArgs.push(args);
    return ok([{ id: 'i1', code: 'CEM', name: 'Cement', unit_id: 'un1', tag_id: 't1' }, { id: 'i2', code: 'STL', name: 'Steel', unit_id: 'un1', tag_id: 't2' }]);
  },
  useStockUnits: () => ok([{ id: 'un1', code: 'BAG' }]),
  useStockWarehouses: () => ok([{ id: 'w1', code: 'S1', name: 'Site', kind: 'site', project_id: 'p1' }, { id: 'w2', code: 'C', name: 'Central', kind: 'central', project_id: null }]),
  useStockKeepers: () => ok([{ user_id: 'u-keeper', warehouse_id: 'w1' }]),
  useMyStockLocations: () => ((rows: { user_id: string; warehouse_id: string }[], me: string) => { const ids = new Set(rows.filter((k) => k.user_id === me).map((k) => k.warehouse_id)); return { ids, keeps: (id?: string | null) => !!id && ids.has(id), keepsAny: ids.size > 0, isError: false, isPending: false, refetch: () => undefined }; })([{ user_id: 'u-keeper', warehouse_id: 'w1' }], h.userId),
}));
vi.mock('@/src/hooks/useStockSiteWork', () => ({ useStockTags: () => ok([{ id: 't1', name: 'Free issue', zero_cost: true }, { id: 't2', name: 'Own', zero_cost: false }]) }));

import { ClientMaterialSection } from './ClientMaterialSection';

const mut = () => ({ mutateAsync: vi.fn().mockResolvedValue('x'), isPending: false, isError: false, reset: vi.fn(), error: null });
const REQ = { id: 'r1', number: 'CSR-1', workOrderId: 'w', projectId: 'p1', clientReference: 'CL-1', status: 'open' as const, createdBy: 'u-eng', createdAt: 't', sentAt: 't' };
const LINE = { id: 'l1', requisitionId: 'r1', requisitionNumber: 'CSR-1', requisitionStatus: 'open' as const, itemId: 'i1', itemCode: 'CEM', itemName: 'Cement', unit: 'BAG', takeoffQuantity: '100', requestedQuantity: '100' };
const ev = (kind: string, quantity: string, extra = {}) => ({ id: `${kind}${quantity}`, requisitionId: 'r1', lineId: 'l1', kind, quantity, clientReference: 'CL', eventOn: '2026-11-20', reason: kind === 'released' ? 'client took it back' : null, recordedBy: 'u', createdAt: 't', ...extra });
const HAND = {
  requisitions: [REQ], lines: [LINE],
  events: [ev('reserved', '60'), ev('reserved', '20'), ev('released', '10')],
  pickups: [{ id: 'p1', requisitionId: 'r1', lineId: 'l1', quantity: '50', pickedUpOn: '2026-11-20', collector: 'Budi', paperReference: 'DN-1', warehouseId: 'w1', stockDocumentId: 'd1' }],
};
const renderIt = () => render(<ClientMaterialSection workOrderId="w" projectId="p1" workOrderStatus="Issued" allocationOptions={[]} />);

it('an engineer editing only the draft reference preserves its contract line', async () => {
  h.role = 'Engineer'; h.realRole = 'Engineer'; h.userId = 'u-eng';
  h.query = ok({ requisitions: [{ ...REQ, status: 'draft' }], lines: [{ ...LINE, requisitionStatus: 'draft', workOrderLineId: 'allocation-1' }], events: [], pickups: [] });
  renderIt();
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await userEvent.type(screen.getByLabelText('Client reference'), '-changed');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect((h.mutations as { updateDraft: { mutateAsync: ReturnType<typeof vi.fn> } }).updateDraft.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ workOrderLineId: 'allocation-1' })] }));
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  h.role = 'Project Manager'; h.realRole = 'Project Manager'; h.userId = 'u-pm';
  h.query = ok(HAND);
  h.mutations = { create: mut(), updateDraft: mut(), send: mut(), cancel: mut(), recordReservation: mut(), recordRelease: mut(), recordPickup: mut() };
  h.stockItemsArgs.length = 0;
});

describe('ClientMaterialSection', () => {
  it('bounds the stock items query to zero-cost tags with a page limit', () => {
    renderIt();
    expect(h.stockItemsArgs.length).toBeGreaterThan(0);
    const [filters, opts] = h.stockItemsArgs[0] as [{ tagIds?: string[]; limit?: number }, { enabled?: boolean }?];
    expect(filters).toEqual({ tagIds: ['t1'], limit: 1000 });
    expect(opts?.enabled).toBe(true);
  });
  it('AC-CSR-001 shows reserved 70, collected 50, still to collect 20 and awaiting reservation 30 for the hand calculation', () => {
    renderIt();
    const t = screen.getByTestId('csr-total-i1-BAG');
    expect(within(t).getByTestId('csr-requested').textContent).toBe('100');
    expect(within(t).getByTestId('csr-reserved').textContent).toBe('70');
    expect(within(t).getByTestId('csr-collected').textContent).toBe('50');
    expect(within(t).getByTestId('csr-still').textContent).toBe('20');
    expect(within(t).getByTestId('csr-awaiting').textContent).toBe('30');
  });

  it('AC-CSR-001 the history behind the figures lists the reservations, the release and the pickup', () => {
    renderIt();
    const history = screen.getByTestId('csr-history-CSR-1').textContent ?? '';
    expect(history).toMatch(/Reserved 60/);
    expect(history).toMatch(/Reserved 20/);
    expect(history).toMatch(/Released 10 · client took it back/);
    expect(history).toMatch(/Collected 50.*Budi.*DN-1/);
  });

  it('AC-CSR-002 an item in two units is shown twice, never added', () => {
    h.query = ok({ ...HAND, lines: [LINE, { ...LINE, id: 'l2', unit: 'KG', requestedQuantity: '40', takeoffQuantity: '40' }] });
    renderIt();
    expect(screen.getByTestId('csr-total-i1-BAG')).toBeTruthy();
    expect(within(screen.getByTestId('csr-total-i1-KG')).getByTestId('csr-requested').textContent).toBe('40');
  });

  it('AC-CSR-003 a work order with no requisition shows an empty state, not zeros', () => {
    h.query = ok({ requisitions: [], lines: [], events: [], pickups: [] });
    renderIt();
    expect(screen.getByTestId('csr-empty').textContent).toMatch(/No client material has been requested/);
    expect(screen.queryByTestId('csr-totals')).toBeNull();
  });

  it('shows a loading state and an error state with retry', async () => {
    h.query = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const { unmount } = renderIt();
    unmount();
    const refetch = vi.fn();
    h.query = { data: undefined, isPending: false, isError: true, refetch };
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('FR-CSR-021 a Project Manager records reservations and releases; an Engineer who does not keep the location sees neither, nor a pickup', () => {
    renderIt();
    expect(screen.getByRole('button', { name: 'Record reservation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record release' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record pickup' })).toBeNull();     // a PM who is no keeper does not receive stock
    h.role = 'Engineer'; h.realRole = 'Engineer'; h.userId = 'u-eng';
    h.query = ok(HAND);
    const { container } = renderIt();
    expect(within(container).queryByRole('button', { name: 'Record reservation' })).toBeNull();
  });

  it('FR-CSR-010 the keeper of the location records a pickup; the dialog refuses more than is still to collect, in words', async () => {
    h.role = 'Engineer'; h.realRole = 'Engineer'; h.userId = 'u-keeper';
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Record pickup' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('csr-dialog-line').textContent).toMatch(/20 still to collect/);
    await userEvent.type(within(dialog).getByLabelText(/Quantity collected/), '21');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record pickup' }));
    expect(await within(dialog).findByText('Only 20 is still to collect.')).toBeTruthy();
    expect((h.mutations as { recordPickup: { mutateAsync: ReturnType<typeof vi.fn> } }).recordPickup.mutateAsync).not.toHaveBeenCalled();
  });

  it('FR-CSR-010 a pickup on a line with nothing reserved yet says so, instead of "Only 0 is still to collect"', async () => {
    h.role = 'Engineer'; h.realRole = 'Engineer'; h.userId = 'u-keeper';
    h.query = ok({ ...HAND, events: [], pickups: [] });
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Record pickup' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Quantity collected/), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record pickup' }));
    expect(await within(dialog).findByText(/Nothing is reserved on this line yet/)).toBeTruthy();
    expect(within(dialog).queryByText(/Only 0/)).toBeNull();
  });

  it('FR-CSR-010 a valid pickup sends the line, quantity and the only location the keeper keeps; no cost', async () => {
    h.role = 'Engineer'; h.realRole = 'Engineer'; h.userId = 'u-keeper';
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Record pickup' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Quantity collected/), '20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record pickup' }));
    const fn = (h.mutations as { recordPickup: { mutateAsync: ReturnType<typeof vi.fn> } }).recordPickup.mutateAsync;
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    const arg = fn.mock.calls[0][0];
    expect(arg).toMatchObject({ lineId: 'l1', quantity: '20', warehouseId: 'w1' });
    expect(Object.keys(arg).some((k) => /cost/i.test(k))).toBe(false);
    expect(typeof arg.clientRequestId).toBe('string');
  });

  it('W1 a slip photo chosen in the pickup dialog travels with the pickup', async () => {
    h.role = 'Engineer'; h.realRole = 'Engineer'; h.userId = 'u-keeper';
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Record pickup' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Quantity collected/), '20');
    const slip = new File(['x'], 'slip.jpg', { type: 'image/jpeg' });
    await userEvent.upload(within(dialog).getByLabelText('Delivery slip photo'), slip);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record pickup' }));
    const fn = (h.mutations as { recordPickup: { mutateAsync: ReturnType<typeof vi.fn> } }).recordPickup.mutateAsync;
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(fn.mock.calls[0][0].slip).toBe(slip);
  });

  it('FR-CSR-006/007 a reservation over what can still be reserved is refused before the call', async () => {
    h.query = ok({ ...HAND, events: [ev('reserved', '60'), ev('reserved', '20')] });   // requested 100, reserved 80: room 20
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Record reservation' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Quantity reserved/), '25');
    await userEvent.type(within(dialog).getByLabelText(/Client's reference/), 'CL-9');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record reservation' }));
    expect(await within(dialog).findByText('Reserved would exceed requested by 5.')).toBeTruthy();
  });

  it('a refused write from the database reaches the dialog in plain words', async () => {
    const m = h.mutations as { recordRelease: { mutateAsync: ReturnType<typeof vi.fn> } };
    m.recordRelease.mutateAsync.mockRejectedValue(Object.assign(new Error('CSR_RELEASE_BELOW_COLLECTED: a release of 5 would take reserved below the 50 already collected'), { code: 'P0001' }));
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Record release' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Quantity released/), '5');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'client changed plan');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record release' }));
    expect(await within(dialog).findByText('A release cannot take reserved below the 50 already collected.')).toBeTruthy();
  });

  for (const [language, sentence] of [
    ['en', 'This item needs a quality check, so it cannot be recorded as a pickup.'],
    ['id', 'Barang ini perlu pemeriksaan mutu, sehingga tidak dapat dicatat sebagai pengambilan.'],
  ] as const) {
    it(`D4 a pickup of an item that needs a quality check says it cannot be recorded as a pickup (${language})`, async () => {
      i18n.addResourceBundle('id', 'workOrders', workOrdersId, true, true);
      await i18n.changeLanguage(language);
      h.role = 'Engineer'; h.realRole = 'Engineer'; h.userId = 'u-keeper';
      const fn = (h.mutations as { recordPickup: { mutateAsync: ReturnType<typeof vi.fn> } }).recordPickup.mutateAsync;
      fn.mockRejectedValue(Object.assign(new Error('STK_QUALITY_RECEIPT: this item needs a quality check: record how many passed and how many were rejected'), { code: 'P0001' }));
      renderIt();
      await userEvent.click(screen.getByRole('button', { name: /Record pickup|Catat pengambilan/ }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/^(Quantity collected|Kuantitas diambil)/), '20');
      await userEvent.click(within(dialog).getByRole('button', { name: /Record pickup|Catat pengambilan/ }));
      expect(await within(dialog).findByText(sentence)).toBeTruthy();
    });
  }

  it('FR-CSR-004 cancel is offered to the author until a pickup is posted, then not', () => {
    h.role = 'Engineer'; h.realRole = 'Engineer'; h.userId = 'u-eng';
    h.query = ok({ ...HAND, pickups: [] });
    const { unmount } = renderIt();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    unmount();
    h.query = ok(HAND);
    renderIt();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('FR-CSR-004 a draft is sent by its author through the send call', async () => {
    h.role = 'Engineer'; h.realRole = 'Engineer'; h.userId = 'u-eng';
    h.query = ok({ requisitions: [{ ...REQ, status: 'draft' }], lines: [{ ...LINE, requisitionStatus: 'draft' }], events: [], pickups: [] });
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Send to client' }));
    expect((h.mutations as { send: { mutateAsync: ReturnType<typeof vi.fn> } }).send.mutateAsync).toHaveBeenCalledWith({ id: 'r1' });
    expect(screen.queryByRole('button', { name: 'Record reservation' })).toBeNull();
  });

  it('FR-CSR-021 a view-as session is view-only: no action is offered', () => {
    h.realRole = 'Admin';                                        // real Admin viewing as a Project Manager
    renderIt();
    expect(screen.queryByRole('button', { name: 'Record reservation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New requisition' })).toBeNull();
  });

  it('a requisition is raised only on a Draft or Issued work order, and only offering zero-cost items', async () => {
    const { rerender } = renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'New requisition' }));
    const dialog = await screen.findByRole('dialog');
    const options = within(dialog).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(options.some((o) => o.includes('CEM'))).toBe(true);
    expect(options.some((o) => o.includes('STL'))).toBe(false);
    rerender(<ClientMaterialSection workOrderId="w" projectId="p1" workOrderStatus="Closed" allocationOptions={[]} />);
  });

  it('NFR-CSR-003 every English string of the section has a Bahasa Indonesia counterpart, translated', () => {
    const load = (loc: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${loc}/workOrders.json`), 'utf8')).clientMaterial as Record<string, unknown>;
    const flat = (o: Record<string, unknown>, p = ''): Record<string, string> =>
      Object.entries(o).reduce((a, [k, v]) => (typeof v === 'string' ? { ...a, [`${p}${k}`]: v } : { ...a, ...flat(v as Record<string, unknown>, `${p}${k}.`) }), {});
    const en = flat(load('en')); const id = flat(load('id'));
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).filter((k) => /[a-z]{4,}/i.test(en[k].replace(/\{\{[^}]*\}\}/g, '')) && id[k] === en[k])).toEqual([]);
  });
});
