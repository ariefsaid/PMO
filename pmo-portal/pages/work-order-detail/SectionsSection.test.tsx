import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import enCommon from '../../public/locales/en/common.json';
import idCommon from '../../public/locales/id/common.json';
import enWos from '../../public/locales/en/workOrderSections.json';
import idWos from '../../public/locales/id/workOrderSections.json';
import { ToastProvider } from '@/src/components/ui';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import type { SectionRollupRow } from '@/src/lib/repositories/workOrderSections';

const h = vi.hoisted(() => ({
  role: 'Project Manager' as string, userId: 'u-pm',
  roll: { data: undefined, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() } as Record<string, unknown>,
  counts: { data: null } as Record<string, unknown>,
  progress: { data: [] as unknown[] } as Record<string, unknown>,
  check: { data: [] as unknown[], isPending: false, isError: false } as Record<string, unknown>,
  setReadiness: vi.fn(), archive: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1' } }) }));
vi.mock('@/src/hooks/useOrgProfilesLoader', () => ({ useOrgProfilesLoader: () => () => Promise.resolve([{ id: 'u-foreman', full_name: 'Fiona Foreman', status: 'active' }]) }));
vi.mock('@/src/hooks/useWorkOrderSections', () => ({
  useWorkOrderSectionRollup: () => h.roll,
  useWorkOrderSectionReadiness: () => h.counts,
  useWorkOrderSectionProgress: () => h.progress,
  useSetSectionReadiness: () => ({ mutate: h.setReadiness, isPending: false }),
  useArchiveSection: () => ({ mutateAsync: h.archive, isPending: false }),
  useDeleteSection: () => ({ mutateAsync: h.remove, isPending: false }),
  useSaveSection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveSectionPlan: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSectionReadinessEvents: () => ({ data: [], isPending: false }),
}));

vi.mock('@/src/hooks/useWorkOrderSectionMaterials', () => ({
  useSectionMaterialCheck: () => h.check,
  useSectionAllocations: () => ({ data: [], isPending: false }),
  useSetAllocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useStock', () => ({
  useStockItems: () => ({ data: [{ id: 'i1', code: 'CBL', name: 'Cable', unit_id: 'u1', archived_at: null }] }),
  useStockUnits: () => ({ data: [{ id: 'u1', code: 'm' }] }),
}));
vi.mock('@/src/hooks/useMaterialRequests', () => ({ useLinePlans: () => ({ data: [], isPending: false }) }));

import { SectionsSection } from './SectionsSection';

const row = (over: Partial<SectionRollupRow>): SectionRollupRow => ({
  sectionId: 's1', code: 'A', name: 'North block', locationNote: 'levels 1 to 3', foremanId: 'u-foreman', readiness: 'not_ready', readinessNote: null,
  sortOrder: 1, archivedAt: null, directBudget: '400.00', indirectBudget: null, equipmentHours: null, crewHours: null, tasksTotal: 4, tasksDone: 1, crewsToday: 2, ...over,
});
const remainder = row({ sectionId: null, code: null, name: null, foremanId: null, locationNote: null, readiness: null, sortOrder: null, directBudget: '250.00', tasksTotal: 0, tasksDone: 0, crewsToday: 0 });
const WO = { id: 'w1', project_id: 'p1', status: 'Issued', currency: 'IDR' };

async function mount(lng: 'en' | 'id' = 'en') {
  const i18n = createInstance();
  await i18n.init({ lng, fallbackLng: 'en', ns: ['common', 'workOrderSections'], defaultNS: 'common', interpolation: { escapeValue: false },
    resources: { en: { common: enCommon, workOrderSections: enWos }, id: { common: idCommon, workOrderSections: idWos } } });
  return render(<I18nextProvider i18n={i18n}><ToastProvider><SectionsSection workOrder={WO} /></ToastProvider></I18nextProvider>);
}
const ok = (rows: SectionRollupRow[]) => ({ data: rows, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() });

beforeEach(() => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  h.role = 'Project Manager'; h.userId = 'u-pm';
  h.roll = ok([]); h.counts = { data: null }; h.progress = { data: [] }; h.check = { data: [], isPending: false, isError: false };
  h.setReadiness.mockReset();
});

describe('SectionsSection (#2576)', () => {
  it('AC-WOS-001 a work order with no sections shows the empty block with the add action to a user who may add one', async () => {
    await mount();
    expect(screen.getByTestId('wo-sections-empty').textContent).toBe('No sections yet.');
    expect(screen.getByRole('button', { name: 'Add section' })).toBeTruthy();
  });

  it('AC-WOS-001 and shows nothing at all to a user who may not add one', async () => {
    h.role = 'Engineer';
    const { container } = await mount();
    expect(container.querySelector('[data-testid="wo-page-sections"]')).toBeNull();
  });

  it('shows loading and an error with retry', async () => {
    h.roll = { data: undefined, isPending: true, isError: false, isSuccess: false, refetch: vi.fn() };
    const { unmount } = await mount();
    expect(screen.getByTestId('wo-page-sections')).toBeTruthy();
    unmount();
    const refetch = vi.fn();
    h.roll = { data: undefined, isPending: false, isError: true, isSuccess: false, refetch };
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('FR-WOS-021 lists code, name, foreman, planned figure, task progress and crews, then the unsectioned row', async () => {
    h.roll = ok([row({}), remainder]);
    await mount();
    const a = screen.getByTestId('wo-section-A');
    expect(within(a).getByText(/North block/)).toBeTruthy();
    expect(a.textContent).toContain('levels 1 to 3');
    expect(await within(a).findByText(/Fiona Foreman/)).toBeTruthy();
    expect(a.textContent).toContain('1 of 4 tasks done');
    expect(a.textContent).toContain('2 crews today');
    expect(screen.getByTestId('wo-section-plan-A').textContent).toMatch(/400/);
    const rest = screen.getByTestId('wo-section-remainder');
    expect(rest.textContent).toContain('Not in a section');
    expect(screen.getByTestId('wo-section-plan-remainder').textContent).toMatch(/250/);
  });

  it('FR-WOS-016 shows each section\'s validated daily quantity by unit, and none where no report is validated', async () => {
    h.roll = ok([row({}), row({ sectionId: 's2', code: 'B', name: 'South block' }), remainder]);
    h.progress = { data: [
      { sectionId: 's1', workOrderLineId: 'l1', unit: 'm', quantity: '10.000' },
      { sectionId: 's1', workOrderLineId: 'l2', unit: 'm', quantity: '0.500' },
      { sectionId: null, workOrderLineId: 'l1', unit: 'm', quantity: '2.500' },
    ] };
    await mount();
    expect(within(screen.getByTestId('wo-section-A')).getByText('Validated: 10.500 m')).toBeInTheDocument();
    expect(within(screen.getByTestId('wo-section-remainder')).getByText('Validated: 2.500 m')).toBeInTheDocument();
    expect(within(screen.getByTestId('wo-section-B')).queryByText(/Validated/)).not.toBeInTheDocument();
  });

  it('AC-WOS-014 summarises the server\'s readiness counts, and says nothing with no live section', async () => {
    h.roll = ok([row({})]);
    h.counts = { data: { live_sections: 3, ready: 2, not_ready: 0, blocked: 1, all_ready: false } };
    const { unmount } = await mount();
    expect(screen.getByText('2 of 3 ready · 1 blocked')).toBeTruthy();
    unmount();
    h.counts = { data: { live_sections: 2, ready: 2, not_ready: 0, blocked: 0, all_ready: true } };
    await mount();
    expect(screen.getByText('All 2 ready')).toBeTruthy();
  });

  it('a Project Manager sets readiness from the row', async () => {
    h.roll = ok([row({})]);
    await mount();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Readiness of A' }), 'ready');
    expect(h.setReadiness).toHaveBeenCalledWith({ id: 's1', readiness: 'ready', note: null }, expect.anything());
  });

  it('AC-WOS-015 the foreman sets readiness on their own section only and sees no edit, plan, archive or delete', async () => {
    h.role = 'Engineer'; h.userId = 'u-foreman';
    h.roll = ok([row({}), row({ sectionId: 's2', code: 'B', name: 'South block', foremanId: 'u-other' })]);
    await mount();
    expect(screen.getByRole('combobox', { name: 'Readiness of A' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Readiness of B' })).toBeNull();
    expect(screen.getByTestId('wo-section-B').textContent).toContain('Not ready');
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for A' }));
    expect(await screen.findByRole('menuitem', { name: 'Readiness and history' })).toBeTruthy();
    for (const name of ['Edit', 'Plan', 'Archive', 'Delete']) expect(screen.queryByRole('menuitem', { name })).toBeNull();
  });

  it('only an Admin is offered Delete', async () => {
    h.role = 'Admin';
    h.roll = ok([row({})]);
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for A' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('FR-WOS-022 archived sections are hidden until asked for, and keep their label', async () => {
    h.roll = ok([row({}), row({ sectionId: 's9', code: 'Z', name: 'Old yard', archivedAt: '2026-11-01T00:00:00Z' })]);
    await mount();
    expect(screen.queryByTestId('wo-section-Z')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show archived' }));
    expect(screen.getByTestId('wo-section-Z').textContent).toContain('Archived');
  });

  it('FR-WOS-014 shows plan, requested and remaining per section and item, and for the unsectioned remainder', async () => {
    h.roll = ok([row({}), row({ sectionId: 's2', code: 'B', name: 'South' }), remainder]);
    h.check = { isPending: false, isError: false, data: [
      { sectionId: 's1', itemId: 'i1', planQty: 60, requestedQty: 40, remainingQty: 20, workOrderPlanQty: 100, overAllocated: false },
      { sectionId: 's2', itemId: 'i1', planQty: 30, requestedQty: 10, remainingQty: 20, workOrderPlanQty: 100, overAllocated: false },
      { sectionId: null, itemId: 'i1', planQty: 10, requestedQty: 20, remainingQty: -10, workOrderPlanQty: 100, overAllocated: false },
    ] };
    await mount();
    const a = screen.getByTestId('wo-material-A-i1');
    expect(a.textContent).toContain('60');
    expect(a.textContent).toContain('40');
    expect(a.textContent).toContain('20');
    expect(screen.getByTestId('wo-material-remainder-i1').textContent).toContain('-10');
    expect(screen.getByTestId('wo-material-remainder-i1').textContent).toContain('Not in a section');
    expect(screen.queryByTestId('wo-material-over-allocated')).toBeNull();
  });

  it('AC-WOS-008 flags an over-allocated item without rewriting anything', async () => {
    h.roll = ok([row({})]);
    h.check = { isPending: false, isError: false, data: [
      { sectionId: 's1', itemId: 'i1', planQty: 60, requestedQty: 0, remainingQty: 60, workOrderPlanQty: 50, overAllocated: true },
    ] };
    await mount();
    expect(screen.getByTestId('wo-material-over-allocated').textContent).toBe('Cable is allocated above the work-order plan.');
  });

  it('a failed material read never breaks the sections block', async () => {
    h.roll = ok([row({})]);
    h.check = { isPending: false, isError: true, data: undefined };
    await mount();
    expect(screen.getByTestId('wo-section-A')).toBeTruthy();
    expect(screen.queryByTestId('wo-sections-material')).toBeNull();
  });

  it('only a role that writes plans is offered the Material action', async () => {
    h.roll = ok([row({})]);
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for A' }));
    expect(await screen.findByRole('menuitem', { name: 'Material' })).toBeTruthy();
  });

  it('NFR-WOS-004 the word comes from the terms: Bahasa shows "Bagian", not an English literal', async () => {
    await mount('id');
    expect(screen.getByRole('heading', { name: 'Bagian' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tambah bagian' })).toBeTruthy();
    expect(screen.getByTestId('wo-sections-empty').textContent).toBe('Belum ada bagian.');
  });

  it('#2976 a failed validated-quantities read shows Retry while keeping loaded sections visible', async () => {
    const refetch = vi.fn();
    h.roll = ok([row({})]);
    h.progress = { data: undefined, isPending: false, isError: true, refetch };
    await mount();
    expect(screen.getByTestId('wo-section-A')).toBeTruthy();
    expect(screen.getByText("Couldn't load validated quantities").closest('[role="alert"]')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('#2976 a failed sections refresh keeps loaded sections visible alongside Retry', async () => {
    const refetch = vi.fn();
    h.roll = { data: [row({})], isPending: false, isError: true, isSuccess: false, refetch };
    await mount();
    expect(screen.getByTestId('wo-section-A')).toBeTruthy();
    expect(screen.getByText("Couldn't load sections").closest('[role="alert"]')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
