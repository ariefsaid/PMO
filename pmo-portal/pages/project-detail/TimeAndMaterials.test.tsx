import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { I18nextProvider } from 'react-i18next';
import { axe } from 'jest-axe';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  effectiveRole: 'Finance' as string,
  userId: 'u-fin' as string,
  rates: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  assignees: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  claims: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  preview: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  sources: { data: { rows: [] as unknown[], truncated: false, totalCount: 0, signoffCurrent: null as boolean | null }, isPending: false, isError: false, refetch: vi.fn() },
  profiles: [] as unknown[],
  documents: [] as unknown[],
  erpConnected: true,
  loadItems: vi.fn(async () => [] as Array<{ value: string; label: string; sub?: string }>),
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.effectiveRole }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useTimeAndMaterials', () => ({
  useTmRateLines: () => h.rates,
  useTmRateAssignees: () => h.assignees,
  useTmClaims: () => h.claims,
  useTmClaimPreview: () => h.preview,
  useTmClaimSources: () => h.sources,
  useDeselectTmSource: () => ({ mutateAsync: h.mutations.deselect, isPending: false }),
  useSaveTmRateLine: () => ({ mutateAsync: h.mutations.saveRate, isPending: false }),
  useSetTmRateAssignee: () => ({ mutateAsync: h.mutations.assign, isPending: false }),
  useEndTmRateAssignee: () => ({ mutateAsync: h.mutations.endAssignee, isPending: false }),
  useEndTmRateLine: () => ({ mutateAsync: h.mutations.endRate, isPending: false }),
  useAssembleTmClaim: () => ({ mutateAsync: h.mutations.assemble, isPending: false }),
  usePrepareTmSignoff: () => ({ mutateAsync: h.mutations.prepare, isPending: false }),
  useWithdrawTmSignoff: () => ({ mutateAsync: h.mutations.withdraw, isPending: false }),
  useConfirmTmSignoff: () => ({ mutateAsync: h.mutations.confirm, isPending: false }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: h.profiles, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: h.documents, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: h.erpConnected, loadOptions: h.loadItems }) }));

import TimeAndMaterials from './TimeAndMaterials';

const rate = {
  id: 'rate-row-1', project_id: 'p1', line_key: 'labour-1', kind: 'labour', label: 'Site engineer', unit: 'hour',
  rate: 50000, currency: 'IDR', effective_from: '2026-11-01', effective_to: null, is_current: true, version: 1,
};
const assignment = {
  id: 'assignment-1', project_id: 'p1', line_key: 'labour-1', user_id: 'u-engineer',
  effective_from: '2026-11-01', effective_to: null,
};
const claim = {
  id: 'claim-1', work_order_id: null, period_from: '2026-11-01', period_to: '2026-11-30', status: 'Draft',
  currency: 'IDR', gross_amount: 400000, prepared_by: 'u-pm', signoff_prepared_by: null, confirmed_by: null,
  confirm_basis: null, document_id: null, note: null, created_at: '2026-11-03T00:00:00Z',
  lines: [{ lineKey: 'labour-1', rateVersion: 1, kind: 'labour', basis: 'work', label: 'Site engineer', unit: 'hour', units: 8, rate: 50000, amount: 400000 }],
};
const profile = (id: string, full_name: string, status = 'active') => ({ id, full_name, status, role: 'Engineer' });
const documentRow = { id: 'doc-1', code: 'DOC-01', title: 'Approved timesheet summary', status: 'Approved', file_path: 'stored-file', revision: '1' };
const priced = {
  line_key: 'labour-1', rate_version: 1, kind: 'labour', basis: 'work', label: 'Site engineer', unit: 'hour', rate: 50000,
  user_id: 'u-engineer', units: 8, amount: 400000, source_count: 1, unrated_reason: null,
};
const unrated = {
  line_key: null, rate_version: null, kind: null, basis: 'work', label: null, unit: null, rate: null,
  user_id: 'u-other', units: 2, amount: null, source_count: 1, unrated_reason: 'no_rate',
};

const shipped = (locale: 'en' | 'id') => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${locale}/timeAndMaterials.json`), 'utf8')) as Record<string, unknown>;

function page(lng: 'en' | 'id' = 'en', resources: Record<string, { timeAndMaterials: Record<string, unknown> }> = { en: { timeAndMaterials: shipped('en') }, id: { timeAndMaterials: shipped('id') } }) {
  const instance = i18next.createInstance();
  void instance.init({ lng, fallbackLng: 'en', defaultNS: 'timeAndMaterials', ns: ['timeAndMaterials'], resources, interpolation: { escapeValue: false } });
  return instance;
}

function renderPanel(props: Partial<React.ComponentProps<typeof TimeAndMaterials>> = {}, lng: 'en' | 'id' = 'en') {
  const i18n = page(lng);
  const user = userEvent.setup();
  const result = render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ToastProvider><main><TimeAndMaterials projectId="p1" projectManagerId="u-pm" currency="IDR" onCreateInvoice={vi.fn()} canCreateInvoice={() => true} {...props} /></main></ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
  return { ...result, user };
}

beforeEach(() => {
  h.role = 'Finance';
  h.effectiveRole = 'Finance';
  h.userId = 'u-fin';
  h.rates = { data: { rows: [rate], truncated: false }, isPending: false, isError: false, refetch: vi.fn() };
  h.assignees = { data: { rows: [assignment], truncated: false }, isPending: false, isError: false, refetch: vi.fn() };
  h.claims = { data: { rows: [claim], truncated: false }, isPending: false, isError: false, refetch: vi.fn() };
  h.preview = { data: { rows: [priced, unrated], truncated: false }, isPending: false, isError: false, refetch: vi.fn() };
  h.sources = { data: { signoffCurrent: true, rows: [
    { id: 'source-row-1', entry_id: 'entry-1', entry_date: '2026-11-03', person_id: 'u-engineer', person_name: 'Engineer One', units: 5, unit: 'hour', line_label: 'Site engineer', is_selected: true, person_unit_total: 6 },
    { id: 'source-row-2', entry_id: 'entry-2', entry_date: '2026-11-04', person_id: 'u-engineer', person_name: 'Engineer One', units: 1, unit: 'hour', line_label: 'Site engineer', is_selected: true, person_unit_total: 6 },
    { id: 'source-row-3', entry_id: 'entry-3', entry_date: '2026-11-04', person_id: 'u-other', person_name: 'Engineer Two', units: 2, unit: 'hour', line_label: 'Site engineer', is_selected: true, person_unit_total: 2 },
  ], truncated: false, totalCount: 3 }, isPending: false, isError: false, refetch: vi.fn() };
  h.profiles = [profile('u-engineer', 'Site engineer'), profile('u-pm', 'Project manager'), profile('u-fin', 'Finance user')];
  h.documents = [documentRow];
  h.erpConnected = true;
  h.loadItems = vi.fn(async () => [{ value: 'ITEM-LABOUR', label: 'ITEM-LABOUR', sub: 'Site engineer' }]);
  h.mutations = {
    saveRate: vi.fn().mockResolvedValue({ id: 'rate-row-2', lineKey: 'labour-2', version: 1, changed: true }),
    assign: vi.fn().mockResolvedValue(undefined),
    endAssignee: vi.fn().mockResolvedValue(undefined),
    endRate: vi.fn().mockResolvedValue({ id: 'rate-row-1', lineKey: 'labour-1', version: 2, changed: true }),
    assemble: vi.fn().mockResolvedValue('claim-2'),
    deselect: vi.fn().mockResolvedValue(undefined),
    prepare: vi.fn().mockResolvedValue(undefined),
    withdraw: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue({ claimId: 'claim-1', basis: 'standard', grossAmount: 400000 }),
  };
});

describe('TimeAndMaterials', () => {
  it('ships complete English and Indonesian catalogues for the screen', () => {
    const read = (locale: 'en' | 'id') => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${locale}/timeAndMaterials.json`), 'utf8')) as Record<string, unknown>;
    const flatten = (value: Record<string, unknown>, prefix = ''): string[] => Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof child === 'string' ? [path] : flatten(child as Record<string, unknown>, path);
    }).sort();
    const en = read('en');
    const id = read('id');
    expect(flatten(en)).not.toHaveLength(0);
    expect(flatten(id)).toEqual(flatten(en));
    expect([...Object.values(en), ...Object.values(id)].every(Boolean)).toBe(true);
  });

  it('AC-TM-016 saves a rate, assigns a person, previews rated and unrated hours, assembles, and drills into claim sources', async () => {
    const { user } = renderPanel();
    expect((await screen.findAllByText('Site engineer')).length).toBeGreaterThan(0);
    expect(screen.getByText(/No rate/)).toBeInTheDocument();

    screen.getByRole('button', { name: /Add rate/ }).focus();
    await user.keyboard('{Enter}');
    const rateDialog = screen.getByRole('dialog', { name: /Add labour rate/ });
    await user.type(within(rateDialog).getByLabelText(/Role or work description/), 'Field technician');
    await user.type(within(rateDialog).getByLabelText(/Rate per hour/), '75000');
    await user.click(within(rateDialog).getByRole('button', { name: /Save rate/ }));
    await waitFor(() => expect(h.mutations.saveRate).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'p1', kind: 'labour', label: 'Field technician', unit: 'hour', rate: 75000, currency: 'IDR',
    })));

    await user.click(screen.getByRole('button', { name: /Assign person/ }));
    const assignDialog = screen.getByRole('dialog', { name: /Assign a person to a rate/ });
    await user.selectOptions(within(assignDialog).getByLabelText(/Rate line/), 'labour-1');
    await user.click(within(assignDialog).getByRole('combobox', { name: 'Person' }));
    await user.click(await screen.findByRole('option', { name: 'Site engineer' }));
    await user.click(within(assignDialog).getByRole('button', { name: /Assign person/ }));
    await waitFor(() => expect(h.mutations.assign).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', lineKey: 'labour-1', userId: 'u-engineer' })));

    expect(screen.getByText(/Unrated hours/)).toBeInTheDocument();
    expect(screen.getByText(/No rate applies/)).toBeInTheDocument();
    h.sources = { ...h.sources, data: { rows: [{
      id: 'source-row-1', entry_id: 'entry-1', entry_date: '2026-11-03', person_id: 'u-engineer', person_name: 'Engineer One',
      units: 8, unit: 'hour', line_label: 'Site engineer', is_selected: true, person_unit_total: 8,
    }], truncated: true, totalCount: 2, signoffCurrent: true } };
    await user.click(screen.getByRole('button', { name: /Assemble claim/ }));
    await waitFor(() => expect(h.mutations.assemble).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', from: expect.any(String), to: expect.any(String) })));

    await user.click(screen.getByRole('button', { name: /Open claim/ }));
    expect(await screen.findByRole('dialog', { name: /Time-and-materials claim/ })).toHaveTextContent('400,000');
    expect(screen.getByText(/Approved source entries/)).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2 source entries.')).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('proposes an exact item name first and accepts only the one unambiguous proposal', async () => {
    const unmatched = { ...rate, id: 'rate-row-2', line_key: 'labour-2', label: 'Survey crew', version: 3 };
    h.rates = { ...h.rates, data: { rows: [rate, unmatched], truncated: false } };
    h.loadItems = vi.fn(async () => [
      { value: 'ITEM-EXACT', label: 'ITEM-EXACT', sub: 'Site engineer' },
      { value: 'ITEM-NEAR', label: 'ITEM-NEAR', sub: 'SITE-ENGINEER' },
    ]);
    const { user } = renderPanel();

    const accept = await screen.findByRole('button', { name: 'Accept proposed (1)' });
    await user.click(accept);

    await waitFor(() => expect(h.mutations.saveRate).toHaveBeenCalledTimes(1));
    expect(h.mutations.saveRate).toHaveBeenCalledWith([expect.objectContaining({
      project_id: 'p1', line_key: 'labour-1', expected_version: 1, sales_item_code: 'ITEM-EXACT',
    })]);
    expect(h.mutations.saveRate.mock.calls[0]?.[0]).not.toEqual(expect.arrayContaining([expect.objectContaining({ line_key: 'labour-2' })]));
  });

  it('proposes a unique normalized item name when no exact name matches', async () => {
    h.loadItems = vi.fn(async () => [{ value: 'ITEM-NORMALIZED', label: 'ITEM-NORMALIZED', sub: 'SITE-ENGINEER' }]);
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Accept proposed (1)' }));
    await waitFor(() => expect(h.mutations.saveRate).toHaveBeenCalledWith([expect.objectContaining({
      line_key: 'labour-1', sales_item_code: 'ITEM-NORMALIZED',
    })]));
  });

  it('leaves a rate line unmapped when its normalized item name is ambiguous', async () => {
    h.loadItems = vi.fn(async () => [
      { value: 'ITEM-A', label: 'ITEM-A', sub: 'Site-engineer' },
      { value: 'ITEM-B', label: 'ITEM-B', sub: 'site engineer.' },
    ]);
    renderPanel();
    expect(await screen.findByText('Not mapped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept proposed/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Sales item for Site engineer/ })).toBeInTheDocument();
  });

  it('hides rate-line ERP mappings when the organization has no connected ERP', () => {
    h.erpConnected = false;
    h.rates = { ...h.rates, data: { rows: [rate, { ...rate, id: 'rate-row-2', line_key: 'labour-2', label: 'Field technician', sales_item_code: 'ITEM-SAVED' }], truncated: false } };

    renderPanel();

    expect(screen.queryByText('Not mapped')).not.toBeInTheDocument();
    expect(screen.queryByText('ITEM-SAVED')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Sales item for/ })).not.toBeInTheDocument();
    expect(h.loadItems).not.toHaveBeenCalled();
  });

  it('does not render an empty proposal panel when no ERP item matches', async () => {
    h.loadItems = vi.fn(async () => [{ value: 'ITEM-OTHER', label: 'ITEM-OTHER', sub: 'Electrical work' }]);
    const { container } = renderPanel();

    await waitFor(() => expect(h.loadItems).toHaveBeenCalledOnce());

    expect(screen.queryByText(/clear sales item match/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept proposed/ })).not.toBeInTheDocument();
    expect(container.querySelector('[class*="bg-secondary/40"]')).toBeNull();
  });

  it('shows saved item codes and keeps the picker read-only for viewers and impersonation', async () => {
    h.effectiveRole = 'Project Manager';
    h.rates = { ...h.rates, data: { rows: [{ ...rate, sales_item_code: 'ITEM-SAVED' }], truncated: false } };
    renderPanel();
    expect(await screen.findByText('ITEM-SAVED')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Sales item for Site engineer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept proposed/ })).not.toBeInTheDocument();
  });

  it('lets a rate manager change a saved ERP sales item from the rate card', async () => {
    h.rates = { ...h.rates, data: { rows: [{ ...rate, sales_item_code: 'ITEM-SAVED' }], truncated: false } };
    h.loadItems = vi.fn(async () => [
      { value: 'ITEM-SAVED', label: 'ITEM-SAVED', sub: 'Saved item' },
      { value: 'ITEM-NEW', label: 'ITEM-NEW', sub: 'Replacement item' },
    ]);
    const { user } = renderPanel();
    await user.click(await screen.findByRole('combobox', { name: 'Sales item for Site engineer' }));
    await user.click(await screen.findByRole('option', { name: /ITEM-NEW/ }));
    await waitFor(() => expect(h.mutations.saveRate).toHaveBeenCalledWith([expect.objectContaining({
      line_key: 'labour-1', sales_item_code: 'ITEM-NEW',
    })]));
  });

  it('AC-TM-016 shows source hours that add up to a multi-entry claim', async () => {
    const multiLineClaim = {
      ...claim,
      gross_amount: 2758,
      lines: [
        { lineKey: 'labour-1', rateVersion: 1, kind: 'labour', label: 'Site engineer', unit: 'hour', units: 32, rate: 85, amount: 2720 },
        { lineKey: 'labour-2', rateVersion: 1, kind: 'labour', label: 'Electrician', unit: 'hour', units: 1, rate: 38, amount: 38 },
      ],
    };
    h.claims = { ...h.claims, data: { rows: [multiLineClaim], truncated: false } };
    h.sources = {
      ...h.sources,
      data: { signoffCurrent: true, rows: [
        { id: 'source-row-1', entry_id: 'entry-1', entry_date: '2026-11-01', person_id: 'u-engineer', person_name: 'Engineer One', units: 8, unit: 'hour', line_label: 'Site engineer', is_selected: true, person_unit_total: 32 },
        { id: 'source-row-2', entry_id: 'entry-2', entry_date: '2026-11-02', person_id: 'u-engineer', person_name: 'Engineer One', units: 4, unit: 'hour', line_label: 'Site engineer', is_selected: true, person_unit_total: 32 },
        { id: 'source-row-3', entry_id: 'entry-3', entry_date: '2026-11-03', person_id: 'u-engineer', person_name: 'Engineer One', units: 20, unit: 'hour', line_label: 'Site engineer', is_selected: true, person_unit_total: 32 },
        { id: 'source-row-4', entry_id: 'entry-4', entry_date: '2026-11-04', person_id: 'u-other', person_name: 'Engineer Two', units: 1, unit: 'hour', line_label: 'Electrician', is_selected: true, person_unit_total: 1 },
      ], truncated: false, totalCount: 4 },
    };

    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: /Open claim/ }));
    const sources = screen.getByRole('region', { name: /Approved source entries/ });
    const displayedHours = within(sources).getAllByText(/Nov \d+, 2026 · \d+ hours?/)
      .reduce((sum, element) => sum + Number(element.textContent?.match(/· (\d+)/)?.[1] ?? 0), 0);

    expect(displayedHours).toBe(33);
  });

  it('AC-TM-016 names the visible and total source counts when the source read is capped', async () => {
    h.sources = {
      ...h.sources,
      data: { signoffCurrent: true, rows: Array.from({ length: 200 }, (_, index) => ({
        id: `source-row-${index}`,
        entry_id: `entry-${index}`,
        entry_date: '2026-11-03',
        person_id: 'u-engineer',
        person_name: 'Engineer One',
        units: 1,
        unit: 'hour',
        line_label: 'Site engineer',
        is_selected: true,
        person_unit_total: 237,
      })), truncated: true, totalCount: 237 },
    };

    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: /Open claim/ }));

    expect(await screen.findByText('Showing 200 of 237 source entries.')).toBeInTheDocument();
  });

  it('AC-TM-016 opens the claim without a success toast covering its shared Close control', async () => {
    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: /Assemble claim/ }));
    expect(await screen.findByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Open claim/ }));

    const drawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).not.toBeInTheDocument();
    expect(within(drawer).getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: /Time-and-materials claim/ })).not.toBeInTheDocument();
  });

  it('AC-TM-016 lets a PM prepare sign-off, blocks the preparer, then opens the existing invoice flow for a second user', async () => {
    const { user, rerender } = renderPanel();
    h.role = 'Project Manager';
    h.effectiveRole = 'Project Manager';
    h.userId = 'u-pm';
    rerender(
      <I18nextProvider i18n={page()}>
        <MemoryRouter><ToastProvider><main><TimeAndMaterials projectId="p1" projectManagerId="u-pm" currency="IDR" onCreateInvoice={vi.fn()} canCreateInvoice={() => true} /></main></ToastProvider></MemoryRouter>
      </I18nextProvider>,
    );
    await user.click(await screen.findByRole('button', { name: /Prepare sign-off/ }));
    const prepareDialog = screen.getByRole('dialog', { name: /Prepare client sign-off/ });
    await user.selectOptions(within(prepareDialog).getByLabelText(/Evidence document/), 'doc-1');
    await user.click(within(prepareDialog).getByRole('button', { name: /Prepare sign-off/ }));
    await waitFor(() => expect(h.mutations.prepare).toHaveBeenCalledWith({ claimId: 'claim-1', documentId: 'doc-1', note: null }));

    h.claims = { ...h.claims, data: { rows: [{ ...claim, signoff_prepared_by: 'u-pm', document_id: 'doc-1' }], truncated: false } };
    rerender(
      <I18nextProvider i18n={page()}>
        <MemoryRouter><ToastProvider><main><TimeAndMaterials projectId="p1" projectManagerId="u-pm" currency="IDR" onCreateInvoice={vi.fn()} canCreateInvoice={() => true} /></main></ToastProvider></MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.queryByRole('button', { name: /Confirm sign-off/ })).not.toBeInTheDocument();

    const createInvoice = vi.fn();
    h.role = 'Finance';
    h.effectiveRole = 'Finance';
    h.userId = 'u-fin';
    rerender(
      <I18nextProvider i18n={page()}>
        <MemoryRouter><ToastProvider><main><TimeAndMaterials projectId="p1" projectManagerId="u-pm" currency="IDR" onCreateInvoice={createInvoice} canCreateInvoice={() => true} /></main></ToastProvider></MemoryRouter>
      </I18nextProvider>,
    );
    const claims = await screen.findByRole('region', { name: /Time-and-materials claims/ });
    expect(within(claims).queryByRole('button', { name: /Confirm sign-off/ })).not.toBeInTheDocument();
    await user.click(within(claims).getByRole('button', { name: /Open claim/ }));
    const claimDrawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    await user.click(within(claimDrawer).getByRole('button', { name: /Confirm sign-off/ }));
    const confirmDialog = screen.getByRole('dialog', { name: /Confirm client sign-off/ });
    await user.click(within(confirmDialog).getByRole('button', { name: /Confirm sign-off/ }));
    await waitFor(() => expect(h.mutations.confirm).toHaveBeenCalledWith('claim-1'));
    h.claims = { ...h.claims, data: { rows: [{ ...claim, status: 'SignedOff', signoff_prepared_by: 'u-pm', document_id: 'doc-1' }], truncated: false } };
    rerender(
      <I18nextProvider i18n={page()}>
        <MemoryRouter><ToastProvider><TimeAndMaterials projectId="p1" projectManagerId="u-pm" currency="IDR" onCreateInvoice={createInvoice} canCreateInvoice={() => true} /></ToastProvider></MemoryRouter>
      </I18nextProvider>,
    );
    await user.click(screen.getByRole('button', { name: /Create invoice/ }));
    expect(createInvoice).toHaveBeenCalledWith('claim-1');
  });

  it('AC-TM-016 hides write actions in view-as mode and confirms a sign-off withdrawal', async () => {
    h.effectiveRole = 'Project Manager';
    renderPanel();
    expect(screen.queryByRole('button', { name: /Add rate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assemble claim/ })).not.toBeInTheDocument();

    h.effectiveRole = 'Finance';
    h.claims = { ...h.claims, data: { rows: [{ ...claim, signoff_prepared_by: 'u-pm', document_id: 'doc-1' }], truncated: false } };
    const { user: financeUser } = renderPanel();
    await financeUser.click(await screen.findByRole('button', { name: /Withdraw sign-off/ }));
    const dialog = screen.getByRole('alertdialog', { name: /Withdraw client sign-off/ });
    await financeUser.click(within(dialog).getByRole('button', { name: /Withdraw sign-off/ }));
    await waitFor(() => expect(h.mutations.withdraw).toHaveBeenCalledWith('claim-1'));
  });

  it('shows loading, empty, and retry states for rates and claims', async () => {
    h.rates = { ...h.rates, data: undefined as never, isPending: true };
    h.claims = { ...h.claims, data: undefined as never, isPending: true };
    const pending = renderPanel();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    pending.unmount();

    h.rates = { data: { rows: [], truncated: false }, isPending: false, isError: false, refetch: vi.fn() };
    h.claims = { data: { rows: [], truncated: false }, isPending: false, isError: false, refetch: vi.fn() };
    renderPanel();
    expect(screen.getByText(/No labour rates yet/)).toBeInTheDocument();
    expect(screen.getByText(/No time-and-materials claims yet/)).toBeInTheDocument();
  });

  it('shows local retry controls when a rate or claim read fails', async () => {
    const retryRates = vi.fn();
    const retryClaims = vi.fn();
    h.rates = { ...h.rates, isError: true, isPending: false, refetch: retryRates };
    h.claims = { ...h.claims, isError: true, isPending: false, refetch: retryClaims };
    const { user } = renderPanel();
    expect(screen.getByText(/Couldn't load the rate card/)).toBeInTheDocument();
    expect(screen.getByText(/Couldn't load time-and-materials claims/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Retry/ })[0]);
    expect(retryRates).toHaveBeenCalled();
  });

  it('disables assembly when the money preview is truncated', () => {
    h.preview = { ...h.preview, data: { rows: [priced], truncated: true } };
    renderPanel();
    expect(screen.getByText(/Narrow the period to assemble/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Assemble claim/ })).toBeDisabled();
  });

  it('names counts and units in plain singular/plural language', async () => {
    h.preview = { ...h.preview, data: { rows: [priced, unrated], truncated: false } };
    renderPanel();
    expect(await screen.findByText(/8 hours/)).toBeInTheDocument();
    expect(screen.getByText(/1 line$/)).toBeInTheDocument();
    expect(screen.getByText(/1 approved entry/)).toBeInTheDocument();
    expect(screen.queryByText(/1 lines/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1 approved entries/)).not.toBeInTheDocument();
  });

  it('shows the claim total before assembling so the user knows what will be created', async () => {
    renderPanel();
    const assemble = await screen.findByRole('region', { name: /Assemble a claim/ });
    expect(within(assemble).getByText(/Claim total/)).toBeInTheDocument();
    expect(within(assemble).getAllByText(/400,000/).length).toBeGreaterThan(0);
  });

  it('says a prepared claim is waiting for confirmation, and tells the preparer why they cannot confirm', async () => {
    h.claims = { ...h.claims, data: { rows: [{ ...claim, signoff_prepared_by: 'u-pm', document_id: 'doc-1' }], truncated: false } };
    h.role = 'Project Manager';
    h.effectiveRole = 'Project Manager';
    h.userId = 'u-pm';
    renderPanel();
    const claims = await screen.findByRole('region', { name: /Time-and-materials claims/ });
    expect(within(claims).getByText('Awaiting confirmation')).toBeInTheDocument();
    expect(within(claims).queryByText('Draft')).not.toBeInTheDocument();
    expect(within(claims).getByText(/different user must confirm/i)).toBeInTheDocument();
    expect(within(claims).queryByRole('button', { name: /Confirm sign-off/ })).not.toBeInTheDocument();
  });

  it('shows each approved source by person and date, with subtotals that close to the claim units', async () => {
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: /Open claim/ }));
    const drawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    expect(drawer).not.toHaveTextContent(/frozen|rate version/i);
    expect(drawer).toHaveTextContent('Claim lines');
    expect(drawer).toHaveTextContent('8 hours');
    expect(within(drawer).getByRole('heading', { name: 'Engineer One' })).toBeInTheDocument();
    expect(within(drawer).getByRole('heading', { name: 'Engineer Two' })).toBeInTheDocument();
    expect(within(drawer).getByText(/Nov 3, 2026/)).toBeInTheDocument();
    expect(within(drawer).getAllByText(/Nov 4, 2026/)).toHaveLength(2);
    expect(within(drawer).getByText('Subtotal · 6 hours')).toBeInTheDocument();
    expect(within(drawer).getByText('Subtotal · 2 hours')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Site engineer')).toHaveLength(4);
  });

  it('lets a preparer remove one draft source only after confirming the removal', async () => {
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: /Open claim/ }));
    const drawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    const remove = within(drawer).getByRole('button', { name: /Remove 5 hours for Engineer One/ });
    expect(remove).toHaveTextContent(/^Remove$/);
    await user.click(remove);
    const confirmation = screen.getByRole('alertdialog', { name: /Remove approved hours/ });
    expect(h.mutations.deselect).not.toHaveBeenCalled();
    expect(confirmation).toHaveTextContent('Nov 3, 2026');
    await user.click(within(confirmation).getByRole('button', { name: /^Remove$/ }));
    await waitFor(() => expect(h.mutations.deselect).toHaveBeenCalledWith({ claimId: 'claim-1', claimSourceId: 'source-row-1' }));
  });

  it('keeps the visible remove label inside its accessible name in Indonesian', async () => {
    const { user } = renderPanel({}, 'id');
    await user.click(await screen.findByRole('button', { name: /Buka klaim/ }));
    const drawer = await screen.findByRole('dialog', { name: /Klaim waktu dan material/ });
    const remove = within(drawer).getByRole('button', { name: /Hapus 5 jam/ });
    expect(remove).toHaveTextContent(/^Hapus$/);
  });

  it('does not offer confirmation when the prepared sign-off no longer matches the claim', async () => {
    h.claims = { ...h.claims, data: { rows: [{ ...claim, signoff_prepared_by: 'u-pm', document_id: 'doc-1' }], truncated: false } };
    h.sources = { ...h.sources, data: { ...h.sources.data, signoffCurrent: false } };
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: /Open claim/ }));
    const drawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    expect(screen.queryByRole('button', { name: /Confirm sign-off/ })).not.toBeInTheDocument();
    expect(within(drawer).getByText(/changed after the sign-off was prepared/i)).toBeInTheDocument();
  });

  it('allows the project manager to remove a draft source', async () => {
    h.role = 'Project Manager';
    h.effectiveRole = 'Project Manager';
    h.userId = 'u-pm';
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: /Open claim/ }));
    const drawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    expect(within(drawer).getByRole('button', { name: /Remove 5 hours for Engineer One/ })).toBeInTheDocument();
  });

  it('shows a way to prepare the sign-off again after a draft source changes', async () => {
    h.claims = { ...h.claims, data: { rows: [{ ...claim, signoff_prepared_by: 'u-pm', document_id: 'doc-1' }], truncated: false } };
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: /Open claim/ }));
    const drawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    await user.click(within(drawer).getByRole('button', { name: /Prepare sign-off again/ }));
    const dialog = await screen.findByRole('dialog', { name: /Update client sign-off/ });
    await user.selectOptions(within(dialog).getByLabelText(/Evidence document/), 'doc-1');
    await user.click(within(dialog).getByRole('button', { name: /Prepare sign-off again/ }));
    await waitFor(() => expect(h.mutations.prepare).toHaveBeenCalledWith({ claimId: 'claim-1', documentId: 'doc-1', note: null }));
  });

  it('keeps a released source visible without offering another deselect action', async () => {
    const firstSource = h.sources.data.rows[0] as Record<string, unknown>;
    h.sources = {
      ...h.sources,
      data: { ...h.sources.data, rows: [{ ...firstSource, is_selected: false, person_unit_total: 0 }], truncated: false, totalCount: 1 },
    };
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: /Open claim/ }));
    const drawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    expect(within(drawer).getByText('Not selected')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /Remove .* for Engineer One/ })).not.toBeInTheDocument();
  });

  it('explains released hours once on a withdrawn claim without a zero subtotal', async () => {
    h.claims = { ...h.claims, data: { rows: [{ ...claim, status: 'Withdrawn' }], truncated: false } };
    h.sources = {
      ...h.sources,
      data: { ...h.sources.data, rows: h.sources.data.rows.map((source) => ({ ...(source as Record<string, unknown>), is_selected: false, person_unit_total: 0 })) },
    };
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: /Open claim/ }));
    const drawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    expect(within(drawer).getAllByText('Released when the claim was withdrawn')).toHaveLength(1);
    expect(within(drawer).queryByText('Not selected')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('Subtotal · 0 hours')).not.toBeInTheDocument();
    expect(within(drawer).getByText('Nov 3, 2026 · 5 hours')).toBeInTheDocument();
  });

  it('hides source removal after sign-off and while viewing through impersonation', async () => {
    h.claims = { ...h.claims, data: { rows: [{ ...claim, status: 'SignedOff', signoff_prepared_by: 'u-pm', document_id: 'doc-1' }], truncated: false } };
    const signedOff = renderPanel();
    await signedOff.user.click(await screen.findByRole('button', { name: /Open claim/ }));
    let drawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    expect(within(drawer).queryByRole('button', { name: /Remove .* for Engineer/ })).not.toBeInTheDocument();
    signedOff.unmount();

    h.claims = { ...h.claims, data: { rows: [claim], truncated: false } };
    h.effectiveRole = 'Project Manager';
    const impersonated = renderPanel();
    await impersonated.user.click(await screen.findByRole('button', { name: /Open claim/ }));
    drawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    expect(within(drawer).queryByRole('button', { name: /Remove .* for Engineer/ })).not.toBeInTheDocument();
  });

  it('defaults the assemble period to the local calendar date, not UTC', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'Asia/Jakarta';
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-03T20:00:00Z') });
    try {
      renderPanel();
      expect(await screen.findByLabelText('To')).toHaveValue('2026-11-04');
      expect(screen.getByLabelText('From')).toHaveValue('2026-11-01');
    } finally {
      vi.useRealTimers();
      if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz;
    }
  });

  it('lets Finance undo a wrong assignment after a confirmation, and shows people who are no longer active', async () => {
    h.profiles = [profile('u-pm', 'Project manager'), profile('u-fin', 'Finance user')];
    const { user } = renderPanel();
    expect((await screen.findAllByText(/Person no longer active/)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /Remove .* from Site engineer/ }));
    const dialog = screen.getByRole('alertdialog', { name: /Remove this assignment/ });
    expect(h.mutations.endAssignee).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /^Remove/ }));
    await waitFor(() => expect(h.mutations.endAssignee).toHaveBeenCalledWith({ projectId: 'p1', assigneeId: 'assignment-1', effectiveTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });

  it('lets Finance end a rate after a confirmation, and shows an ended rate as ended', async () => {
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: /End rate/ }));
    const dialog = screen.getByRole('alertdialog', { name: /End this rate/ });
    expect(h.mutations.endRate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /End rate/ }));
    await waitFor(() => expect(h.mutations.endRate).toHaveBeenCalledWith({ projectId: 'p1', lineKey: 'labour-1', expectedVersion: 1, effectiveTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });

  it('marks an ended rate and hides its edit and end actions', async () => {
    h.rates = { ...h.rates, data: { rows: [{ ...rate, effective_to: '2026-10-31' }], truncated: false } };
    renderPanel();
    expect(await screen.findByText(/Ended/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /End rate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit rate/ })).not.toBeInTheDocument();
  });

  it('keeps remove and end actions away from people who cannot manage rates', async () => {
    h.role = 'Project Manager';
    h.effectiveRole = 'Project Manager';
    h.userId = 'u-pm';
    renderPanel();
    expect(await screen.findByText('Rate card')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /End rate|Remove/ })).not.toBeInTheDocument();
  });

  it('renders nothing for a read-only viewer when the project has no rates and no claims', async () => {
    h.role = 'Executive';
    h.effectiveRole = 'Executive';
    h.userId = 'u-exec';
    h.rates = { ...h.rates, data: { rows: [], truncated: false } };
    h.claims = { ...h.claims, data: { rows: [], truncated: false } };
    const { container } = renderPanel();
    expect(screen.queryByText('Rate card')).not.toBeInTheDocument();
    expect(container.querySelector('main')).toBeEmptyDOMElement();
  });

  it('says a rate has nobody assigned in a plain phrase', async () => {
    h.assignees = { ...h.assignees, data: { rows: [], truncated: false } };
    renderPanel();
    expect(await screen.findByText('Not assigned yet')).toBeInTheDocument();
    expect(screen.queryByText(/Assigned to/)).not.toBeInTheDocument();
  });

  it('shows one error, not two, when the rate card itself cannot load', async () => {
    h.rates = { ...h.rates, isError: true, isPending: false };
    h.assignees = { ...h.assignees, isError: true, isPending: false };
    renderPanel();
    expect(await screen.findByText(/Couldn't load the rate card/)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load rate assignments/)).not.toBeInTheDocument();
  });

  it('explains in the claim detail why a prepared claim is waiting', async () => {
    h.claims = { ...h.claims, data: { rows: [{ ...claim, signoff_prepared_by: 'u-pm', document_id: 'doc-1' }], truncated: false } };
    h.role = 'Project Manager';
    h.effectiveRole = 'Project Manager';
    h.userId = 'u-pm';
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: /Open claim/ }));
    const drawer = await screen.findByRole('dialog', { name: /Time-and-materials claim/ });
    expect(within(drawer).getByText('Awaiting confirmation')).toBeInTheDocument();
    expect(within(drawer).getByText(/different user must confirm/i)).toBeInTheDocument();
  });

  it('shows which invoice a signed-off claim already has instead of staying silent', async () => {
    h.claims = { ...h.claims, data: { rows: [{ ...claim, status: 'SignedOff', signoff_prepared_by: 'u-pm', document_id: 'doc-1' }], truncated: false } };
    renderPanel({ canCreateInvoice: () => false, invoiceNumberFor: () => 'INV-0042' });
    const claims = await screen.findByRole('region', { name: /Time-and-materials claims/ });
    expect(within(claims).getByText(/Invoiced · INV-0042/)).toBeInTheDocument();
    expect(within(claims).queryByRole('button', { name: /Create invoice/ })).not.toBeInTheDocument();
  });
});
