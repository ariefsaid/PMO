import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  th: { pct1: 60, pct2: 100 } as { pct1: number | null; pct2: number | null },
  tz: 'Asia/Jakarta',
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
  useLiveSections: () => ({ data: [], isPending: false, isError: false }),
  useSectionLinePlans: () => ({ data: [], isPending: false, isError: false }),
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

vi.mock('@/src/hooks/useUsageThresholds', () => ({ useUsageThresholds: () => ({ thresholds: h.th, reload: vi.fn() }) }));

import MaterialRequestNewPage from './MaterialRequestNew';

const pick = async (label: RegExp, option: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
};

describe('AC-MUT-009 usage warning on the request form', () => {
  it('warns on a line past the first threshold and still lets the request be saved and sent', async () => {
    h.th = { pct1: 60, pct2: 100 };
    render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
    await pick(/^project/i, 'Site Alpha');
    await pick(/^work order/i, 'WO-1 · Slab');
    await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
    await userEvent.type(screen.getByLabelText(/^quantity/i), '3');
    expect(await screen.findByTestId('mrq-usage-warning')).toHaveTextContent('Use reaches 70% of plan, past the 60% warning.');
    expect(screen.getByRole('button', { name: 'Send for approval' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  });
  it('shows nothing extra while the thresholds are unset', async () => {
    h.th = { pct1: null, pct2: null };
    render(<MemoryRouter><ToastProvider><MaterialRequestNewPage /></ToastProvider></MemoryRouter>);
    await userEvent.selectOptions(screen.getByLabelText(/^item/i), 'i1');
    await userEvent.type(screen.getByLabelText(/^quantity/i), '3');
    expect(screen.queryByTestId('mrq-usage-warning')).not.toBeInTheDocument();
  });
});
