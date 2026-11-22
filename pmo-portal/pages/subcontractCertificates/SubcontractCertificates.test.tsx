import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/** #2584 the certificate list and rate card: what each role is offered, states, bounded paging (FR-SPC-018/019, AC-SPC-017/019). */
const h = vi.hoisted(() => ({
  rows: [] as unknown[], hasMore: false, isError: false, realRole: 'Finance', rates: [] as unknown[],
  setRate: { mutate: vi.fn(), isPending: false }, prepare: { mutate: vi.fn(), isPending: false },
  currentUser: { id: 'u-finance', org_id: 'o1' } as { id: string; org_id?: string } | null,
  projects: [{ id: 'p1', name: 'Project 1', project_manager_id: 'pm-1' }] as unknown[],
  projectsPending: false,
  projectsError: false,
  pos: [{ po_id: 'po1', po_number: 'PO-1', title: 'Earthworks', project_id: 'p1', vendor_id: 'v1', work_order_id: 'w1', currency: 'IDR' }] as unknown[],
  posPending: false,
  posError: false,
}));
vi.mock('@/src/hooks/useSubcontractCertificates', () => ({
  useCertificates: () => ({ data: h.isError ? undefined : { rows: h.rows, hasMore: h.hasMore }, isPending: false, isError: h.isError, refetch: vi.fn() }),
  useRateLines: () => ({ data: h.rates, isPending: false, isError: false, refetch: vi.fn() }),
  useSubcontractPos: () => ({ data: h.posError ? undefined : h.pos, isPending: h.posPending, isError: h.posError, refetch: vi.fn() }),
  useCertificateMutations: () => ({ prepare: h.prepare, setRate: h.setRate }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectPickerOptions: () => ({ data: h.projectsError ? undefined : h.projects, isPending: h.projectsPending, isError: h.projectsError, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({ useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Vendor One' }] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: h.currentUser }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await import('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx?: object) => can(action, entity, { realRole: h.realRole as never, ...ctx }) };
});

import SubcontractCertificatesPage from './SubcontractCertificates';

const row = (id: string, status: string, gross: number | null) => ({
  id, po_id: 'po1', procurement_id: 'pr1', project_id: 'p1', work_order_id: 'w1', vendor_company_id: 'v1', currency: 'IDR',
  period_start: '2026-03-01', period_end: '2026-03-31', status, prepared_by: 'u', submitted_by: null, approved_by: null, gross,
  backcharge_total: gross === null ? null : 38.3, net: gross === null ? null : gross - 38.3, invoice_id: null, bill_refusal: null,
  acceptance_id: null, returned_reason: null, cancel_reason: null, created_at: '2026-03-31T00:00:00Z',
});
const renderPage = (url = '/subcontract-certificates') => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[url]}><ToastProvider><SubcontractCertificatesPage /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.rows = [];
  h.hasMore = false;
  h.isError = false;
  h.realRole = 'Finance';
  h.rates = [];
  h.currentUser = { id: 'u-finance', org_id: 'o1' };
  h.projects = [{ id: 'p1', name: 'Project 1', project_manager_id: 'pm-1' }];
  h.projectsPending = false;
  h.projectsError = false;
  h.pos = [{ po_id: 'po1', po_number: 'PO-1', title: 'Earthworks', project_id: 'p1', vendor_id: 'v1', work_order_id: 'w1', currency: 'IDR' }];
  h.posPending = false;
  h.posError = false;
  h.prepare.mutate.mockClear();
  h.setRate.mutate.mockClear();
});

describe('subcontract certificate list', () => {
  it('FR-SPC-018 lists certificates with the exact payable; a draft shows no figure rather than zero', () => {
    h.rows = [row('c1', 'billed', 538.3), row('c2', 'draft', null)];
    renderPage();
    expect(screen.getAllByRole('link', { name: 'Mar 2026' })).toHaveLength(2);
    expect(screen.getByText('IDR 500.00')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('Billed').length).toBeGreaterThan(0);
  });
  it('FR-SPC-018 offers the next page only when the server says there is more', () => {
    h.rows = [row('c1', 'draft', null)];
    h.hasMore = true;
    renderPage();
    expect(screen.getByRole('button', { name: 'Older' })).toBeInTheDocument();
  });
  it('AC-SPC-019 empty: says so and offers the preparer a New certificate', () => {
    renderPage();
    expect(screen.getByText('No certificates yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New certificate' }).length).toBeGreaterThan(0);
  });
  it('AC-SPC-019 error: a failed read is an error state, not an empty list', () => {
    h.isError = true;
    renderPage();
    expect(screen.getByText("Couldn't load certificates")).toBeInTheDocument();
    expect(screen.queryByText('No certificates yet')).not.toBeInTheDocument();
  });
  it('AC-SPC-017 an Executive reads the list and the rate card but is offered no write', async () => {
    h.realRole = 'Executive';
    h.rates = [{ id: 'r1', vendor_company_id: 'v1', boq_item_id: 'abcdef12-0000', unit: 'm3', rate: 10, currency: 'IDR', effective_from: '2026-03-01', effective_to: null, version: 1 }];
    renderPage('/subcontract-certificates?view=rates');
    expect(await screen.findByText('IDR 10.00 / m3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set a rate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New certificate' })).not.toBeInTheDocument();
  });
  it('FR-SPC-003 an Engineer is offered neither the rate card nor any write', () => {
    h.realRole = 'Engineer';
    renderPage('/subcontract-certificates?view=rates');
    expect(screen.queryByRole('tab', { name: 'Rate card' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New certificate' })).not.toBeInTheDocument();
  });
  it('FR-SPC-001 Finance keeps the card: the month field and the rate come from the purchase order, the server decides the window', async () => {
    h.rates = [];
    renderPage('/subcontract-certificates?view=rates');
    await userEvent.click(screen.getAllByRole('button', { name: 'Set a rate' })[0]);
    expect(await screen.findByRole('dialog', { name: 'Set a rate' })).toBeInTheDocument();
    expect(screen.getByLabelText(/From month/)).toHaveAttribute('type', 'month');
  });

  it('offers a Project Manager who manages an eligible project the New certificate action and lawful PO selection', async () => {
    h.realRole = 'Project Manager';
    h.currentUser = { id: 'pm-1', org_id: 'o1' };
    h.projects = [
      { id: 'p1', name: 'Managed Project', project_manager_id: 'pm-1' },
      { id: 'p2', name: 'Foreign Project', project_manager_id: 'pm-2' },
    ];
    h.pos = [
      { po_id: 'po1', po_number: 'PO-1', title: 'Earthworks', project_id: 'p1', vendor_id: 'v1', work_order_id: 'w1', currency: 'IDR' },
      { po_id: 'po2', po_number: 'PO-2', title: 'Concrete', project_id: 'p2', vendor_id: 'v1', work_order_id: 'w2', currency: 'IDR' },
    ];
    renderPage();

    const newBtn = screen.getByRole('button', { name: 'New certificate' });
    expect(newBtn).toBeInTheDocument();
    await userEvent.click(newBtn);

    expect(await screen.findByRole('dialog', { name: 'New certificate' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'PO-1 · Earthworks' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'PO-2 · Concrete' })).not.toBeInTheDocument();
  });

  it('denies New certificate action to a Project Manager who only has foreign projects', () => {
    h.realRole = 'Project Manager';
    h.currentUser = { id: 'pm-foreign', org_id: 'o1' };
    h.projects = [{ id: 'p1', name: 'Other Project', project_manager_id: 'pm-1' }];
    h.pos = [{ po_id: 'po1', po_number: 'PO-1', title: 'Earthworks', project_id: 'p1', vendor_id: 'v1', work_order_id: 'w1', currency: 'IDR' }];
    renderPage();

    expect(screen.queryByRole('button', { name: 'New certificate' })).not.toBeInTheDocument();
  });

  it('does not offer New certificate action to a PM when subcontract POs are pending', () => {
    h.realRole = 'Project Manager';
    h.currentUser = { id: 'pm-1', org_id: 'o1' };
    h.projects = [{ id: 'p1', name: 'Project 1', project_manager_id: 'pm-1' }];
    h.posPending = true;
    renderPage();

    expect(screen.queryByRole('button', { name: 'New certificate' })).not.toBeInTheDocument();
  });

  it('does not offer New certificate action to a PM when projects query is in error', () => {
    h.realRole = 'Project Manager';
    h.currentUser = { id: 'pm-1', org_id: 'o1' };
    h.projectsError = true;
    renderPage();

    expect(screen.queryByRole('button', { name: 'New certificate' })).not.toBeInTheDocument();
  });

  it('keeps chosen-project gate enabled only for lawful PO and submits prepared certificate', async () => {
    h.realRole = 'Project Manager';
    h.currentUser = { id: 'pm-1', org_id: 'o1' };
    h.projects = [{ id: 'p1', name: 'Managed Project', project_manager_id: 'pm-1' }];
    h.pos = [{ po_id: 'po1', po_number: 'PO-1', title: 'Earthworks', project_id: 'p1', vendor_id: 'v1', work_order_id: 'w1', currency: 'IDR' }];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'New certificate' }));
    const prepareBtn = screen.getByRole('button', { name: 'Prepare certificate' });
    expect(prepareBtn).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText(/Subcontract purchase order/), 'po1');
    await userEvent.type(screen.getByLabelText(/Month/), '2026-03');
    expect(prepareBtn).toBeEnabled();

    await userEvent.click(prepareBtn);
    expect(h.prepare.mutate).toHaveBeenCalledWith(
      { poId: 'po1', periodStart: '2026-03-01' },
      expect.any(Object),
    );
  });
});
