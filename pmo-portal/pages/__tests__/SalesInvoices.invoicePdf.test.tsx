/** #912 — "Download PDF" on the Sales Invoices list (AC-PDF-003 offering, AC-PDF-011 behaviour). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const { revenue, triggerBlobDownload } = vi.hoisted(() => ({
  revenue: { listInvoices: vi.fn(), downloadInvoicePdf: vi.fn() },
  triggerBlobDownload: vi.fn(),
}));
vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = await orig<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { revenue } };
});
vi.mock('@/src/lib/download', () => ({ triggerBlobDownload }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [] }),
  useProjectOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'external') }));
// The page waits for revenue ownership (#784 useRevenueMode); this org's ERP owns revenue (ERP-path invoices).
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [{ id: 'o-1', orgId: 'org-1', externalTier: 'erpnext', domain: 'revenue' }], isError: false }) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: true, loadOptions: async () => [] }) }));
vi.mock('@/src/lib/analytics', () => ({ trackFilterApplied: vi.fn() }));

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

/** The live toast carrying `text`, and its variant (the stripe class ToastView sets per kind). */
async function toastWith(text: RegExp | string): Promise<{ el: HTMLElement; kind: 'info' | 'success' | 'warning' | undefined }> {
  const el = (await screen.findByText(text)).closest<HTMLElement>('[role="status"]');
  if (!el) throw new Error(`no toast for ${String(text)}`);
  const kind = (['info', 'success', 'warning'] as const).find((k) =>
    el.className.includes({ info: 'border-l-primary', success: 'border-l-success', warning: 'border-l-warning' }[k]),
  );
  return { el, kind };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, siNumber: string) {
  await user.click(within(await rowFor(siNumber)).getByRole('button', { name: 'Row actions' }));
}

/** A row with no permitted action renders no menu trigger at all (e.g. a Cancelled invoice for Finance). */
async function offersDownload(user: ReturnType<typeof userEvent.setup>, siNumber: string): Promise<boolean> {
  const trigger = within(await rowFor(siNumber)).queryByRole('button', { name: 'Row actions' });
  if (!trigger) return false;
  await user.click(trigger);
  const offered = screen.queryByRole('menuitem', { name: 'Download PDF' }) !== null;
  await user.keyboard('{Escape}');
  return offered;
}

beforeEach(() => {
  revenue.listInvoices.mockResolvedValue(ROWS);
  revenue.downloadInvoicePdf.mockReset();
  triggerBlobDownload.mockReset();
});

describe('SalesInvoices — Download PDF is offered only where it can succeed', () => {
  it('AC-PDF-003 Finance and Admin see it on a submitted ERP invoice and not on draft, cancelled or PMO-native rows', async () => {
    for (const role of ['Finance', 'Admin'] as Role[]) {
      const user = userEvent.setup();
      const { unmount } = renderPage(role);
      expect(await offersDownload(user, 'ACC-SINV-2026-00001'), role).toBe(true);
      for (const si of ['ACC-SINV-2026-00002', 'ACC-SINV-2026-00003', 'SI-LOCAL-1']) {
        expect(await offersDownload(user, si), `${role} ${si}`).toBe(false);
      }
      unmount();
    }
  });

  it('AC-PDF-003 an Executive is not offered it', async () => {
    renderPage('Executive');
    await screen.findAllByText('ACC-SINV-2026-00001');
    expect(screen.queryAllByRole('button', { name: 'Row actions' })).toHaveLength(0);
    expect(screen.queryByRole('menuitem', { name: 'Download PDF' })).not.toBeInTheDocument();
  });

  it('AC-PDF-003 a Project Manager sees the list but is not offered it, even on a submitted ERP invoice', async () => {
    const user = userEvent.setup();
    renderPage('Project Manager');
    for (const si of ['ACC-SINV-2026-00001', 'ACC-SINV-2026-00002', 'ACC-SINV-2026-00003', 'SI-LOCAL-1']) {
      expect(await offersDownload(user, si), si).toBe(false);
    }
    expect(screen.queryByRole('menuitem', { name: 'Download PDF' })).not.toBeInTheDocument();
  });

  it('AC-PDF-003 an Engineer is not offered it — the invoice list itself is closed to them', async () => {
    renderPage('Engineer');
    expect(await screen.findByText("You don't have access to Sales Invoices")).toBeInTheDocument();
    expect(screen.queryByText('ACC-SINV-2026-00001')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Download PDF' })).not.toBeInTheDocument();
    expect(revenue.downloadInvoicePdf).not.toHaveBeenCalled();
  });
});

describe('SalesInvoices — Download PDF saves the ERP document', () => {
  it('AC-PDF-011 saves <invoice number>.pdf from the returned PDF', async () => {
    const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    revenue.downloadInvoicePdf.mockResolvedValue(pdf);
    const user = userEvent.setup();
    renderPage('Finance');
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledWith(pdf, 'ACC-SINV-2026-00001.pdf'));
    expect(revenue.downloadInvoicePdf).toHaveBeenCalledWith('si-sub');
  });

  it('AC-PDF-011 success replaces the preparing toast with "PDF downloaded — <file>"', async () => {
    const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    let release!: (b: Blob) => void;
    revenue.downloadInvoicePdf.mockImplementation(() => new Promise<Blob>((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    renderPage('Finance');
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    expect((await toastWith('Preparing PDF…')).kind).toBe('info');
    release(pdf);
    const done = await toastWith(/PDF downloaded — ACC-SINV-2026-00001\.pdf/);
    expect(done.kind).toBe('success');
    expect(screen.queryByText('Preparing PDF…')).not.toBeInTheDocument();
  });

  // Deliberate UX change (fix round): the repeat click used to be silently swallowed; it is now
  // impossible — the row item disables itself under the busy label until the outcome arrives.
  it('AC-PDF-011 while a download is in flight the row item is disabled under the busy label, and the outcome re-enables it', async () => {
    let release!: (b: Blob) => void;
    revenue.downloadInvoicePdf.mockImplementation(() => new Promise<Blob>((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    renderPage('Finance');
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    expect((await toastWith('Preparing PDF…')).kind).toBe('info');

    await openMenu(user, 'ACC-SINV-2026-00001');
    const busy = screen.getByRole('menuitem', { name: 'Preparing PDF…' });
    // WAI-ARIA menu pattern: announced disabled but still focusable, so the open menu's
    // first item always takes keyboard focus (a HTML-disabled button would strand it).
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    // Enter/click on the aria-disabled item is swallowed by the activate guard —
    // exactly one request, the one already in flight.
    await user.click(busy);
    expect(revenue.downloadInvoicePdf).toHaveBeenCalledTimes(1);

    release(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledTimes(1));
    // The still-open menu shows the item back under its own name, enabled again.
    expect(await screen.findByRole('menuitem', { name: 'Download PDF' })).toBeEnabled();
  });

  it('AC-PDF-011 a refused download explains the remedy', async () => {
    revenue.downloadInvoicePdf.mockRejectedValueOnce(
      Object.assign(new Error('The ERP refused to print this invoice.'), { code: 'ERP_NOT_PERMITTED' }),
    );
    const user = userEvent.setup();
    renderPage('Finance');
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    const refused = await toastWith(/give the integration user Print access/);
    expect(refused.kind).toBe('warning');
    expect(within(refused.el).getByText("Couldn't download the PDF")).toBeInTheDocument();
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });

  it.each([
    ['no code at all (unreachable)', new Error('boom')],
    ['a non-ERP code (503)', Object.assign(new Error('Service Unavailable'), { code: 'HTTP_503' })],
    ['an unknown future code', Object.assign(new Error('mystery'), { code: 'SOMETHING_NEW' })],
  ])('AC-PDF-011 a failure that is not an ERP code (%s) blames the download service, not the ERP', async (_name, err) => {
    revenue.downloadInvoicePdf.mockRejectedValueOnce(err);
    const user = userEvent.setup();
    renderPage('Finance');
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    expect((await toastWith(/PMO could not reach the download service/)).kind).toBe('warning');
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });

  it.each(['NOT_SUBMITTED', 'ERP_DOCUMENT_MISSING', 'NOT_FOUND'])('AC-PDF-011 a %s refusal invalidates the sales-invoices list instead of telling the user to refresh', async (code) => {
    revenue.downloadInvoicePdf.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
    const user = userEvent.setup();
    renderPage('Finance');
    await screen.findAllByText('ACC-SINV-2026-00001');
    expect(revenue.listInvoices).toHaveBeenCalledTimes(1);
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    await waitFor(() => expect(revenue.listInvoices).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['Admin', 'ERP_NOT_CONNECTED', /Open Administration → Integrations/],
    ['Finance', 'ERP_NOT_CONNECTED', /Ask your administrator to check Integrations/],
    ['Admin', 'ERP_NOT_PERMITTED', /Open Administration → Integrations/],
    ['Finance', 'ERP_NOT_PERMITTED', /Ask your administrator to give the integration user Print access/],
  ])('AC-PDF-011 as %s, a %s refusal says where the fix lives instead of only who to ask', async (role, code, match) => {
    revenue.downloadInvoicePdf.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
    const user = userEvent.setup();
    renderPage(role as Role);
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    expect((await toastWith(match)).kind).toBe('warning');
  });

  it('AC-PDF-011 an expired session tells the user to sign in again', async () => {
    revenue.downloadInvoicePdf.mockRejectedValueOnce(
      Object.assign(new Error('Sign in again to download this invoice.'), { code: 'UNAUTHORIZED' }),
    );
    const user = userEvent.setup();
    renderPage('Finance');
    await openMenu(user, 'ACC-SINV-2026-00001');
    await user.click(screen.getByRole('menuitem', { name: 'Download PDF' }));
    expect((await toastWith('Your session expired — sign in again.')).kind).toBe('warning');
    expect(screen.queryByText(/PMO could not reach the download service/)).not.toBeInTheDocument();
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });
});
