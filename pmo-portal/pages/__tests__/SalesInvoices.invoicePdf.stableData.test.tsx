/** AC-PDF-011 with STABLE query data: the row menu must follow the in-flight state even when no input identity changes (row memo, #2102). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const { revenue, triggerBlobDownload, stableOwnership } = vi.hoisted(() => ({
  stableOwnership: { data: [{ id: 'o-1', orgId: 'org-1', externalTier: 'erpnext', domain: 'revenue' }], isError: false },
  revenue: { listInvoices: vi.fn(), downloadInvoicePdf: vi.fn() },
  triggerBlobDownload: vi.fn(),
}));
vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = await orig<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { revenue } };
});
vi.mock('@/src/lib/download', () => ({ triggerBlobDownload }));
const stableEmpty = vi.hoisted(() => ({ data: [] }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => stableEmpty,
  useInvoiceProjectOptions: () => stableEmpty,
  useProjectOptions: () => stableEmpty,
}));
const stableAuth = vi.hoisted(() => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => stableAuth,
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'external') }));
// The page waits for revenue ownership (#784 useRevenueMode); this org's ERP owns revenue (ERP-path invoices).
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => stableOwnership }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: true, loadOptions: async () => [] }) }));
type Analytics = typeof import('@/src/lib/analytics');
vi.mock('@/src/lib/analytics', async importOriginal => ({
  ...await importOriginal<Analytics>(),
  trackFilterApplied: vi.fn<Analytics['trackFilterApplied']>(),
  trackSearchUsed: vi.fn<Analytics['trackSearchUsed']>(),
} satisfies Analytics));

import SalesInvoices from '../SalesInvoices';

const base = {
  org_id: 'org-1', project_id: null, customer_id: 'cust-1', customer_name: 'Acme Energy', reference_number: null,
  invoice_date: '2026-10-01', amount: 1000, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0,
  erp_outstanding_amount: 1000, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-01T00:00:00Z', author_user_id: 'u-other', author_user_ids: ['u-other'],
  erp_payment_terms_days: 30, erp_due_date: null,
};
const ROWS = [
  { ...base, id: 'si-sub', si_number: 'ACC-SINV-2026-00001', status: 'Unpaid', erp_docstatus: 1 },
  { ...base, id: 'si-draft', si_number: 'ACC-SINV-2026-00002', status: 'Draft', erp_docstatus: 0 },
  { ...base, id: 'si-cancel', si_number: 'ACC-SINV-2026-00003', status: 'Cancelled', erp_docstatus: 2 },
  { ...base, id: 'si-native', si_number: 'SI-LOCAL-1', status: 'Unpaid', erp_docstatus: null },
] as unknown as SalesInvoiceRow[];

const renderPage = (realRole: Role) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={realRole}>
        <MemoryRouter>
          <ToastProvider>
            <SalesInvoices />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
};

async function rowFor(siNumber: string): Promise<HTMLElement> {
  await screen.findAllByText(siNumber);
  const row = screen.getAllByRole('row').find((r) => r.textContent?.includes(siNumber));
  if (!row) throw new Error(`no row for ${siNumber}`);
  return row;
}

/** The live announcement and its visible variant, preserving the message and classification oracles.
 *  The visible variant is the library's stacked toast element; its data-type carries the kind. */
async function toastWith(text: RegExp | string, role: 'status' | 'alert' = 'status'): Promise<{ el: HTMLElement; kind: 'info' | 'success' | 'warning' | undefined }> {
  const el = await findToastAnnouncement(role, text);
  const visual = await waitFor(() => {
    const toasts = Array.from(document.querySelectorAll<HTMLElement>('[data-sonner-toast]'));
    const match = toasts.find((li) =>
      typeof text === 'string' ? (li.textContent ?? '').includes(text) : text.test(li.textContent ?? ''));
    expect(match, `expected a visible toast matching ${String(text)}`).toBeDefined();
    return match!;
  });
  const kind = visual.getAttribute('data-type') as 'info' | 'success' | 'warning' | undefined;
  return { el, kind };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, siNumber: string) {
  await user.click(within(await rowFor(siNumber)).getByRole('button', { name: 'Row actions' }));
}

afterEach(() => { act(() => { sonnerToast.dismiss(); }); });
beforeEach(() => {
  revenue.listInvoices.mockResolvedValue(ROWS);
  revenue.downloadInvoicePdf.mockReset();
  triggerBlobDownload.mockReset();
});

describe('Receivables row menu follows download progress with stable data', () => {
  it('AC-PDF-011 a second click while in flight starts no second download and the item reads "Preparing PDF…"', async () => {
    let release!: (b: Blob) => void;
    revenue.downloadInvoicePdf.mockImplementation(() => new Promise<Blob>((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    renderPage('Finance');
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    expect((await toastWith('Preparing PDF…')).kind).toBe('info');

    await openMenu(user, 'ACC-SINV-2026-00001');
    const busy = await screen.findByRole('menuitem', { name: 'Preparing PDF…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    expect(revenue.downloadInvoicePdf).toHaveBeenCalledTimes(1);

    release(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('menuitem', { name: 'Download PDF' })).toBeEnabled();
  });
});
