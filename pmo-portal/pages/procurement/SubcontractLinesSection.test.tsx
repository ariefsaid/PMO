import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { SubcontractPoPositionRow, SubcontractCapExceptionRow } from '@/src/lib/db/subcontracts';
import enProcurement from '@/public/locales/en/procurement.json';
import idProcurement from '@/public/locales/id/procurement.json';

const h = vi.hoisted(() => ({
  position: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  draft: { data: [] as unknown[], isPending: false },
  acceptances: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  exceptions: { data: [] as unknown[], isError: false },
  issue: vi.fn(),
  requestVariation: vi.fn(),
  variations: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  may: vi.fn((_a: string, _e: string) => true),
}));

vi.mock('@/src/hooks/useSubcontract', () => ({
  usePoPosition: () => h.position,
  usePoDraftLines: () => h.draft,
  useSubcontractAcceptances: () => h.acceptances,
  useSubcontractCapExceptions: () => h.exceptions,
  usePoVariations: () => h.variations,
  useSubcontractMutations: () => {
    const m = () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
    return {
      setPoLines: m(), issuePoLines: { mutateAsync: h.issue, isPending: false }, prepareAcceptance: m(),
      confirmAcceptance: m(), withdrawAcceptance: m(), attributeBillLines: m(),
      requestVariation: { mutateAsync: h.requestVariation, isPending: false },
      decideVariation: m(), issueRevision: m(), linkVariation: m(),
    };
  },
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => h.may }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [{ id: 'u1', status: 'active' }, { id: 'u2', status: 'active' }] }) }));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProgressBilling', () => ({ useBoqItems: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' } }) }));

import { SubcontractLinesSection } from './SubcontractLinesSection';

const row = (o: Partial<SubcontractPoPositionRow>): SubcontractPoPositionRow => ({
  boq_item_id: 'e1', item_code: 'L1', description: 'Concrete', unit: 'm3', rate: 100000, po_qty: 100, revision: 1,
  verified: 120, verified_not_on_po: 20, verified_at: '2026-10-20T00:00:00Z', disputed: 0, billed: 100, payable: 0, ...o,
});
const TWO = [
  row({}),
  row({ boq_item_id: 'e2', item_code: 'L2', unit: 'm', rate: 40000, po_qty: 50, verified: 30, verified_not_on_po: 0, billed: 10, payable: 20 }),
];

function renderSection() {
  const i18n = createInstance();
  void i18n.init({
    lng: 'en', fallbackLng: 'en', ns: ['procurement'], defaultNS: 'procurement', interpolation: { escapeValue: false },
    resources: { en: { procurement: enProcurement }, id: { procurement: idProcurement } },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <SubcontractLinesSection poId="po1" procurementId="pr1" projectId="prj1" currency="IDR" currentUserId="u1" />
      </ToastProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  h.position = { data: TWO, isPending: false, isError: false, refetch: vi.fn() };
  h.draft = { data: [], isPending: false };
  h.acceptances = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  h.exceptions = { data: [], isError: false };
  h.variations = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  h.may = vi.fn(() => true);
  h.issue.mockReset().mockResolvedValue(undefined);
  h.requestVariation.mockReset().mockResolvedValue('var-1');
});

describe('SubcontractLinesSection', () => {
  it('AC-SCA-015 shows per-line PO / verified / billed / payable / verified-not-on-PO and totals that reconcile to the bill lines', async () => {
    renderSection();
    const r = await screen.findByRole('row', { name: /L1/ });
    for (const v of ['100', '120', '100', '0', '20']) expect(within(r).getAllByText(v).length).toBeGreaterThan(0);
    expect(screen.getByTestId('subcontract-billed-total')).toHaveTextContent(formatCurrency(10400000, 'IDR').replace(/\s/g, ' '));
    expect(screen.getByTestId('subcontract-bill-lines-total')).toHaveTextContent(formatCurrency(10400000, 'IDR').replace(/\s/g, ' '));
  });

  it('FR-SCA-050 loading shows a skeleton and no figures', () => {
    h.position = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    renderSection();
    expect(screen.queryByTestId('subcontract-billed-total')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('FR-SCA-050 a failed read shows the error notice and no figures, never 0', async () => {
    h.position = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderSection();
    expect(await screen.findByText(/could not load the subcontract position/i)).toBeInTheDocument();
    expect(screen.queryByTestId('subcontract-billed-total')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('FR-SCA-050 no issued lines shows "No BoQ lines issued" and the set-lines affordance for an editor', async () => {
    h.position = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    renderSection();
    expect(await screen.findByText('No BoQ lines issued')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set boq lines/i })).toBeInTheDocument();
  });

  it('FR-SCA-001 the set-lines affordance is hidden when the role may not edit lines', async () => {
    h.position = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.may = vi.fn((a: string, e: string) => !(a === 'edit' && e === 'subcontractLines'));
    renderSection();
    expect(await screen.findByText('No BoQ lines issued')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set boq lines/i })).toBeNull();
  });

  it('FR-SCA-002 draft lines show an Issue button that asks for confirmation before issuing', async () => {
    const user = userEvent.setup();
    h.position = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.draft = { data: [{ boq_item_id: 'e1', quantity: 10, rate: 5, unit: 'm' }], isPending: false };
    renderSection();
    await user.click(await screen.findByRole('button', { name: /^issue lines$/i }));
    expect(h.issue).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: /^issue$/i }));
    expect(h.issue).toHaveBeenCalledTimes(1);
  });

  it('OQ-7 a line verified beyond the PO shows how many days it has been outstanding', async () => {
    renderSection();
    expect(await screen.findByText(/verified, not on PO for \d+ days/i)).toBeInTheDocument();
  });

  it('FR-SCA-050 disputed quantity is shown when present', async () => {
    h.position = { data: [row({ disputed: 7 })], isPending: false, isError: false, refetch: vi.fn() };
    renderSection();
    const r = await screen.findByRole('row', { name: /L1/ });
    expect(within(r).getByText('7')).toBeInTheDocument();
  });

  it('FR-SCA-050 billed and payable null (D6) render as a dash, never 0', async () => {
    h.position = { data: [row({ billed: null, payable: null })], isPending: false, isError: false, refetch: vi.fn() };
    renderSection();
    const r = await screen.findByRole('row', { name: /L1/ });
    expect(within(r).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('subcontract-billed-total')).toHaveTextContent('—');
  });

  it('OQ-10 cap exceptions name each bill and reason; a no_lines row offers Attribute lines to Finance', async () => {
    const ex: SubcontractCapExceptionRow[] = [
      { invoice_id: 'i1', number: 'INV-9', amount: 5000000, erp_purchase_document_id: 'PI-1', reason: 'no_lines' },
    ];
    h.exceptions = { data: ex, isError: false };
    renderSection();
    const note = await screen.findByTestId('subcontract-cap-exceptions');
    expect(within(note).getByText(/INV-9/)).toBeInTheDocument();
    expect(within(note).getByRole('button', { name: /attribute lines/i })).toBeInTheDocument();
  });

  it('OQ-10 Attribute lines is hidden for a role that may not edit lines', async () => {
    h.exceptions = { data: [{ invoice_id: 'i1', number: 'INV-9', amount: 1, erp_purchase_document_id: 'PI-1', reason: 'no_lines' }], isError: false };
    h.may = vi.fn((a: string, e: string) => !(a === 'edit' && e === 'subcontractLines'));
    renderSection();
    await screen.findByTestId('subcontract-cap-exceptions');
    expect(screen.queryByRole('button', { name: /attribute lines/i })).toBeNull();
  });

  it('FR-SCA-010 Record acceptance is gated by can(prepare, subcontractAcceptance)', async () => {
    h.may = vi.fn((a: string, e: string) => !(a === 'prepare' && e === 'subcontractAcceptance'));
    renderSection();
    await screen.findByRole('row', { name: /L1/ });
    expect(screen.queryByRole('button', { name: /record acceptance/i })).toBeNull();
  });

  it('FR-SCA-034 offers a post-work variation from verified excess and bounds its quantity', async () => {
    const user = userEvent.setup();
    renderSection();
    const line = await screen.findByRole('row', { name: /L1/ });
    await user.click(within(line).getByRole('button', { name: /post-work/i }));
    expect(await screen.findByRole('heading', { name: /request po variation/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/additional quantity/i)).toHaveValue('20');
    expect(screen.getByText(/maximum verified amount not yet on po: 20 m3/i)).toBeInTheDocument();
  });

  it('FR-SCA-036 variation requests are hidden when can(request, poVariation) denies the user', async () => {
    h.may = vi.fn((a: string, e: string) => !(a === 'request' && e === 'poVariation'));
    renderSection();
    await screen.findByRole('row', { name: /L1/ });
    expect(screen.queryByRole('button', { name: /pre-work/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /post-work/i })).toBeNull();
  });

  it('R2: Attribute lines says what the fields are for — the bill\'s content at the PO rate', async () => {
    const user = userEvent.setup();
    h.exceptions = { data: [{ invoice_id: 'i1', number: 'INV-9', amount: 5000000, erp_purchase_document_id: 'PI-1', reason: 'no_lines' }], isError: false };
    renderSection();
    const note = await screen.findByTestId('subcontract-cap-exceptions');
    await user.click(within(note).getByRole('button', { name: /attribute lines/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('State what it covers, at the PO rate.');
  });
});
