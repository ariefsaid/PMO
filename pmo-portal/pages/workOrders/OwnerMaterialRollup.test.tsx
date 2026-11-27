import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import i18n from '@/src/lib/i18n';
import ownerMaterialId from '@/public/locales/id/ownerMaterial.json';

/** AC-008 (supplementary, #3010): the Work Orders Materials view — one page request, the server's percentages, location drilldown, every state. */
const h = vi.hoisted(() => ({
  choices: null as unknown, numbers: null as unknown, rollup: null as unknown, sections: null as unknown, rollupArgs: [] as unknown[][],
}));
vi.mock('@/src/hooks/useWorkOrderProjectChoices', () => ({ useWorkOrderProjectChoices: () => h.choices }));
vi.mock('@/src/hooks/useOwnerMaterial', () => ({
  useMaterialRollup: (...a: unknown[]) => { h.rollupArgs.push(a); return h.rollup; },
  useSectionStages: () => h.sections, useOrderNumbers: () => h.numbers,
}));
vi.mock('@/src/lib/i18n/terms', () => ({ useTerms: () => ({ clientWorkOrder: 'Work orders' }) }));

import { OwnerMaterialRollup } from './OwnerMaterialRollup';

const ok = (data: unknown) => ({ data, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() });
const failed = (code?: string) => ({ data: undefined, isPending: false, isError: true, isSuccess: false, error: { code }, refetch: vi.fn() });
const row = (over: Record<string, unknown> = {}) => ({
  workOrderId: 'w1', number: 'WO-1', title: 'Pipe work', sectionCount: 3, requestedPct: '50', setAsidePct: null, receivedPct: '25.5', issuedPct: '0', closingPct: '12.25',
  reconciliationStep: 'Checked', reconciliationPct: '40', unallocatedMovementCount: 0, partialSectionCount: 0, ...over,
});
const Where = () => <span data-testid="where">{useLocation().search}</span>;
const view = (search = '') => render(<MemoryRouter initialEntries={[`/work-orders${search}`]}><OwnerMaterialRollup /><Where /></MemoryRouter>);

beforeEach(async () => {
  await i18n.changeLanguage('en');
  h.choices = ok([{ value: 'pr1', label: 'Yard' }, { value: 'pr2', label: 'Plant' }]);
  h.rollup = ok({ rows: [row(), row({ workOrderId: 'w2', number: null, title: 'Untitled order', unallocatedMovementCount: 4, reconciliationStep: null, reconciliationPct: null })], total: 2 });
  h.sections = ok([
    { sectionId: 's1', code: 'L1', name: 'North yard', ownerCostCode: null, lineCount: 4, requestedPct: '70', setAsidePct: null, receivedPct: '33.5', issuedPct: '10', closingPct: '5', stepId: 'st1', step: 'Prepared', stepPct: '20', asOf: null, skippedSourceRows: 0, skippedReasonCodes: [] },
    { sectionId: 's2', code: 'L2', name: 'South yard', ownerCostCode: null, lineCount: 2, requestedPct: null, setAsidePct: null, receivedPct: null, issuedPct: null, closingPct: null, stepId: null, step: null, stepPct: null, asOf: null, skippedSourceRows: 0, skippedReasonCodes: [] },
  ]);
  h.numbers = ok([{ workOrderId: 'w1', clientPoNumber: 'PO-77', woNumber: 'WO-1' }, { workOrderId: 'w2', clientPoNumber: null, woNumber: null }]);
  h.rollupArgs = [];
});

describe('AC-008 OwnerMaterialRollup', () => {
  it('asks for one page of the project in the address and shows the server percentages, absent as a dash', () => {
    view('?project=pr1');
    expect(h.rollupArgs.at(-1)).toEqual(['pr1', 1]);
    const r = screen.getByTestId('omr-row-w1');
    expect(within(r).getByTestId('omr-requested')).toHaveTextContent('50%');
    expect(within(r).getByTestId('omr-set-aside')).toHaveTextContent('—');
    expect(within(r).getByTestId('omr-received')).toHaveTextContent('25.5%');
    expect(within(r).getByTestId('omr-closing')).toHaveTextContent('12.25%');
    expect(within(r).getByTestId('omr-step')).toHaveTextContent('Checked · 40%');
    expect(within(r).getByTestId('omr-sections')).toHaveTextContent('3');
    expect(within(screen.getByTestId('omr-row-w2')).getByTestId('omr-step')).toHaveTextContent('—');
    expect(within(screen.getByTestId('omr-row-w2')).getByTestId('omr-unplaced')).toHaveTextContent("4 stock movements are in no location's figures");
    expect(within(screen.getByTestId('omr-row-w2')).getByTestId('omr-unplaced').closest('a')).toBeNull(); // phase 1 has nowhere to resolve them: no action implied
  });

  it("leads every row with the owner's order number and puts our own number after it when it differs", () => {
    view('?project=pr1');
    const a = screen.getByTestId('omr-row-w1');
    expect(within(a).getByTestId('omr-order-number')).toHaveTextContent('PO-77');
    expect(within(a).getByTestId('omr-own-number')).toHaveTextContent('WO-1');
    const b = screen.getByTestId('omr-row-w2'); // no number of either kind read: the rollup's own, else the title
    expect(within(b).getByTestId('omr-order-number')).toHaveTextContent('Untitled order');
    expect(within(b).queryByTestId('omr-own-number')).toBeNull();
  });

  it("shows the rollup's number when the order numbers are not read, and one movement in the singular", () => {
    h.numbers = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    h.rollup = ok({ rows: [row({ unallocatedMovementCount: 1 })], total: 1 });
    view('?project=pr1');
    expect(within(screen.getByTestId('omr-row-w1')).getByTestId('omr-order-number')).toHaveTextContent('WO-1');
    expect(screen.getByTestId('omr-unplaced')).toHaveTextContent("1 stock movement is in no location's figures");
  });

  it('prints a location once when its code is its name, in the drilldown', async () => {
    h.sections = ok([{ sectionId: 's1', code: 'LOC_ALPHA', name: 'LOC_ALPHA', ownerCostCode: null, lineCount: 4, requestedPct: '70', setAsidePct: null, receivedPct: null, issuedPct: null, closingPct: null, stepId: null, step: null, stepPct: null, asOf: null, skippedSourceRows: 0, skippedReasonCodes: [] }]);
    view('?project=pr1&open=w1');
    expect(within(screen.getByTestId('omr-location-s1')).getAllByText('LOC_ALPHA')).toHaveLength(1);
  });

  it('AC-008 a work order with partly loaded locations, and each such location, is marked from the server counts', async () => {
    h.rollup = ok({ rows: [row({ partialSectionCount: 2 }), row({ workOrderId: 'w2', number: null, title: 'Untitled order', partialSectionCount: 0 })], total: 2 });
    h.sections = ok([
      { sectionId: 's1', code: 'L1', name: 'North yard', ownerCostCode: null, lineCount: 4, requestedPct: null, setAsidePct: null, receivedPct: null, issuedPct: null, closingPct: null, stepId: null, step: null, stepPct: null, asOf: null, skippedSourceRows: 6, skippedReasonCodes: [] },
      { sectionId: 's2', code: 'L2', name: 'South yard', ownerCostCode: null, lineCount: 2, requestedPct: null, setAsidePct: null, receivedPct: null, issuedPct: null, closingPct: null, stepId: null, step: null, stepPct: null, asOf: null, skippedSourceRows: 0, skippedReasonCodes: [] },
    ]);
    view('?project=pr1');
    expect(within(screen.getByTestId('omr-row-w1')).getByTestId('omr-partial')).toHaveTextContent('2 locations partly loaded');
    expect(within(screen.getByTestId('omr-row-w2')).queryByTestId('omr-partial')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Locations of PO-77' }));
    expect(within(screen.getByTestId('omr-location-s1')).getByTestId('omr-loc-partial')).toHaveTextContent('Partly loaded');
    expect(within(screen.getByTestId('omr-location-s2')).queryByTestId('omr-loc-partial')).toBeNull();
    cleanup();
    i18n.addResourceBundle('id', 'ownerMaterial', ownerMaterialId, true, true);
    await i18n.changeLanguage('id');
    view('?project=pr1');
    expect(within(screen.getByTestId('omr-row-w1')).getByTestId('omr-partial')).toHaveTextContent('2 lokasi dimuat sebagian');
  });

  it('opening a work order lists its locations as rows with their own percentages, step and a link to the stages', async () => {
    view('?project=pr1');
    await userEvent.click(screen.getByRole('button', { name: 'Locations of PO-77' }));
    expect(screen.getByTestId('where')).toHaveTextContent('open=w1');
    const a = screen.getByTestId('omr-location-s1');
    expect(within(a).getByTestId('omr-loc-lines')).toHaveTextContent('4 lines');
    expect(within(screen.getByTestId('omr-location-s2')).getByTestId('omr-loc-lines')).toHaveTextContent('2 lines');
    expect(within(a).getByTestId('omr-loc-requested')).toHaveTextContent('70%');
    expect(within(a).getByTestId('omr-loc-received')).toHaveTextContent('33.5%');
    expect(within(a).getByTestId('omr-location-step')).toHaveTextContent('Prepared · 20%');
    expect(within(a).getByRole('link', { name: 'Open stages' })).toHaveAttribute('href', '/work-orders/w1?section=s1#wo-material');
    expect(within(screen.getByTestId('omr-location-s2')).getByTestId('omr-location-step')).toHaveTextContent('Not started');
    await userEvent.click(screen.getByRole('button', { name: 'Hide locations of PO-77' }));
    expect(screen.getByTestId('where')).not.toHaveTextContent('open=');
  });

  it('on a phone each work order is a card with the same figures and its locations nested', async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      view('?project=pr1&open=w1');
      expect(screen.queryByTestId('omr-table')).toBeNull();
      const card = screen.getByTestId('omr-row-w1');
      expect(within(card).getAllByTestId('omr-received')[0]).toHaveTextContent('25.5%');
      expect(within(screen.getByTestId('omr-location-s1')).getByTestId('omr-loc-received')).toHaveTextContent('33.5%');
    } finally { window.matchMedia = mm; }
  });

  it('with several projects and none chosen the reader is asked; a single visible project is used', () => {
    const a = view();
    expect(screen.getByTestId('omr-choose')).toHaveTextContent('Choose a project');
    a.unmount();
    h.choices = ok([{ value: 'only', label: 'Only' }]);
    view();
    expect(h.rollupArgs.at(-1)).toEqual(['only', 1]);
  });

  it('choosing another project reads its first page and clears the page and open row', async () => {
    view('?project=pr1&mpage=2&open=w1');
    await userEvent.selectOptions(screen.getByTestId('omr-project'), 'pr2');
    expect(screen.getByTestId('where')).toHaveTextContent('project=pr2');
    expect(screen.getByTestId('where')).not.toHaveTextContent('mpage');
    expect(h.rollupArgs.at(-1)).toEqual(['pr2', 1]);
  });

  it('pages on the server and keeps the page in the address', async () => {
    h.rollup = ok({ rows: [row()], total: 120 });
    view('?project=pr1');
    expect(screen.getByText(/Showing 1–1 of 120/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByTestId('where')).toHaveTextContent('mpage=2');
  });

  it('empty says what is absent; denied has no retry; a failed read retries', async () => {
    h.rollup = ok({ rows: [], total: 0 });
    const a = view('?project=pr1');
    expect(screen.getByTestId('omr-empty')).toBeInTheDocument();
    a.unmount();
    h.rollup = failed('42501');
    const b = view('?project=pr1');
    expect(screen.getByTestId('omr-denied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry|try again/i })).toBeNull();
    b.unmount();
    const f = failed(); h.rollup = f;
    view('?project=pr1');
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(f.refetch).toHaveBeenCalled();
  });

  it('shows a loading placeholder while the page loads', () => {
    h.rollup = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    expect(view('?project=pr1').container.querySelector('[aria-busy="true"], [role="status"]')).not.toBeNull();
  });
});
