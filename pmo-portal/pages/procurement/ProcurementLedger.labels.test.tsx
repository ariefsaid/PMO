import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcurementLedger } from './ProcurementLedger';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-finance', org_id: 'org-1', role: 'Finance' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance', canImpersonate: false, viewAs: vi.fn() }) }));
vi.mock('@/src/hooks/useProcurementRecords', () => ({
  useProcurementRecordMutations: () => ({
    createPurchaseRequest: { mutateAsync: vi.fn(), isPending: false },
    createRfq: { mutateAsync: vi.fn(), isPending: false },
    createPurchaseOrder: { mutateAsync: vi.fn(), isPending: false },
    createPayment: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: () => ({ list: { data: [], isPending: false, isError: false }, upload: { mutate: vi.fn(), isPending: false }, archive: { mutate: vi.fn(), isPending: false }, download: vi.fn(), progress: null, uploadError: null, cancelUpload: vi.fn(), clearUploadError: vi.fn() }),
}));
vi.mock('@/src/lib/db/procurementFiles', () => ({ listProcurementFiles: vi.fn(), getSignedDownloadUrl: vi.fn() }));

const detail = {
  id: 'proc-1', title: 'Harbor bridge', project_id: 'project-1',
  project: { name: 'North pier', code: 'CLIENT-42', pmo_project_number: 'PMO-26-0042' },
  status: 'Paid', created_at: '2026-10-01T00:00:00Z',
} as ProcurementDetail;
const numbered: LedgerRow = {
  id: 'Invoice-row-1', date: '2026-10-02', type: 'Invoice', systemNumber: 'VI-910', externalRef: 'SUP-INV-910',
  amount: 100, status: 'Paid', statusVariant: 'won', fileHref: null, fileTitle: null, fileCount: 0,
  financial: true, recordId: 'invoice-immutable-910', currency: 'IDR', taxTreatment: 'inclusive',
  efakturNumber: null, efakturDate: null, efakturLocked: false,
};
const unnumbered: LedgerRow = {
  ...numbered, id: 'Invoice-row-2', systemNumber: null, externalRef: null, recordId: 'invoice-immutable-911',
};

function renderLedger(rows: LedgerRow[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FinanceI18nTestProvider>
      <MemoryRouter><QueryClientProvider client={queryClient}>
        <ProcurementLedger
          detail={detail} rows={rows} procurementId="proc-1" uploadedById={null}
          canWrite={false} canRecordEfaktur onSetEfaktur={vi.fn().mockResolvedValue(undefined)} invoices={[]}
        />
      </QueryClientProvider></MemoryRouter>
    </FinanceI18nTestProvider>,
  );
}

async function openEditor(rowIndex: number) {
  const actions = screen.getAllByRole('button').filter((button) => button.getAttribute('aria-haspopup') === 'menu');
  fireEvent.click(actions[rowIndex]);
  fireEvent.click(screen.getByRole('menuitem', { name: /e-faktur/i }));
  return screen.findByRole('dialog');
}

afterEach(() => vi.clearAllMocks());
beforeEach(async () => {
  await financeTestI18nReady;
  await financeTestI18n.changeLanguage('en');
});

describe('ProcurementLedger vendor e-Faktur recognition', () => {
  it.each(['en', 'id'] as const)('AC-UXT-005 identifies numbered and unnumbered vendor bills and explains issued-document entry in %s', async (locale) => {
    await financeTestI18n.changeLanguage(locale);
    renderLedger([numbered, unnumbered]);

    await openEditor(0);
    expect(screen.getByText(locale === 'en' ? 'Vendor invoice reference: SUP-INV-910' : 'Referensi faktur vendor: SUP-INV-910')).toBeInTheDocument();
    expect(screen.getByText(locale === 'en' ? 'System VI number: VI-910' : 'Nomor VI sistem: VI-910')).toBeInTheDocument();
    expect(screen.getByText(locale === 'en' ? 'Case: Harbor bridge' : 'Kasus: Harbor bridge')).toBeInTheDocument();
    expect(screen.getByText(locale === 'en' ? 'Project: North pier' : 'Proyek: North pier')).toBeInTheDocument();
    expect(screen.getByText(locale === 'en' ? 'PMO project number: PMO-26-0042' : 'Nomor proyek PMO: PMO-26-0042')).toBeInTheDocument();
    expect(screen.getByText(locale === 'en' ? 'Copy the number from the issued e-Faktur document.' : 'Salin nomor dari dokumen e-Faktur yang diterbitkan.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(financeTestI18n.t('efaktur.number')), '010.001-26.12345678');
    expect(screen.getByText(financeTestI18n.t('efaktur.dateMissing'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: financeTestI18n.t('financeCopy.save') })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: financeTestI18n.t('efaktur.cancel') }));
    fireEvent.click(screen.getByRole('button', { name: financeTestI18n.t('efaktur.discard') }));

    await openEditor(1);
    expect(screen.getByText(locale === 'en' ? 'Vendor invoice reference not recorded' : 'Referensi faktur vendor belum dicatat')).toBeInTheDocument();
    expect(screen.getByText(locale === 'en' ? 'System VI number unavailable' : 'Nomor VI sistem tidak tersedia')).toBeInTheDocument();
    expect(screen.getByText(locale === 'en' ? 'Case: Harbor bridge' : 'Kasus: Harbor bridge')).toBeInTheDocument();
    expect(screen.queryByText('invoice-immutable-911')).not.toBeInTheDocument();
  });
});
