import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { can } from '@/src/auth/policy';
import i18n from '@/src/lib/i18n';
import ownerMaterialEn from '@/public/locales/en/ownerMaterial.json';
import ownerMaterialId from '@/public/locales/id/ownerMaterial.json';

/**
 * AC-008 (#3010): the work order's material stage table — figures as the server sent them (never totalled across units),
 * every state with retry that keeps the location and page, and the reconciliation step a Material Coordinator records.
 * AC-007's on-screen job is the Playwright journey; this file owns the render states.
 */
const h = vi.hoisted(() => ({
  role: 'Engineer' as string, jobRole: 'material_coordinator' as string | null, realRole: 'Engineer' as string,
  sections: null as unknown, lines: null as unknown, config: null as unknown,
  save: { mutateAsync: vi.fn(), isPending: false }, linesArgs: [] as unknown[][],
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (a: never, e: never, ctx?: object) => can(a, e, { realRole: h.role as never, builtInRoleKey: h.jobRole, ...ctx }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.role }) }));
vi.mock('@/src/hooks/useOwnerMaterial', () => ({
  useMaterialLines: (...a: unknown[]) => { h.linesArgs.push(a); return h.lines; },
  useMaterialConfig: () => h.config, useSectionStages: () => h.sections, useSetReconciliation: () => h.save,
}));

import { OwnerMaterialPipeline } from './OwnerMaterialPipeline';

const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const failed = (code?: string) => ({ data: undefined, isPending: false, isError: true, error: { code }, refetch: vi.fn() });
const line = (over: Record<string, unknown> = {}) => ({
  planId: 'p1', sectionId: 's1', itemId: 'i1', itemCode: 'X-1', itemName: 'Steel pipe', unit: 'm', categoryCode: 'PIPE', ownerCostCode: 'CC-9',
  planned: '100.000', requested: '40.500', setAside: '30.000', received: '10.000', issued: '6.000', returned: '1.000', transferIn: '0.000', transferOut: '2.000', ownerReturn: '0.000', closing: '3.000',
  requestedPct: '40.5', setAsidePct: '30', receivedPct: '10', issuedPct: '60', closingPct: '30', asOf: null, evidence: null, ...over,
});
const stage = (o: Record<string, unknown> = {}) => ({ sectionId: 's1', code: 'L1', name: 'North yard', ownerCostCode: 'CC-9', lineCount: 1, requestedPct: null, setAsidePct: null, receivedPct: null, issuedPct: null, closingPct: null, stepId: 'st1', step: 'Prepared', stepPct: '20.000', asOf: null, skippedSourceRows: 0, skippedReasonCodes: [], ...o });
const steps = [{ id: 'st1', name: 'Prepared', position: 1, percentage: '20.000' }, { id: 'st2', name: 'Checked', position: 2, percentage: '40.000' }];
const Where = () => <span data-testid="where">{useLocation().search}</span>;
const view = (search = '') => render(<MemoryRouter initialEntries={[`/work-orders/w1${search}`]}><OwnerMaterialPipeline workOrderId="w1" /><Where /></MemoryRouter>);

beforeEach(async () => {
  await i18n.changeLanguage('en');
  h.role = 'Engineer'; h.jobRole = 'material_coordinator'; h.realRole = 'Engineer';
  h.sections = ok([stage(), stage({ sectionId: 's2', code: 'L2', name: 'South yard', ownerCostCode: null, stepId: null, step: null, stepPct: null })]);
  h.lines = ok({ rows: [line()], total: 1 });
  h.config = ok({ steps, categories: [{ id: 'c1', code: 'PIPE', name: 'Piping' }] });
  h.save = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false };
  h.linesArgs = [];
});

describe('AC-008 OwnerMaterialPipeline', () => {
  it('shows every stage as the server sent it, with its percentage and unit, and the owner cost code', () => {
    view();
    const row = screen.getByTestId('om-row-p1');
    expect(within(row).getByText('Steel pipe')).toBeInTheDocument();
    expect(within(row).getByText('X-1 · m · Piping')).toBeInTheDocument();
    expect(within(row).getByTestId('om-requested')).toHaveTextContent('40.5');
    expect(within(row).getByTestId('om-requested')).toHaveTextContent('40.5%');
    expect(within(row).getByTestId('om-received')).toHaveTextContent('10%');
    expect(within(row).getByTestId('om-transferred')).toHaveTextContent('in 0');
    expect(within(row).getByTestId('om-transferred')).toHaveTextContent('out 2');
    expect(within(row).getByTestId('om-closing')).toHaveTextContent('3');
    expect(screen.getByTestId('om-cost-code')).toHaveTextContent('CC-9');
    expect(screen.getByRole('columnheader', { name: 'Owner set-aside' })).toBeInTheDocument();
  });

  it('names the category, and its code only when the organisation gave it no name', () => {
    h.lines = ok({ rows: [line({ planId: 'p2', categoryCode: 'ZZ9' })], total: 1 });
    view();
    expect(within(screen.getByTestId('om-row-p2')).getByText('X-1 · m · ZZ9')).toBeInTheDocument();
  });

  it('prints a location once when its code is its name (ignoring case and spaces), and both when they differ', () => {
    h.sections = ok([stage({ code: 'LOC_ALPHA', name: 'loc_alpha' }), stage({ sectionId: 's2', code: 'L2', name: 'South yard' })]);
    view();
    const options = within(screen.getByTestId('om-location')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['loc_alpha', 'L2 · South yard']);
  });

  it('a stage with no percentage reads as absent, never zero, and units are not totalled', () => {
    h.lines = ok({ rows: [line({ setAsidePct: null }), line({ planId: 'p2', unit: 'kg', itemName: 'Bolts' })], total: 2 });
    view();
    expect(within(screen.getByTestId('om-row-p1')).getByTestId('om-set-aside')).toHaveTextContent('—');
    expect(screen.queryByText(/total/i)).toBeNull();
  });

  it('shows the loaded position date once and each line\'s source evidence as plain labelled text', () => {
    h.lines = ok({ rows: [line({ asOf: '2026-11-01', evidence: { request_reference: 'REQ-7', reservations: [{ warehouse: 'W1', quantity: '5' }] } }), line({ planId: 'p2', asOf: '2026-11-01', evidence: null })], total: 2 });
    view();
    expect(screen.getAllByTestId('om-as-of')).toHaveLength(1);
    expect(screen.getByTestId('om-as-of')).toHaveTextContent(/Loaded position as of 1 Nov/);
    const ev = within(screen.getByTestId('om-row-p1')).getByTestId('om-evidence');
    expect(ev).toHaveTextContent('request reference');
    expect(ev).toHaveTextContent('REQ-7');
    expect(ev).toHaveTextContent('warehouse W1, quantity 5');
    expect(within(screen.getByTestId('om-row-p2')).queryByTestId('om-evidence')).toBeNull();
  });

  it('shows source evidence as literal text: markup and link-looking values create no element or link', () => {
    h.lines = ok({ rows: [line({ evidence: { note: '<b>bold</b> <a href="https://x.test">go</a> https://x.test/y' } })], total: 1 });
    view();
    const ev = within(screen.getByTestId('om-row-p1')).getByTestId('om-evidence');
    expect(ev).toHaveTextContent('<b>bold</b> <a href="https://x.test">go</a> https://x.test/y');
    expect(ev.querySelector('b')).toBeNull();
    expect(within(ev).queryByRole('link')).toBeNull();
  });

  it('AC-008 a location loaded with source rows skipped says how many, with the reasons in words (both languages); a clean one says nothing', async () => {
    i18n.addResourceBundle('en', 'ownerMaterial', ownerMaterialEn, true, true);
    h.sections = ok([stage({ skippedSourceRows: 6, skippedReasonCodes: ['field_length_exceeded', 'unknown_unit'] })]);
    view();
    expect(screen.getByTestId('om-skipped')).toHaveTextContent('6 source rows were not loaded');
    expect(screen.getByTestId('om-skipped-why')).toHaveTextContent('Field too long, unknown unit');
    cleanup();
    h.sections = ok([stage({ skippedSourceRows: 1, skippedReasonCodes: [] })]);
    view();
    expect(screen.getByTestId('om-skipped')).toHaveTextContent('1 source row was not loaded');
    expect(screen.queryByTestId('om-skipped-why')).toBeNull();
    cleanup();
    h.sections = ok([stage({ skippedSourceRows: 0, skippedReasonCodes: [] })]);
    view();
    expect(screen.queryByTestId('om-skipped')).toBeNull();
    cleanup();
    i18n.addResourceBundle('id', 'ownerMaterial', ownerMaterialId, true, true);
    await i18n.changeLanguage('id');
    h.sections = ok([stage({ skippedSourceRows: 6, skippedReasonCodes: ['field_length_exceeded'] })]);
    view();
    expect(screen.getByTestId('om-skipped')).toHaveTextContent('6 baris sumber tidak dimuat');
    expect(screen.getByTestId('om-skipped-why')).toHaveTextContent('Isian terlalu panjang');
  });

  it('AC-008 owner return shows with Returned only when it is non-zero', () => {
    h.lines = ok({ rows: [line({ ownerReturn: '2.500' }), line({ planId: 'p2', ownerReturn: '0.000' })], total: 2 });
    view();
    expect(within(screen.getByTestId('om-row-p1')).getByTestId('om-returned-note')).toHaveTextContent('returned to owner 2.5');
    expect(within(screen.getByTestId('om-row-p2')).queryByTestId('om-returned-note')).toBeNull();
  });

  it('AC-008 a stage above the planned quantity carries an over-plan marker beside its capped percentage; others do not', () => {
    h.lines = ok({ rows: [line({ received: '120.000', receivedPct: '100' }), line({ planId: 'p2', received: '100.000', receivedPct: '100' })], total: 2 });
    view();
    const first = screen.getByTestId('om-row-p1');
    expect(within(within(first).getByTestId('om-received')).getByTestId('om-over')).toHaveTextContent('over plan');
    expect(within(first).getAllByTestId('om-over')).toHaveLength(1);
    expect(within(screen.getByTestId('om-row-p2')).queryByTestId('om-over')).toBeNull();
  });

  it('shows no loaded-position line when no row has an opening', () => {
    view();
    expect(screen.queryByTestId('om-as-of')).toBeNull();
  });

  it('a transfer that moved nothing reads 0; on a phone each item is a card with the same figures', () => {
    h.lines = ok({ rows: [line({ transferOut: '0.000' })], total: 1 });
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      view();
      expect(screen.queryByTestId('om-table')).toBeNull();
      const row = screen.getByTestId('om-row-p1');
      expect(within(row).getByTestId('om-transferred')).toHaveTextContent(/^0$/);
      expect(within(row).getByTestId('om-received')).toHaveTextContent('10');
      expect(within(row).getByTestId('om-received')).toHaveTextContent('10%');
    } finally { window.matchMedia = mm; }
  });

  it('reads the first location, and picking another puts it in the address and back on page 1', async () => {
    h.lines = ok({ rows: [line()], total: 300 });
    view('?mpage=3');
    expect(h.linesArgs.at(-1)).toEqual(['w1', 's1', 3]);
    await userEvent.selectOptions(screen.getByLabelText('Location'), 's2');
    expect(screen.getByTestId('where')).toHaveTextContent('section=s2');
    expect(screen.getByTestId('where')).not.toHaveTextContent('mpage');
  });

  it('pages on the server: Next puts the page in the address', async () => {
    h.lines = ok({ rows: [line()], total: 120 });
    view();
    expect(screen.getByText(/Showing 1–1 of 120/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByTestId('where')).toHaveTextContent('mpage=2');
  });

  it('loading shows a placeholder, empty says what is absent, a failed read retries', async () => {
    h.lines = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const a = view();
    expect(a.container.querySelector('[aria-busy="true"], [role="status"]')).not.toBeNull();
    a.unmount();
    h.lines = ok({ rows: [], total: 0 });
    const b = view();
    expect(screen.getByTestId('om-empty')).toHaveTextContent('No material is planned for this location.');
    b.unmount();
    const f = failed('XX000'); h.lines = f;
    view();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(f.refetch).toHaveBeenCalled();
  });

  it('a denied read says so and offers no retry', () => {
    h.lines = failed('42501');
    view();
    expect(screen.getByTestId('om-denied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry|try again/i })).toBeNull();
  });

  it('a work order with no location shows nothing', () => {
    h.sections = ok([]);
    expect(view().container.querySelector('[data-testid="owner-material-pipeline"]')).toBeNull();
  });

  it('the Material Coordinator records the next step for the chosen location', async () => {
    view();
    expect(screen.getByTestId('om-step')).toHaveTextContent('Prepared · 20%');
    await userEvent.selectOptions(screen.getByTestId('om-step-select'), 'st2');
    await userEvent.click(screen.getByRole('button', { name: 'Record step' }));
    expect(h.save.mutateAsync).toHaveBeenCalledWith({ sectionId: 's1', stepId: 'st2', reason: null });
  });

  it('moving a step back asks for a reason first and sends it', async () => {
    h.sections = ok([stage({ stepId: 'st2', step: 'Checked', stepPct: '40' })]);
    view();
    await userEvent.selectOptions(screen.getByTestId('om-step-select'), 'st1');
    expect(screen.getByRole('button', { name: 'Record step' })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('Why it moves back'), 'owner reopened it');
    await userEvent.click(screen.getByRole('button', { name: 'Record step' }));
    expect(h.save.mutateAsync).toHaveBeenCalledWith({ sectionId: 's1', stepId: 'st1', reason: 'owner reopened it' });
  });

  it('a refused save shows its reason and keeps the form', async () => {
    h.save.mutateAsync = vi.fn().mockRejectedValue(Object.assign(new Error('not allowed'), { code: '42501' }));
    view();
    await userEvent.selectOptions(screen.getByTestId('om-step-select'), 'st2');
    await userEvent.click(screen.getByRole('button', { name: 'Record step' }));
    expect(await screen.findByTestId('om-save-error')).toBeInTheDocument();
    expect(screen.getByTestId('om-step-select')).toHaveValue('st2');
  });

  it('an ordinary reader sees the step but no form, and view-as is read-only', () => {
    h.jobRole = null;
    const a = view();
    expect(screen.getByTestId('om-step')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record step' })).toBeNull();
    a.unmount();
    h.jobRole = 'material_coordinator'; h.realRole = 'Admin';
    view();
    expect(screen.queryByRole('button', { name: 'Record step' })).toBeNull();
  });

  it('shows the organisation language', async () => {
    i18n.addResourceBundle('id', 'ownerMaterial', ownerMaterialId, true, true);
    await i18n.changeLanguage('id');
    view();
    expect(screen.getByRole('columnheader', { name: ownerMaterialId.col.closing })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
