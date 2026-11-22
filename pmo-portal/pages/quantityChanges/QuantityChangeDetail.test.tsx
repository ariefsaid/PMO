import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToastProvider } from '@/src/components/ui';
import type { QcrDetail } from '@/src/lib/db/quantityChanges';

const load = (lng: 'en' | 'id', ns: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/${ns}.json`), 'utf8'));
function makeI18n(lng: 'en' | 'id') {
  const i18n = i18next.createInstance();
  const bundle = (l: 'en' | 'id') => ({
    common: load(l, 'common'),
    quantityChanges: load(l, 'quantityChanges'),
    status: load(l, 'status'),
    waitingList: load(l, 'waitingList'),
  });
  void i18n.init({
    lng,
    fallbackLng: 'en',
    ns: ['common', 'quantityChanges', 'status', 'waitingList'],
    defaultNS: 'quantityChanges',
    resources: { en: bundle('en'), id: bundle('id') },
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  return i18n;
}

/** #2578 request record page: what each person is offered, and why not (AC-QCR-011, 013, 023, 027, 030). */
const h = vi.hoisted(() => ({
  detail: null as unknown,
  approval: { can_approve: true, reason: null as string | null, eligible_approver_exists: true } as
    { can_approve: boolean; reason: string | null; eligible_approver_exists: boolean } | null,
  approvalError: false,
  refetch: vi.fn(),
  versions: [] as unknown[],
  userId: 'fin2',
  realRole: 'Finance',
  m: Object.fromEntries(['raise', 'updateDraft', 'submit', 'approve', 'returnRequest', 'withdraw', 'recordSent', 'recordDecision', 'uploadFile', 'archiveFile']
    .map((k) => [k, { mutateAsync: vi.fn(), isPending: false }])),
}));
vi.mock('@/src/hooks/useQuantityChanges', () => ({
  useQuantityChangeRequest: () => ({ data: h.detail, isPending: false, isError: false, refetch: vi.fn() }),
  useQuantityChangeApproval: (_id: string, enabled: boolean) => ({
    data: enabled ? h.approval : undefined,
    isPending: enabled && h.approval === null,
    isError: enabled && h.approvalError,
    refetch: h.refetch,
  }),
  useQuantityVersions: () => ({ data: h.versions, isPending: false }),
  useQuantityChangeMutations: () => h.m,
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: { id: 'p1', name: 'Pipeline', project_manager_id: 'pm' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { quantityChange: { fileUrl: vi.fn() } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));

import QuantityChangeDetail from './QuantityChangeDetail';

const make = (status: string, over: Partial<QcrDetail['request']> = {}, wo: Partial<NonNullable<QcrDetail['workOrder']>> = {}): QcrDetail => ({
  request: {
    id: 'q1', org_id: 'o1', project_id: 'p1', work_order_id: 'w1', status: status as QcrDetail['request']['status'], withdrawn_from: null, note: null,
    author_id: 'pm', editor_ids: ['pm', 'fin1'], first_submitted_at: null, submitted_by: 'fin1', submitted_at: null, approved_by: null, approved_at: null,
    returned_by: null, returned_at: null, return_reason: null, withdrawn_by: null, withdrawn_at: null, withdraw_reason: null, sent_date: null,
    client_reference: null, decision_date: null, decided_by: null, decision_note: null, created_at: '2026-03-10T08:00:00Z', ...over,
  },
  workOrder: { id: 'w1', label: 'WO-1 · Excavation', status: 'Issued', currency: 'USD', orderValue: 100000, ...wo },
  names: { author: 'Pat PM', approver: null },
  lines: [{ id: 'l1', boq_item_id: 'b1', requested_quantity: 1100, reason: 'Rock', trigger_kind: 'progress', trigger_figure: 1040, base_quantity: 1000,
    base_version_no: 1, item_code: 'EXC', description: 'Excavation', unit: 'm3', rate: 50000 }],
  events: [{ id: 'e1', action: 'raised', from_status: null, to_status: 'draft', actor_id: 'pm', reason: null, created_at: '2026-03-10T08:00:00Z' }],
  files: [],
});

const renderPage = (lng: 'en' | 'id' = 'en') => render(
  <I18nextProvider i18n={makeI18n(lng)}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/quantity-changes/q1']}>
        <ToastProvider><Routes><Route path="/quantity-changes/:requestId" element={<QuantityChangeDetail />} /></Routes></ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  </I18nextProvider>,
);

beforeEach(() => {
  h.userId = 'fin2'; h.realRole = 'Finance'; h.versions = [];
  h.approval = { can_approve: true, reason: null, eligible_approver_exists: true };
  h.approvalError = false;
  h.refetch.mockReset();
  Object.values(h.m).forEach((x) => (x as { mutateAsync: { mockReset: () => void } }).mutateAsync.mockReset());
});

describe('quantity change request record', () => {
  it('AC-QCR-023 shows the exact value change (1,100 - 1,000 at 50,000 = 5,000,000.00)', () => {
    h.detail = make('draft');
    renderPage();
    expect(screen.getByTestId('qcr-total-change').textContent).toMatch(/5,000,000\.00/);
    expect(screen.getByTestId('qcr-line-change').textContent).toMatch(/5,000,000\.00/);
  });

  it('AC-QCR-027 an editor of the request finds no Approve action and is told why', () => {
    h.detail = make('pending_approval');
    h.userId = 'fin1'; // in the editor set and the submitter
    h.approval = { can_approve: false, reason: 'editor', eligible_approver_exists: true };
    renderPage();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByTestId('qcr-approval-block').textContent).toMatch(/You edited this request, so someone else must approve it/);
  });

  it('AC-QCR-027 the author sees no Approve action', () => {
    h.detail = make('pending_approval');
    h.userId = 'pm'; h.realRole = 'Finance';
    h.approval = { can_approve: false, reason: 'author', eligible_approver_exists: true };
    renderPage();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByTestId('qcr-approval-block').textContent).toMatch(/You raised this request/);
  });

  it('AC-QCR-013 when nobody else is eligible the page says the request waits', () => {
    h.detail = make('pending_approval');
    h.userId = 'pm';
    h.approval = { can_approve: false, reason: 'author', eligible_approver_exists: false };
    renderPage();
    expect(screen.getByTestId('qcr-approval-nobody')).toBeInTheDocument();
  });

  it('AC-QCR-011 a different approver is offered Approve and Return, and Approve calls the server', async () => {
    h.detail = make('pending_approval');
    renderPage();
    expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(h.m.approve.mutateAsync).toHaveBeenCalledWith('q1');
  });

  it('AC-QCR-030 an Issued work order says the extra is billable only after a cancel and re-issue; a Draft one says its value rises', () => {
    h.detail = make('approved');
    const { unmount } = renderPage();
    expect(screen.getByTestId('qcr-billing-note').textContent).toMatch(/cancelled and re-issued/);
    unmount();
    h.detail = make('approved', {}, { status: 'Draft' });
    renderPage();
    expect(screen.getByTestId('qcr-billing-note').textContent).toMatch(/raises its value/);
  });

  it('AC-QCR-015 Record sent is disabled until the sent letter is attached', () => {
    h.detail = make('approved');
    h.realRole = 'Project Manager'; h.userId = 'pm';
    renderPage();
    expect(screen.getByRole('button', { name: 'Record sent to client' })).toBeDisabled();
  });

  it('AC-QCR-026 the version history lists each version with its value change', async () => {
    h.detail = make('client_accepted');
    h.versions = [
      { version_no: 1, quantity: 1000, source: 'baseline', request_id: null, created_by: null, created_at: 'a' },
      { version_no: 2, quantity: 1100, source: 'change_request', request_id: 'q1', created_by: 'pm', created_at: 'b' },
    ];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Version history' }));
    expect(screen.getByTestId('qcr-versions').textContent).toMatch(/Version 2/);
    expect(screen.getByTestId('qcr-version-change').textContent).toMatch(/5,000,000\.00/);
  });

  it('a withdrawn request shows what it was withdrawn from', () => {
    h.detail = make('withdrawn', { withdrawn_from: 'returned', withdraw_reason: 'No longer needed', withdrawn_at: '2026-03-12T00:00:00Z' });
    renderPage();
    expect(screen.getByTestId('qcr-withdrawn').textContent).toMatch(/No longer needed/);
  });

  describe('who-next waiting line (FR-WAIT-006; QCR 1177: Admin, Executive, Finance)', () => {
    it('pending_approval QCR shows ONE truthful role-only line (roleFinanceExecAdmin), in EN and ID, never a duplicate header copy', () => {
      h.detail = make('pending_approval');
      const first = renderPage('en');
      expect(screen.getByTestId('qcr-waiting-approval')).toHaveTextContent('Waiting for Finance, Executive, or Admin');
      expect(screen.getAllByText('Waiting for Finance, Executive, or Admin')).toHaveLength(1);
      expect(screen.queryByTestId('qcr-waiting-for')).toBeNull();
      first.unmount();

      renderPage('id');
      expect(screen.getByTestId('qcr-waiting-approval')).toHaveTextContent('Menunggu Keuangan, Eksekutif, atau Admin');
      expect(screen.getAllByText('Menunggu Keuangan, Eksekutif, atau Admin')).toHaveLength(1);
      expect(screen.queryByTestId('qcr-waiting-for')).toBeNull();
    });

    it('eligible_approver_exists false shows only the nobody sentence and never the who-next line', () => {
      h.detail = make('pending_approval');
      h.userId = 'fin1';
      h.approval = { can_approve: false, reason: 'editor', eligible_approver_exists: false };
      renderPage('en');
      expect(screen.getByTestId('qcr-approval-nobody')).toHaveTextContent('Nobody else can approve this request');
      expect(screen.queryByTestId('qcr-waiting-approval')).toBeNull();
      expect(screen.queryByText('Waiting for Finance, Executive, or Admin')).toBeNull();
    });

    it('while the server fact is still loading it claims no eligibility, only the neutral sentence', () => {
      h.detail = make('pending_approval');
      h.approval = null;
      renderPage('en');
      expect(screen.getByTestId('qcr-approval-checking')).toHaveTextContent('Waiting for approval');
      expect(screen.queryByTestId('qcr-waiting-approval')).toBeNull();
      expect(screen.queryByTestId('qcr-approval-nobody')).toBeNull();
    });

    it('a failed eligibility read says it could not verify and offers a retry', async () => {
      h.detail = make('pending_approval');
      h.approval = null;
      h.approvalError = true;
      renderPage('en');
      expect(screen.getByTestId('qcr-approval-checking')).toHaveTextContent("Couldn't verify who can approve right now.");
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(h.refetch).toHaveBeenCalled();
    });

    it('non-waiting states do not show the approval waiting section', () => {
      for (const st of ['draft', 'approved', 'client_accepted', 'withdrawn', 'returned'] as const) {
        h.detail = make(st);
        const { unmount } = renderPage();
        expect(screen.queryByTestId('qcr-approval')).toBeNull();
        expect(screen.queryByTestId('qcr-waiting-approval')).toBeNull();
        unmount();
      }
    });

    it('SoD block reason is preserved alongside who-next line', () => {
      h.detail = make('pending_approval');
      h.userId = 'fin1';
      h.approval = { can_approve: false, reason: 'editor', eligible_approver_exists: true };
      renderPage('en');
      expect(screen.getByTestId('qcr-waiting-approval')).toHaveTextContent('Waiting for Finance, Executive, or Admin');
      expect(screen.getByTestId('qcr-approval-block')).toHaveTextContent('You edited this request, so someone else must approve it.');
    });
  });
});
