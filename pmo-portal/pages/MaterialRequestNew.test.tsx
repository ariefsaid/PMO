import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  tz: 'Asia/Jakarta',
  sections: [] as Array<{ id: string; code: string; name: string }>,
  sectionPlans: [] as Array<{ itemId: string; sectionPlanQty: number | null; sectionPriorQty: number | null }>,
  warehouses: [{ id: 'wh1', code: 'S1', name: 'Site one', kind: 'site', archived_at: null, project_id: 'p1' }] as unknown[],
  warehouseQuery: { isPending: false, isError: false, refetch: vi.fn() },
  saveDraft: { mutateAsync: vi.fn().mockResolvedValue('r1'), isPending: false },
  submit: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
}));
vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useMaterialRequest: (id?: string) => ({
    data: id ? { projectId: 'p1', workOrderId: 'w1', neededBy: '2026-11-25', note: null, lines: [{ id: 'l1', itemId: 'i1', quantity: 2, overPlanReason: null }] } : undefined,
    isPending: false, isError: false,
  }),
  useMaterialRequestMutations: () => ({ saveDraft: h.saveDraft, submit: h.submit }),
  useLinePlans: () => ({ data: [{ itemId: 'i1', planQty: 10, priorQty: 4 }], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useWorkOrderSectionMaterials', () => ({
  useLiveSections: () => ({ data: h.sections, isPending: false, isError: false }),
  useSectionLinePlans: () => ({ data: h.sectionPlans, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [{ id: 'p1', name: 'Site Alpha', short_name: null }] }) }));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [{ id: 'w1', title: 'Slab', wo_number: 'WO-1', status: 'Issued' }], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useStock', () => ({
  useStockItems: () => ({ data: [{ id: 'i1', code: 'CEM', name: 'Cement', unit_id: 'u1', archived_at: null }, { id: 'i2', code: 'BRK', name: 'Brick', unit_id: 'u2', archived_at: null }], isPending: false, isError: false, refetch: vi.fn() }),
  useStockWarehouses: () => ({ data: h.warehouses, ...h.warehouseQuery }),
  useStockUnits: () => ({ data: [{ id: 'u1', code: 'BAG', whole_only: false }, { id: 'u2', code: 'PCS', whole_only: true }] }),
}));
vi.mock('@/src/hooks/useOrgFxContext', () => ({ useOrgFxContext: () => ({ data: { currency: 'IDR', timezone: h.tz }, isPending: false }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

import MaterialRequestNewPage from './MaterialRequestNew';

const pick = async (label: RegExp, option: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
};

describe('raise a material request on a section (#2576)', () => {
  afterEach(() => { h.sections = []; h.sectionPlans = []; vi.clearAllMocks(); });

  it('FR-WOS-009 offers no section picker for a work order with none', async () => {
    render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
    await pick(/^project/i, 'Site Alpha');
    await pick(/^work order/i, 'WO-1 · Slab');
    expect(screen.queryByLabelText('Section')).not.toBeInTheDocument();
  });

  it('FR-WOS-015 a line within the work order\'s plan but over its section\'s allocation asks for a reason, and the header carries the section', async () => {
    h.sections = [{ id: 's1', code: 'A', name: 'North' }];
    h.sectionPlans = [{ itemId: 'i1', sectionPlanQty: 6, sectionPriorQty: 4 }];
    render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
    await pick(/^project/i, 'Site Alpha');
    await pick(/^work order/i, 'WO-1 · Slab');
    await userEvent.selectOptions(screen.getByLabelText('Section'), 's1');
    await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
    await userEvent.type(screen.getByLabelText(/^quantity/i), '3');
    // work order: plan 10, prior 4, new total 7 (within); section: plan 6, prior 4, new total 7 (over)
    expect(screen.getByTestId('mrq-plan')).toHaveTextContent('Plan 10 · already requested 4 · new total 7');
    expect(screen.getByTestId('mrq-section-plan')).toHaveTextContent('Section plan 6 · already requested 4');
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByText(/Give a reason/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Why do you need more/), 'Extra run');
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(h.saveDraft.mutateAsync.mock.calls[0][0].header.sectionId).toBe('s1');
  });

  it('a section with no allocation for the item is checked against the work order only', async () => {
    h.sections = [{ id: 's1', code: 'A', name: 'North' }];
    h.sectionPlans = [{ itemId: 'i1', sectionPlanQty: null, sectionPriorQty: 0 }];
    render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
    await pick(/^project/i, 'Site Alpha');
    await pick(/^work order/i, 'WO-1 · Slab');
    await userEvent.selectOptions(screen.getByLabelText('Section'), 's1');
    await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
    await userEvent.type(screen.getByLabelText(/^quantity/i), '3');
    expect(screen.queryByTestId('mrq-section-plan')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Why do you need more/)).not.toBeInTheDocument();
  });
});

describe('raise a material request', () => {
  it('AC-MRQ-001 an over-plan line asks for a reason and cannot be sent without one', async () => {
    render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
    await pick(/^project/i, 'Site Alpha');
    await pick(/^work order/i, 'WO-1 · Slab');
    await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
    await userEvent.type(screen.getByLabelText(/^quantity/i), '8');
    expect(screen.getByTestId('mrq-plan')).toHaveTextContent('Plan 10 · already requested 4 · new total 12');
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByText(/Give a reason/)).toBeInTheDocument();
    expect(h.saveDraft.mutateAsync).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Why do you need more/), 'Extra slab pour');
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(h.saveDraft.mutateAsync).toHaveBeenCalledOnce();
    expect(h.saveDraft.mutateAsync.mock.calls[0][0].lines).toEqual([{ itemId: 'i1', quantity: 8, overPlanReason: 'Extra slab pour' }]);
    expect(h.submit.mutateAsync).toHaveBeenCalledOnce();
  });

  it('a line within plan shows no reason field', async () => {
    render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
    await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
    await userEvent.type(screen.getByLabelText(/^quantity/i), '3');
    expect(screen.queryByLabelText(/Why do you need more/)).not.toBeInTheDocument();
  });

  it('a refused submit leaves the draft saved and still shows why on the edit screen', async () => {
    h.saveDraft.mutateAsync.mockResolvedValueOnce('r9');
    h.submit.mutateAsync.mockRejectedValueOnce(new Error('MRQ_CUTOFF: requests for tomorrow close at 12:00; the earliest date you can request is 2026-11-22'));
    render(<MemoryRouter><ToastProvider><Routes>
      <Route path="/" element={<MaterialRequestNewPage />} />
      <Route path="/material-requests/:requestId/edit" element={<MaterialRequestNewPage />} />
    </Routes></ToastProvider></MemoryRouter>);
    await pick(/^project/i, 'Site Alpha');
    await pick(/^work order/i, 'WO-1 · Slab');
    await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
    await userEvent.type(screen.getByLabelText(/^quantity/i), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByText(/closed at 12:00.*earliest date/)).toBeInTheDocument();
  });

  it('#2610 a quantity typed with a decimal comma is read as that fraction and sent with a dot', async () => {
    h.saveDraft.mutateAsync.mockClear();
    render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
    await pick(/^project/i, 'Site Alpha');
    await pick(/^work order/i, 'WO-1 · Slab');
    await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
    await userEvent.type(screen.getByLabelText(/^quantity/i), '2,5');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(h.saveDraft.mutateAsync.mock.calls[0][0].lines[0].quantity).toBe(2.5);
  });

  describe('#2613 the form says why before the server has to', () => {
    const fill = async (itemId: string, qty: string) => {
      render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
      await pick(/^project/i, 'Site Alpha');
      await pick(/^work order/i, 'WO-1 · Slab');
      await userEvent.selectOptions(screen.getByLabelText(/^item/i), itemId);
      await userEvent.type(screen.getByLabelText(/^quantity/i), qty);
    };
    it('a fraction for an item counted in whole units is refused with a reason', async () => {
      h.saveDraft.mutateAsync.mockClear();
      await fill('i2', '2,5');
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      expect(await screen.findByText(/counted in whole units/)).toBeInTheDocument();
      expect(h.saveDraft.mutateAsync).not.toHaveBeenCalled();
    });
    it('more than three decimals is refused with a reason', async () => {
      h.saveDraft.mutateAsync.mockClear();
      await fill('i1', '1.2345');
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      expect(await screen.findByText(/at most three decimals/)).toBeInTheDocument();
      expect(h.saveDraft.mutateAsync).not.toHaveBeenCalled();
    });
    it('the same item on two lines is refused with a reason', async () => {
      h.saveDraft.mutateAsync.mockClear();
      await fill('i1', '1');
      await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
      await userEvent.selectOptions(screen.getAllByLabelText(/^item/i)[1], 'i1');
      await userEvent.type(screen.getAllByLabelText(/^quantity/i)[1], '1');
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      expect(await screen.findByText(/already on another line/)).toBeInTheDocument();
      expect(h.saveDraft.mutateAsync).not.toHaveBeenCalled();
    });
  });

  describe('#2608 the delivery location', () => {
    const single = [{ id: 'wh1', code: 'S1', name: 'Site one', kind: 'site', archived_at: null, project_id: 'p1' }];
    afterEach(() => {
      h.warehouses = single;
      h.warehouseQuery = { isPending: false, isError: false, refetch: vi.fn() };
    });
    const open = async () => {
      render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
      await pick(/^project/i, 'Site Alpha');
      await pick(/^work order/i, 'WO-1 · Slab');
      await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
      await userEvent.type(screen.getByLabelText(/^quantity/i), '2');
    };
    it('one location is left for the server to pick: no question is asked', async () => {
      h.saveDraft.mutateAsync.mockClear();
      await open();
      expect(screen.queryByLabelText(/deliver to/i)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      expect(h.saveDraft.mutateAsync.mock.calls[0][0].header.toWarehouseId).toBeNull();
    });
    it('a yard and a staging area: the requester must choose, and the choice is sent', async () => {
      h.saveDraft.mutateAsync.mockClear();
      h.warehouses = [{ id: 'y1', code: 'Y1', name: 'Yard', kind: 'yard', archived_at: null, project_id: 'p1' }, { id: 'g1', code: 'G1', name: 'Staging', kind: 'staging', archived_at: null, project_id: 'p1' }];
      await open();
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      expect(await screen.findByText(/several locations/)).toBeInTheDocument();
      expect(h.saveDraft.mutateAsync).not.toHaveBeenCalled();
      await userEvent.selectOptions(screen.getByLabelText(/deliver to/i), 'g1');
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      expect(h.saveDraft.mutateAsync.mock.calls[0][0].header.toWarehouseId).toBe('g1');
    });

    it('does not send while warehouse destinations are still loading', async () => {
      h.warehouseQuery = { isPending: true, isError: false, refetch: vi.fn() };
      h.saveDraft.mutateAsync.mockClear();
      h.submit.mutateAsync.mockClear();
      await open();
      expect(screen.getByTestId('liststate-loading')).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button', { name: 'Send for approval' })).toBeDisabled();
      expect(h.saveDraft.mutateAsync).not.toHaveBeenCalled();
      expect(h.submit.mutateAsync).not.toHaveBeenCalled();
    });

    it('shows a warehouse load error and does not send without knowing the destinations', async () => {
      h.warehouseQuery = { isPending: false, isError: true, refetch: vi.fn() };
      h.saveDraft.mutateAsync.mockClear();
      h.submit.mutateAsync.mockClear();
      await open();
      expect(screen.getByText("Couldn't load delivery locations")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send for approval' })).toBeDisabled();
      expect(h.saveDraft.mutateAsync).not.toHaveBeenCalled();
      expect(h.submit.mutateAsync).not.toHaveBeenCalled();
    });

    it('does not send when the loaded project has no delivery location', async () => {
      h.warehouses = [];
      h.saveDraft.mutateAsync.mockClear();
      h.submit.mutateAsync.mockClear();
      await open();
      expect(screen.getByText(/no site, yard or staging location yet/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send for approval' })).toBeDisabled();
      expect(h.saveDraft.mutateAsync).not.toHaveBeenCalled();
      expect(h.submit.mutateAsync).not.toHaveBeenCalled();
    });
  });

  describe('AC-MRQ-021 default needed-by is tomorrow in the organisation calendar', () => {
    afterEach(() => { vi.useRealTimers(); });
    const shown = () => (screen.getByLabelText(/needed by/i) as HTMLInputElement).value;

    it('23:30 UTC on the 20th is already the 21st in UTC+7, so the default is the 22nd (UTC would say the 21st)', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T23:30:00Z') });
      h.tz = 'Asia/Jakarta';
      render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
      expect(shown()).toBe('22 Nov 2026');
    });

    it('23:30 UTC is still the 20th in UTC-8, so the default is the 21st', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T23:30:00Z') });
      h.tz = 'America/Los_Angeles';
      render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
      expect(shown()).toBe('21 Nov 2026');
    });

    it('the saved draft carries the organisation-calendar date', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T23:30:00Z') });
      h.tz = 'Asia/Jakarta';
      h.saveDraft.mutateAsync.mockClear();
      render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
      await pick(/^project/i, 'Site Alpha');
      await pick(/^work order/i, 'WO-1 · Slab');
      await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
      await userEvent.type(screen.getByLabelText(/^quantity/i), '2');
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      expect(h.saveDraft.mutateAsync.mock.calls[0][0].header.neededBy).toBe('2026-11-22');
    });
  });
});
