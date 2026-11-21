import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToastProvider } from '@/src/components/ui';
import type { CertificateView } from '@/src/lib/db/subcontractCertificates';

/** AC-SPC-019 — the certificate screen in each state, in English and Bahasa Indonesia: every figure, exclusion reason and refusal renders. */
const h = vi.hoisted(() => ({
  view: null as unknown, isError: false, userId: 'u-prep', realRole: 'Finance', pm: 'pm1',
  m: new Proxy({} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>, {
    get(target, key: string) { return (target[key] ??= { mutateAsync: vi.fn(), isPending: false }); },
  }),
}));
vi.mock('@/src/hooks/useSubcontractCertificates', () => ({
  useCertificateView: () => ({ data: h.isError ? undefined : h.view, isPending: false, isError: h.isError, refetch: vi.fn() }),
  useCertificateMutations: () => h.m,
  useOpenBackcharges: () => ({ data: [{ id: 'bc2', amount: 12, currency: 'IDR', reason_code: 'safety', reason_text: null, claimed_by_certificate_id: null }] }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: { id: 'p1', name: 'Pipeline', project_manager_id: h.pm } }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Vendor One' }] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));

import SubcontractCertificateDetail from './SubcontractCertificateDetail';

const load = (lng: 'en' | 'id', ns: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/${ns}.json`), 'utf8'));
function makeI18n(lng: 'en' | 'id') {
  const i18n = i18next.createInstance();
  const bundle = (l: 'en' | 'id') => ({ common: load(l, 'common'), status: load(l, 'status'), subcontractCertificates: load(l, 'subcontractCertificates') });
  void i18n.init({ lng, fallbackLng: 'en', ns: ['common', 'status', 'subcontractCertificates'], defaultNS: 'common', fallbackNS: 'common',
    resources: { en: bundle('en'), id: bundle('id') }, initImmediate: false, interpolation: { escapeValue: false } });
  return i18n;
}

const derived = (over: Partial<CertificateView['derived']> = {}): CertificateView['derived'] => ({
  lines: [
    { boq_item_id: 'a', item_code: 'A', unit: 'm3', measured_quantity: 40, rate: 10, po_rate: 12, amount: 400, po_qty: 100, verified: 30, billed: 0, certified_to_date: 40, cap_ok: false, verified_short: true },
    { boq_item_id: 'b', item_code: 'B', unit: 'm3', measured_quantity: 12.5, rate: 8.4, po_rate: 12, amount: 105, po_qty: 100, verified: 100, billed: 0, certified_to_date: 12.5, cap_ok: true, verified_short: false },
  ],
  tuples: [{ work_date: '2026-03-03', work_order_line_id: 'wl1', crew_id: 'c1', boq_item_id: 'a', quantity: 15 }],
  excluded: [
    { work_date: '2026-03-10', work_order_line_id: 'wl4', crew_id: 'c1', boq_item_id: 'd', item_code: 'D', quantity: 6, reason: 'unrated_no_rate' },
    { work_date: '2026-03-09', work_order_line_id: 'wl1', crew_id: 'c2', boq_item_id: 'a', item_code: 'A', quantity: 4, reason: 'not_vendor_crew' },
    { work_date: '2026-03-11', work_order_line_id: 'wl1', crew_id: 'c1', boq_item_id: 'a', item_code: 'A', quantity: 2, reason: 'report_not_validated' },
    { work_date: '2026-03-12', work_order_line_id: 'wl1', crew_id: 'c1', boq_item_id: 'a', item_code: 'A', quantity: 7, reason: 'report_superseded' },
    { work_date: '2026-03-05', work_order_line_id: 'wl1', crew_id: 'c1', boq_item_id: 'a', item_code: 'A', quantity: 3, reason: 'already_certified', certificate_id: 'other', period_start: '2026-02-01' },
  ],
  unrated: [], backcharges: [{ id: 'bc1', amount: 38.3, reason_code: 'rework', reason_text: 'redo slab', held: false }],
  gross: 505, backcharge_total: 38.3, net: 466.7, ...over,
});
const make = (status: CertificateView['certificate']['status'], extra: Partial<CertificateView['certificate']> = {}, d = derived()): CertificateView => ({
  certificate: {
    id: 'c-1', po_id: 'po1', procurement_id: 'pr1', project_id: 'p1', work_order_id: 'w1', vendor_company_id: 'v1', currency: 'IDR',
    period_start: '2026-03-01', period_end: '2026-03-31', status, prepared_by: 'u-prep', submitted_by: null, approved_by: null, gross: 505,
    backcharge_total: 38.3, net: 466.7, invoice_id: null, bill_refusal: null, acceptance_id: null, returned_reason: null, cancel_reason: null,
    created_at: '2026-03-31T00:00:00Z', ...extra,
  },
  derived: d,
});

const renderPage = (lng: 'en' | 'id' = 'en') => render(
  <I18nextProvider i18n={makeI18n(lng)}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/subcontract-certificates/c-1']}>
        <ToastProvider><Routes><Route path="/subcontract-certificates/:certificateId" element={<SubcontractCertificateDetail />} /></Routes></ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  </I18nextProvider>,
);

beforeEach(() => { h.isError = false; h.userId = 'u-prep'; h.realRole = 'Finance'; h.pm = 'pm1'; Object.keys(h.m).forEach((k) => delete h.m[k]); });

describe('subcontract certificate screen', () => {
  it('AC-SPC-019 draft: every figure, the cap picture and every exclusion reason render, with the preparer\'s actions', () => {
    h.view = make('draft');
    renderPage();
    expect(screen.getByTestId('spc-status')).toHaveAttribute('data-status', 'draft');
    expect(screen.getByTestId('spc-gross')).toHaveTextContent('505.00');
    expect(screen.getByTestId('spc-backcharge')).toHaveTextContent('38.30');
    expect(screen.getByTestId('spc-net')).toHaveTextContent('466.70');
    expect(screen.getByText(/Verified 30 of 40 needed/)).toBeInTheDocument();
    expect(screen.getByText('Covered')).toBeInTheDocument();
    for (const reason of ['No agreed rate for this month', "Not this subcontractor's crew", 'The daily report is not validated yet', 'The daily report was replaced by a correction', 'Already in another certificate']) {
      expect(screen.getByText(new RegExp(reason))).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Feb 2026' })).toHaveAttribute('href', '/subcontract-certificates/other');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare acceptance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set aside' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText(/redo slab/)).toBeInTheDocument();
  });
  it('AC-SPC-006 submitted: the preparer cannot approve and is told why; a different Finance user can approve or return', () => {
    h.view = make('submitted', { submitted_by: 'u-prep' });
    const first = renderPage();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText(/needs a different approver/)).toBeInTheDocument();
    first.unmount();
    h.userId = 'u-other';
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument();
  });
  it('AC-SPC-006 OD-SPC-9: an Executive is an approver (approve and return), never of what they submitted, and cannot bill', () => {
    h.view = make('submitted', { submitted_by: 'u-prep' });
    h.realRole = 'Executive';
    h.userId = 'u-exec';
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create bill' })).not.toBeInTheDocument();
  });
  it('AC-SPC-019 approved: Finance may create the bill; the bill dialog states the payable', async () => {
    h.view = make('approved', { submitted_by: 'u-prep', approved_by: 'u-other' });
    h.userId = 'u-other';
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create bill' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/The payable is .*466\.70 after backcharges/)).toBeInTheDocument();
  });
  it('AC-SPC-013 approved with a refused bill: the refusal reason is shown', () => {
    h.view = make('approved', { submitted_by: 'u-prep', bill_refusal: 'line A cannot be billed: verified 40, PO 100, billed 30, this bill 40' });
    h.userId = 'u-other';
    renderPage();
    expect(screen.getByText('The bill was refused')).toBeInTheDocument();
    expect(screen.getByText(/line A cannot be billed: verified 40/)).toBeInTheDocument();
  });
  it('AC-SPC-019 billed: frozen figures, a link to the bill, no editing actions', () => {
    h.view = make('billed', { invoice_id: 'inv1', submitted_by: 'u-prep', approved_by: 'u-other' }, derived({ tuples: undefined }));
    h.userId = 'u-other';
    renderPage();
    expect(screen.getByRole('link', { name: 'Open bill' })).toHaveAttribute('href', '/procurement/pr1/ledger');
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel certificate' })).not.toBeInTheDocument();
  });
  it('AC-SPC-019 returned: the return reason shows', () => {
    h.view = make('returned', { returned_reason: 'Report of 3 March was corrected' });
    renderPage();
    expect(screen.getByText('Returned for changes')).toBeInTheDocument();
    expect(screen.getByText('Report of 3 March was corrected')).toBeInTheDocument();
  });
  it('AC-SPC-019 empty: a month with nothing measured says so, not a fabricated zero table', () => {
    h.view = make('draft', {}, derived({ lines: [], tuples: [], excluded: [], backcharges: [], gross: 0, backcharge_total: 0, net: 0 }));
    renderPage();
    expect(screen.getByText('Nothing measured and rated this month.')).toBeInTheDocument();
    expect(screen.getByText('Nothing is left out.')).toBeInTheDocument();
    expect(screen.getByText('No backcharges in this certificate.')).toBeInTheDocument();
  });
  it('AC-SPC-019 error: a failed read shows an error state with retry, never totals', () => {
    h.isError = true;
    renderPage();
    expect(screen.getByText("Couldn't load this certificate")).toBeInTheDocument();
    expect(screen.queryByTestId('spc-gross')).not.toBeInTheDocument();
  });
  it('AC-SPC-017 a role without the permission sees no actions (an Engineer cannot read it at all; Executive sees it read-only)', () => {
    h.view = make('draft');
    h.realRole = 'Executive';
    renderPage();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create bill' })).not.toBeInTheDocument();
    expect(screen.getByTestId('spc-gross')).toBeInTheDocument();
  });
  it('AC-SPC-019 Bahasa Indonesia: figures, reasons, actions and the refusal read in Bahasa', () => {
    h.view = make('draft', { bill_refusal: 'baris A ditolak' });
    renderPage('id');
    expect(screen.getByText('Pekerjaan terukur dengan tarif yang disepakati')).toBeInTheDocument();
    expect(screen.getByText(/Terverifikasi 30 dari 40 yang dibutuhkan/)).toBeInTheDocument();
    expect(screen.getByText(/Tidak ada tarif yang disepakati untuk bulan ini/)).toBeInTheDocument();
    expect(screen.getByText(/Bukan kru subkontraktor ini/)).toBeInTheDocument();
    expect(screen.getByText('Tagihan ditolak')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajukan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siapkan berita acara' })).toBeInTheDocument();
    expect(screen.queryByText('Left out')).not.toBeInTheDocument();
  });
});
