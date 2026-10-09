import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BahasaProvider } from '@/test/bahasa';
import { formatCurrency, formatDateOnly, formatDateTime } from '@/src/lib/format';

const { repo, listProcurementsByProject, listBudgetVersions, procDetail } = vi.hoisted(() => ({
  repo: {
    recordHistory: { list: vi.fn(), lookupNames: vi.fn() },
    profile: { listOrgProfiles: vi.fn() },
    company: { list: vi.fn(), get: vi.fn() },
    task: { list: vi.fn() },
    milestone: { list: vi.fn() },
    workOrder: { list: vi.fn() },
  },
  listProcurementsByProject: vi.fn(),
  listBudgetVersions: vi.fn(),
  procDetail: { data: undefined as Record<string, unknown> | undefined },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: repo }));
vi.mock('@/src/lib/db/procurements', () => ({ listProcurementsByProject }));
vi.mock('@/src/lib/db/budgets', () => ({ listBudgetVersions }));
// #878: the procurement History names its document children (PR / RFQ / PO / payment) from the SAME
// cached detail query the page itself uses — the hook stays disabled off a procurement History.
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: (id: string | undefined) => ({
    data: id ? procDetail.data : undefined,
    isPending: false,
    isError: false,
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { RecordHistory } from '../RecordHistory';

const ev = (n: number, over: Record<string, unknown> = {}) => ({
  id: `e${n}`, source: 'change', seq: n, entityType: 'project', entityId: 'p1', op: 'update', action: null,
  actorId: 'u1', changes: {}, detail: null, currency: 'USD', createdAt: new Date(Date.now() - n * 60_000).toISOString(),
  ...over,
});

const renderIt = (props: Partial<React.ComponentProps<typeof RecordHistory>> = {}, wrap = false) => {
  const ui = (
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RecordHistory entityType="project" entityId="p1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  return render(wrap ? <BahasaProvider>{ui}</BahasaProvider> : ui);
};

beforeEach(() => {
  vi.resetAllMocks();
  repo.recordHistory.lookupNames.mockResolvedValue({});
  repo.profile.listOrgProfiles.mockResolvedValue([
    { id: 'u1', full_name: 'Dana PM' }, { id: 'u2', full_name: 'Sam Lead' },
  ]);
  repo.company.list.mockResolvedValue([{ id: 'c1', name: 'Acme Corp' }, { id: 'c2', name: 'Globex' }]);
  repo.company.get.mockResolvedValue(null);
  repo.task.list.mockResolvedValue([
    { id: 't1', name: 'Install pump' }, { id: 't2', name: 'Commission pump' },
  ]);
  repo.milestone.list.mockResolvedValue([{ id: 'm1', name: 'Design freeze' }, { id: 'm2', name: 'Handover' }]);
  repo.workOrder.list.mockResolvedValue([{ id: 'wo1', wo_number: 'WO-001', title: 'Phase 1' }]);
  listProcurementsByProject.mockResolvedValue([
    { id: 'pr1', code: 'PR-0007', title: 'Valves' }, { id: 'pr2', code: null, title: 'Gaskets' },
  ]);
  listBudgetVersions.mockResolvedValue([
    { id: 'bv1', name: 'Baseline', version: 1, line_items: [{ id: 'li1', description: 'Site crew', category: 'Labor' }] },
  ]);
});

describe('RecordHistory — formatting (AC-CHG-015)', () => {
  it('HI-1: resolves only procurement child event IDs on the loaded History page', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: [
      ev(4, { entityType: 'purchase_request', entityId: 'pr-child', changes: {} }),
      ev(3, { entityType: 'rfq', entityId: 'rfq-child', changes: {} }),
      ev(2, { entityType: 'purchase_order', entityId: 'po-child', changes: {} }),
      ev(1, { entityType: 'payment', entityId: 'pay-child', changes: {} }),
    ], nextCursor: null });
    repo.recordHistory.lookupNames.mockResolvedValue({
      purchase_request: new Map([['pr-child', 'PR-0001']]),
      rfq: new Map([['rfq-child', 'RFQ-0001']]),
      purchase_order: new Map([['po-child', 'PO-0001']]),
      payment: new Map([['pay-child', 'PAY-0001']]),
    });
    renderIt({ includeChildren: true });
    expect(await screen.findByText('Purchase request · PR-0001')).toBeInTheDocument();
    expect(screen.getByText('RFQ · RFQ-0001')).toBeInTheDocument();
    expect(screen.getByText('Purchase order · PO-0001')).toBeInTheDocument();
    expect(screen.getByText('Payment · PAY-0001')).toBeInTheDocument();
    expect(repo.recordHistory.lookupNames).toHaveBeenCalledWith({
      purchase_request: ['pr-child'], rfq: ['rfq-child'], purchase_order: ['po-child'], payment: ['pay-child'],
    });
  });

  it('#961 history-bill-label names a linked withholding bill', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: [
      ev(1, { entityType: 'vendor_withholding_slip_bill', entityId: 'link-1', op: 'insert', changes: {} }),
    ], nextCursor: null });
    repo.recordHistory.lookupNames.mockResolvedValue({
      vendor_withholding_slip_bill: new Map([['link-1', 'VI-2026-01']]),
    });

    renderIt({ entityType: 'vendor_withholding_slip', entityId: 'slip-1', includeChildren: true });

    expect(await screen.findByText('Bukti potong bill link · VI-2026-01')).toBeInTheDocument();
    expect(screen.queryByText(/Unavailable/)).not.toBeInTheDocument();
    expect(repo.recordHistory.lookupNames).toHaveBeenCalledWith({ vendor_withholding_slip_bill: ['link-1'] });
  });

  it('HI-2: names invoice event records from only the event IDs on the visible page', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: [
      ev(2, { entityType: 'sales_invoice', entityId: 'si-1', changes: {} }),
      ev(1, { entityType: 'procurement_invoice', entityId: 'vi-1', changes: {} }),
    ], nextCursor: null });
    repo.recordHistory.lookupNames.mockResolvedValue({
      sales_invoice: new Map([['si-1', 'SI-2026-01']]),
      procurement_invoice: new Map([['vi-1', 'VI-2026-01']]),
    });
    renderIt({ includeChildren: true, kindFilters: true });
    expect(await screen.findByText('Sales invoice · SI-2026-01')).toBeInTheDocument();
    expect(screen.getByText('Vendor bill · VI-2026-01')).toBeInTheDocument();
    expect(repo.recordHistory.lookupNames).toHaveBeenCalledWith({
      sales_invoice: ['si-1'], procurement_invoice: ['vi-1'],
    });
  });
  const events = [
    ev(6, { actorId: null, changes: { status: { old: 'Leads', new: 'Ongoing Project' } } }),
    ev(5, { actorId: 'ghost', op: 'insert', changes: {} }),
    ev(4, { entityType: 'contact', changes: { phone: { changed: true } } }),
    ev(3, {
      changes: {
        contract_value: { old: 1000, new: 2500 },
        end_date: { old: '2026-01-05', new: '2026-02-10' },
        client_id: { old: 'c1', new: 'c2' },
        project_manager_id: { old: 'u2', new: 'zzz' },
        subject_to_vat: { old: null, new: true },
      },
    }),
    ev(2, { changes: { archived_at: { old: null, new: '2026-10-06T00:00:00Z' } } }),
    ev(1, { changes: { archived_at: { old: '2026-10-06T00:00:00Z', new: null } } }),
  ];

  it('renders actor, Label: old → new per kind, flagged, created, archived/restored, system and unknown actors', async () => {
    repo.recordHistory.list.mockResolvedValue({ events, nextCursor: null });
    renderIt();
    const money = await screen.findByText(`${formatCurrency(1000, 'USD')} → ${formatCurrency(2500, 'USD')}`);
    expect(money.closest('li')).toHaveTextContent('Contract value');
    expect(money.closest('[data-testid="history-event"]')).toHaveTextContent('Dana PM');
    expect(screen.getByText(`${formatDateOnly('2026-01-05')} → ${formatDateOnly('2026-02-10')}`)).toBeInTheDocument();
    expect(await screen.findByText('Acme Corp → Globex')).toBeInTheDocument();
    expect(screen.getByText('Sam Lead → Unavailable')).toBeInTheDocument();
    expect(screen.getByText('empty → Yes')).toBeInTheDocument();
    expect(screen.getByText('Leads → Ongoing Project')).toBeInTheDocument();
    expect(screen.getByText('Phone changed')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText('Restored')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Unknown user')).toBeInTheDocument();
    // old/new conveyed as text, not colour alone: the arrow is part of the text node
    expect(screen.queryByText(/raw-uuid|c1|c2/)).toBeNull();
  });

  it('renders in Bahasa Indonesia with localized labels, enum values and fixed-copy names', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: [events[0], events[1], events[3]], nextCursor: null });
    renderIt({}, true);
    expect(await screen.findByText('Sistem')).toBeInTheDocument();
    expect(screen.getByText('Pengguna tidak dikenal')).toBeInTheDocument();
    expect(screen.getByText('Dibuat')).toBeInTheDocument();
    const money = screen.getByText(`${formatCurrency(1000, 'USD')} → ${formatCurrency(2500, 'USD')}`);
    expect(money.closest('li')).toHaveTextContent('Nilai kontrak');
    expect(await screen.findByText('Sam Lead → Tidak tersedia')).toBeInTheDocument();
    expect(screen.getByText('Prospek → Proyek berjalan')).toBeInTheDocument();
  });

  it('a flagged field never renders its values, even when the event carries them', async () => {
    repo.recordHistory.list.mockResolvedValue({
      events: [ev(1, { entityType: 'contact', changes: { phone: { changed: true, old: 'x-old-secret', new: 'y-new-secret' } } })],
      nextCursor: null,
    });
    renderIt({ entityType: 'contact' });
    const line = await screen.findByText('Phone changed');
    expect(line.closest('li')).toHaveTextContent(/^Phone changed$/);
    expect(screen.queryByText(/x-old-secret|y-new-secret/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/x-old-secret|y-new-secret/);
  });

  it('never leaks a raw uuid or blank label for an unlabelled column', async () => {
    repo.recordHistory.list.mockResolvedValue({
      events: [ev(1, { changes: { some_new_column: { old: 'a', new: 'b' } } })], nextCursor: null,
    });
    renderIt();
    expect(await screen.findByText('a → b')).toBeInTheDocument();
    expect(screen.getByText('Some new column')).toBeInTheDocument();
  });

  it('renders an audit line as a translated "did X" label; an unknown code reads humanised, never raw (#880, AC-CHG-024)', async () => {
    repo.recordHistory.list.mockResolvedValue({
      events: [
        ev(2, { source: 'audit', seq: null, op: null, action: 'project_document.create', actorId: 'u2', changes: {} }),
        ev(1, { source: 'audit', seq: null, op: null, action: 'brand_new.code_here', actorId: 'u2', changes: {} }),
      ],
      nextCursor: null,
    });
    renderIt();
    expect(await screen.findByText('Project document created')).toBeInTheDocument();
    expect(screen.getByText('Brand new code here')).toBeInTheDocument();
    // both audit rows name their actor (same actor on each row → getAllByText)
    expect(screen.getAllByText('Sam Lead')).toHaveLength(2);
    // the internal codes themselves never render — not for known actions, not for unknown ones
    expect(screen.queryByText(/project_document\.create|brand_new\.code_here/)).toBeNull();
  });

  it('a known audit action reads in Bahasa too (#880, AC-CHG-024)', async () => {
    repo.recordHistory.list.mockResolvedValue({
      events: [ev(1, { source: 'audit', seq: null, op: null, action: 'procurement.approval_route', actorId: 'u2', changes: {} })],
      nextCursor: null,
    });
    renderIt({}, true);
    expect(await screen.findByText('Rute persetujuan dicatat')).toBeInTheDocument();
    expect(screen.queryByText(/procurement\.approval_route/)).toBeNull();
  });

  it('shows the absolute time to the minute, in the row and its tooltip', async () => {
    const at = '2026-10-06T09:41:00Z';
    repo.recordHistory.list.mockResolvedValue({ events: [ev(1, { op: 'insert', createdAt: at })], nextCursor: null });
    renderIt();
    await screen.findByText('Created');
    const time = screen.getByTestId('history-event').querySelector('time')!;
    const expected = formatDateTime(new Date(at));
    expect(time).toHaveTextContent(expected);
    expect(time).toHaveAttribute('title', expected);
    expect(time).toHaveAttribute('dateTime', at);
  });
});

describe('RecordHistory — enum values use the module label helpers (AC-CHG-015)', () => {
  const enumEvents = [
    ev(9, { changes: { award_type: { old: 'direct', new: 'tender' }, bidding_entity: { old: 'alone', new: 'consortium' } } }),
    ev(8, { entityType: 'procurement', entityId: 'pr1', changes: { status: { old: 'Ordered', new: 'Received' } } }),
    ev(7, { entityType: 'work_order', entityId: 'wo1', changes: { status: { old: 'Draft', new: 'Issued' } } }),
    ev(6, { entityType: 'budget_version', entityId: 'bv1', changes: { status: { old: 'Draft', new: 'Active' } } }),
    ev(5, { entityType: 'budget_line_item', entityId: 'li1', changes: { category: { old: 'Labor', new: 'Materials' } } }),
    ev(4, { changes: { tax_treatment: { old: 'exclusive', new: 'inclusive' } } }),
    ev(3, { entityType: 'procurement', entityId: 'pr1', changes: { status: { old: 'Vendor Invoiced', new: 'Paid' } } }),
  ];

  it('en: award type, procurement stage, work order / budget statuses, budget category and tax treatment read as the app labels them', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: enumEvents, nextCursor: null });
    renderIt({ includeChildren: true });
    expect(await screen.findByText('Direct award → Tender')).toBeInTheDocument();
    expect(screen.getByText('Alone → Consortium')).toBeInTheDocument();
    // the same stage word the procurement header pill shows for Received
    expect(screen.getByText('Purchase Order → Goods Receipt')).toBeInTheDocument();
    expect(screen.getByText('Vendor Invoice → Paid')).toBeInTheDocument();
    expect(screen.getByText('Draft → Issued')).toBeInTheDocument();
    expect(screen.getByText('Draft → Active')).toBeInTheDocument();
    expect(screen.getByText('Labor → Materials')).toBeInTheDocument();
    expect(
      screen.getByText('Exclusive — tax is on top of the amount → Inclusive — the amount already includes tax'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/tender → |direct|Received/)).toBeNull();
  });

  it('id: the same values read in Bahasa', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: enumEvents, nextCursor: null });
    renderIt({ includeChildren: true }, true);
    expect(await screen.findByText('Penunjukan langsung → Tender')).toBeInTheDocument();
    expect(screen.getByText('Sendiri → Konsorsium')).toBeInTheDocument();
    expect(screen.getByText('Purchase Order → Penerimaan Barang')).toBeInTheDocument();
    expect(screen.getByText('Invoice Vendor → Lunas')).toBeInTheDocument();
    expect(screen.getByText('Draft → Diterbitkan')).toBeInTheDocument();
    expect(screen.getByText('Draf → Aktif')).toBeInTheDocument();
  });
});

describe('RecordHistory — child records and references on the project History (AC-CHG-015, FR-CHG-012)', () => {
  it('names the child record each event belongs to; a procurement links to its page; an unknown one reads Unavailable', async () => {
    repo.recordHistory.list.mockResolvedValue({
      events: [
        ev(6, { entityType: 'task', entityId: 't1', changes: { name: { old: 'Pump', new: 'Install pump' } } }),
        ev(5, { entityType: 'procurement', entityId: 'pr1', op: 'insert' }),
        ev(4, { entityType: 'work_order', entityId: 'wo1', op: 'insert' }),
        ev(3, { entityType: 'budget_line_item', entityId: 'li1', op: 'insert' }),
        ev(2, { entityType: 'budget_version', entityId: 'bv1', op: 'insert' }),
        ev(1, { entityType: 'task', entityId: 'gone', op: 'insert' }),
      ],
      nextCursor: null,
    });
    renderIt({ includeChildren: true, kindFilters: true });
    expect(await screen.findByText('Task · Install pump')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'PR-0007 Valves' });
    expect(link).toHaveAttribute('href', '/procurement/pr1');
    expect(link.closest('[data-testid="history-event"]')).toHaveTextContent('Procurement · PR-0007 Valves');
    expect(await screen.findByText('Work order · WO-001 Phase 1')).toBeInTheDocument();
    expect(await screen.findByText('Budget line · Site crew')).toBeInTheDocument();
    expect(await screen.findByText('Budget version · Baseline')).toBeInTheDocument();
    expect(screen.getByText('Task · Unavailable')).toBeInTheDocument();
    expect(listProcurementsByProject).toHaveBeenCalledWith('p1');
    expect(repo.task.list).toHaveBeenCalledWith('p1');
  });

  it('resolves milestone / procurement / parent-task refs from the project lists; refs it cannot resolve read "<Field> changed"', async () => {
    repo.recordHistory.list.mockResolvedValue({
      events: [
        ev(3, {
          entityType: 'task', entityId: 't2',
          changes: {
            milestone_id: { old: 'm1', new: 'm2' },
            parent_task_id: { old: null, new: 't1' },
            meeting_id: { old: 'mt1', new: 'mt2' },
          },
        }),
        ev(2, {
          entityType: 'payment', entityId: 'pay1',
          changes: { procurement_id: { old: 'pr2', new: 'pr1' }, invoice_id: { old: null, new: 'i1' } },
        }),
        ev(1, {
          entityType: 'budget_line_item', entityId: 'li1',
          changes: { budget_version_id: { old: 'bv1', new: 'bv2' } },
        }),
      ],
      nextCursor: null,
    });
    renderIt({ includeChildren: true });
    expect(await screen.findByText('Design freeze → Handover')).toBeInTheDocument();
    expect(await screen.findByText('empty → Install pump')).toBeInTheDocument();
    expect(await screen.findByText('Gaskets → PR-0007 Valves')).toBeInTheDocument();
    expect(screen.getByText('Meeting changed')).toBeInTheDocument();
    expect(screen.getByText('Invoice changed')).toBeInTheDocument();
    expect(screen.getByText('Budget version changed')).toBeInTheDocument();
    expect(screen.queryByText(/Unavailable → Unavailable/)).toBeNull();
  });

  it('a project ref on a procurement reads "Project changed" (no uuid, no Unavailable pair)', async () => {
    repo.recordHistory.list.mockResolvedValue({
      events: [ev(1, { entityType: 'procurement', entityId: 'pr1', changes: { project_id: { old: 'p0', new: 'p1' } } })],
      nextCursor: null,
    });
    renderIt({ entityType: 'procurement', entityId: 'pr1' });
    expect(await screen.findByText('Project changed')).toBeInTheDocument();
    // a procurement's own History does not load the project lists
    expect(repo.task.list).not.toHaveBeenCalled();
    expect(listProcurementsByProject).not.toHaveBeenCalled();
  });

  it('a company archived since the change still resolves by id (only the ids missing from the active list are fetched)', async () => {
    repo.company.get.mockImplementation(async (id: string) =>
      id === 'c9' ? { id: 'c9', name: 'Former Client Ltd', archived_at: '2026-10-01T00:00:00Z' } : null,
    );
    repo.recordHistory.list.mockResolvedValue({
      events: [ev(1, { changes: { client_id: { old: 'c9', new: 'c1' } } })], nextCursor: null,
    });
    renderIt();
    expect(await screen.findByText('Former Client Ltd → Acme Corp')).toBeInTheDocument();
    expect(repo.company.get).toHaveBeenCalledWith('c9');
    expect(repo.company.get).not.toHaveBeenCalledWith('c1');
  });

  it('a company reads by the display name the pickers show (short name when set)', async () => {
    repo.company.list.mockResolvedValue([
      { id: 'c1', name: 'Acme Corp', short_name: null },
      { id: 'c3', name: 'Perusahaan Listrik Negara', short_name: 'PLN' },
    ]);
    repo.recordHistory.list.mockResolvedValue({
      events: [ev(1, { changes: { client_id: { old: 'c1', new: 'c3' } } })], nextCursor: null,
    });
    renderIt();
    expect(await screen.findByText('Acme Corp → PLN')).toBeInTheDocument();
  });
});

describe('RecordHistory — purchase documents on the procurement History (#878, AC-CHG-023)', () => {
  it('names each document child from the procurement detail; the project lists stay unloaded', async () => {
    procDetail.data = {
      purchase_requests: [{ id: 'doc1', pr_number: 'PR-878', reference_number: 'Ref A' }],
      rfqs: [],
      purchase_orders: [{ id: 'doc2', po_number: 'PO-878', reference_number: null }],
      payments: [{ id: 'doc3', pay_number: null, reference_number: 'PAY-1' }],
    };
    repo.recordHistory.list.mockResolvedValue({
      events: [
        ev(3, { entityType: 'purchase_order', entityId: 'doc2', op: 'insert', changes: { amount: { old: 1, new: 2 } } }),
        ev(2, { entityType: 'purchase_request', entityId: 'doc1', op: 'insert' }),
        ev(1, { entityType: 'payment', entityId: 'doc3', op: 'insert' }),
      ],
      nextCursor: null,
    });
    renderIt({ entityType: 'procurement', entityId: 'proc1', includeChildren: true });
    expect(await screen.findByText('Purchase order · PO-878')).toBeInTheDocument();
    expect(screen.getByText('Purchase request · PR-878 Ref A')).toBeInTheDocument();
    // no pay_number: the reference alone names it — never a bare "Unavailable" when a number exists
    expect(screen.getByText('Payment · PAY-1')).toBeInTheDocument();
    // a procurement History does not load the project's own lists
    expect(repo.task.list).not.toHaveBeenCalled();
    expect(listProcurementsByProject).not.toHaveBeenCalled();
  });
});

describe('RecordHistory — field labels reuse the forms\' own words (AC-CHG-015)', () => {
  const labelEvent = ev(1, {
    changes: {
      code: { old: 'A', new: 'B' },
      end_client_id: { old: 'c1', new: 'c2' },
      customer_contract_ref: { old: 'PO-1', new: 'PO-2' },
      award_type: { old: null, new: 'tender' },
    },
  });

  it('en: Client Project Code, End customer, Customer PO ref, Award type; a procurement code stays "Code"', async () => {
    repo.recordHistory.list.mockResolvedValue({
      events: [labelEvent, ev(2, { entityType: 'procurement', entityId: 'pr1', changes: { code: { old: 'X1', new: 'X2' } } })],
      nextCursor: null,
    });
    renderIt({ includeChildren: true });
    expect((await screen.findByText('A → B')).closest('li')).toHaveTextContent('Client Project Code');
    expect((await screen.findByText('Acme Corp → Globex')).closest('li')).toHaveTextContent('End customer');
    expect(screen.getByText('PO-1 → PO-2').closest('li')).toHaveTextContent('Customer PO ref');
    expect(screen.getByText('empty → Tender').closest('li')).toHaveTextContent('Award type');
    expect(screen.getByText('X1 → X2').closest('li')).toHaveTextContent(/^Code: X1 → X2$/);
  });

  it('id: Kode Proyek Klien, Pelanggan akhir, Ref PO klien, Jenis perolehan; the Work orders chip matches its tab', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: [labelEvent], nextCursor: null });
    renderIt({ includeChildren: true, kindFilters: true }, true);
    expect((await screen.findByText('A → B')).closest('li')).toHaveTextContent('Kode Proyek Klien');
    expect(screen.getByText('PO-1 → PO-2').closest('li')).toHaveTextContent('Ref PO klien');
    expect(screen.getByText('kosong → Tender').closest('li')).toHaveTextContent('Jenis perolehan');
    expect((await screen.findByText('Acme Corp → Globex')).closest('li')).toHaveTextContent('Pelanggan akhir');
    expect(screen.getByRole('button', { name: 'Work Order' })).toBeInTheDocument();
  });
});

describe('RecordHistory — states (AC-CHG-016)', () => {
  it('shows a skeleton while loading', () => {
    repo.recordHistory.list.mockReturnValue(new Promise(() => {}));
    renderIt();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('empty copy says the month history begins and that deletes and earlier edits are not shown', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: [], nextCursor: null });
    renderIt();
    expect(await screen.findByText('No changes recorded yet')).toBeInTheDocument();
    expect(screen.getByText(/History begins October 2026\..*deletions.*not shown/s)).toBeInTheDocument();
  });

  it('error state offers retry that refetches', async () => {
    repo.recordHistory.list.mockRejectedValueOnce(new Error('boom'));
    repo.recordHistory.list.mockResolvedValueOnce({ events: [ev(1, { op: 'insert' })], nextCursor: null });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Created')).toBeInTheDocument();
  });

  it('"Load older" fetches the next page by the seq cursor and appends it', async () => {
    const cursor = { seq: 2, at: '2026-10-06T09:00:00Z' };
    repo.recordHistory.list
      .mockResolvedValueOnce({ events: [ev(3, { op: 'insert' })], nextCursor: cursor })
      .mockResolvedValueOnce({ events: [ev(2, { changes: { name: { old: 'A', new: 'B' } } })], nextCursor: null });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Load older' }));
    expect(await screen.findByText('A → B')).toBeInTheDocument();
    expect(repo.recordHistory.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor }));
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });

  it('"Load older" keeps keyboard focus while fetching (aria-disabled, never disabled) and ignores repeat presses', async () => {
    const cursor = { seq: 2, at: '2026-10-06T09:00:00Z' };
    let release: (v: unknown) => void = () => {};
    repo.recordHistory.list
      .mockResolvedValueOnce({ events: [ev(3, { op: 'insert' })], nextCursor: cursor })
      .mockReturnValueOnce(new Promise((r) => { release = r; }));
    renderIt();
    const button = await screen.findByRole('button', { name: 'Load older' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(repo.recordHistory.list).toHaveBeenCalledTimes(2);
    release({ events: [ev(2, { changes: { name: { old: 'A', new: 'B' } } })], nextCursor: { seq: 1, at: cursor.at } });
    expect(await screen.findByText('A → B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load older' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Load older' })).not.toHaveAttribute('aria-disabled', 'true');
  });
});

describe('RecordHistory — project kind filter (FR-CHG-012)', () => {
  it('requests children and narrows by the chosen kind', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: [], nextCursor: null });
    renderIt({ includeChildren: true, kindFilters: true });
    await screen.findByText('No changes recorded yet');
    expect(repo.recordHistory.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeChildren: true, entityTypes: null }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    await waitFor(() =>
      expect(repo.recordHistory.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeChildren: true, entityTypes: ['task'] }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-pressed', 'true');
    const group = screen.getByRole('group', { name: 'Filter by record kind' });
    expect(within(group).getAllByRole('button')).toHaveLength(6);
  });

  it('a kind with no events says so, not the "history begins" copy', async () => {
    repo.recordHistory.list.mockImplementation(async (q: { entityTypes: string[] | null }) =>
      q.entityTypes ? { events: [], nextCursor: null } : { events: [ev(1, { op: 'insert' })], nextCursor: null },
    );
    renderIt({ includeChildren: true, kindFilters: true });
    await screen.findByText('Created');
    await userEvent.click(screen.getByRole('button', { name: 'Work orders' }));
    expect(await screen.findByText('No work order changes')).toBeInTheDocument();
    expect(screen.queryByText('No changes recorded yet')).toBeNull();
    expect(screen.queryByText(/History begins/)).toBeNull();
  });

  it('chips use the list chip size and the active nav tokens', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: [], nextCursor: null });
    renderIt({ includeChildren: true, kindFilters: true });
    await screen.findByText('No changes recorded yet');
    const all = screen.getByRole('button', { name: 'All' });
    expect(all).toHaveClass('h-7', 'text-xs', 'rounded-full', 'bg-primary/10', 'text-nav-active-text');
    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveClass('h-7', 'text-xs', 'text-muted-foreground');
  });
});
