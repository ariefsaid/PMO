import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import idAdministration from '../../../public/locales/id/administration.json';
import type {
  ConnectCensusRow,
  ConnectProposal,
  IntegrationsRepository,
} from '@/src/lib/repositories/types';
import { ConnectProposalReview } from './ConnectProposalReview';

const mockIntegrationsRepo = vi.hoisted(() => ({
  getConnectStatus: vi.fn<IntegrationsRepository['getConnectStatus']>(),
  listConnectProposals: vi.fn<IntegrationsRepository['listConnectProposals']>(),
  acceptConnectProposals: vi.fn<IntegrationsRepository['acceptConnectProposals']>(),
  decideConnectReview: vi.fn<IntegrationsRepository['decideConnectReview']>(),
  unlinkConnectMatch: vi.fn<IntegrationsRepository['unlinkConnectMatch']>(),
  searchConnectStaged: vi.fn(),
  listConnectUnlinkableMatches: vi.fn(),
  startConnectCensus: vi.fn<IntegrationsRepository['startConnectCensus']>(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    integrations: mockIntegrationsRepo,
  },
}));

function renderWithRole(role: string | null, ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={role as never}>
        {ui}
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}

const readyStatus = (census: ConnectCensusRow[], waitingForSend = 0) => ({
  run: { id: 'run-1', state: 'ready' as const, finished_at: 'now', error_class: null },
  census,
  waitingForSend,
});

/** The picker's search field (the popup input), not its same-named trigger button. */
const pickerSearch = async () =>
  (await screen.findAllByRole('combobox', { name: /^(search|cari) /i })).find((el) => el.tagName === 'INPUT')!;

describe('ConnectProposalReview (AC-ECA-003, FR-ECA-012, FR-ECA-042)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the administration catalogue for Indonesian review-list actions', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([{
      kind: 'party',
      pmo_count: 1,
      erp_count: 1,
      linked_count: 0,
      inactive_erp_count: 0,
      scenario: 'S-D',
      accepted_at: null,
    }]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({ proposals: [], nextAfterId: null });

    const previousLanguage = i18next.language;
    i18next.addResourceBundle('id', 'administration', idAdministration, true, true);
    try {
      await i18next.changeLanguage('id');
      renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

      expect(await screen.findByRole('heading', { name: 'Cocokkan data' })).toBeInTheDocument();
      expect(
        within(await screen.findByTestId('connect-kind-party')).getByRole('button', { name: 'Tinjau daftar' }),
      ).toBeInTheDocument();
    } finally {
      cleanup();
      await i18next.changeLanguage(previousLanguage || 'en');
      i18next.removeResourceBundle('id', 'administration');
    }
  });

  it('AC-ECA-003 accept all applies 35 rows after one confirm stating the counts and leaves 2 review rows open', async () => {
    const partyProposals: ConnectProposal[] = [
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `link-${i}`,
        kind: 'party' as const,
        outcome: 'link' as const,
        reason: null,
        pmo_ids: [`pmo-${i}`],
        external_ids: [`ext-${i}`],
        reason_text: null,
        snapshot: { name: `Partner ${i}` },
        state: 'open' as const,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `bring-${i}`,
        kind: 'party' as const,
        outcome: 'bring-in' as const,
        reason: null,
        pmo_ids: [],
        external_ids: [`erp-bring-${i}`],
        reason_text: null,
        snapshot: { name: `Connected Partner ${i}` },
        state: 'open' as const,
      })),
      {
        id: 'review-1',
        kind: 'party' as const,
        outcome: 'review' as const,
        reason: null,
        pmo_ids: ['pmo-rev-1'],
        external_ids: ['ext-rev-1a', 'ext-rev-1b'],
        reason_text: 'Two or more records could be this one',
        snapshot: { name: 'Acme Corp' },
        state: 'open' as const,
      },
      {
        id: 'review-2',
        kind: 'party' as const,
        outcome: 'review' as const,
        reason: null,
        pmo_ids: ['pmo-rev-2'],
        external_ids: ['ext-rev-2'],
        reason_text: 'Tax numbers do not match',
        snapshot: { name: 'Beta Ltd' },
        state: 'open' as const,
      },
    ];

    const census: ConnectCensusRow[] = [
      {
        kind: 'party',
        pmo_count: 35,
        erp_count: 40,
        linked_count: 30,
        inactive_erp_count: 0,
        scenario: 'S-D',
        accepted_at: null,
      },
    ];

    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus(census));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: partyProposals,
      nextAfterId: null,
    });
    mockIntegrationsRepo.acceptConnectProposals.mockResolvedValue({
      counts: { party: { link: 30, bring_in: 5, send: 0, left_open: 2 } },
      remaining: 2,
    });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    expect(await screen.findByText('Clients & vendors')).toBeInTheDocument();

    const partyCard = screen.getByTestId('connect-kind-party');
    const partyAcceptBtn = within(partyCard).getByRole('button', { name: 'Accept all' });
    fireEvent.click(partyAcceptBtn);

    // ConfirmDialog text reads: "Link 30 records and bring 5 into PMO? 2 need a decision and are left as they are."
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText('Link 30 records and bring 5 into PMO? 2 need a decision and are left as they are.'),
    ).toBeInTheDocument();

    // Confirm
    const confirmBtn = within(dialog).getByRole('button', { name: 'Accept all' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockIntegrationsRepo.acceptConnectProposals).toHaveBeenCalledWith('erpnext', 'party', null);
    });

    // The two review rows still render with "Needs a decision"
    fireEvent.click(within(partyCard).getByRole('button', { name: 'Review list' }));
    expect(await screen.findByTestId('connect-review-list-row-review-1')).toBeInTheDocument();
    expect(screen.getByTestId('connect-review-list-row-review-2')).toBeInTheDocument();
    expect(screen.getAllByText('Needs a decision').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Beta Ltd').length).toBeGreaterThanOrEqual(1);
  });

  it('FR-ECA-012 "Accept all" accepts every kind in one action after one confirm', async () => {
    const proposals: ConnectProposal[] = [
      {
        id: 'p-link-1',
        kind: 'party',
        outcome: 'link',
        reason: null,
        pmo_ids: ['p1'],
        external_ids: ['e1'],
        reason_text: null,
        snapshot: { name: 'Company A' },
        state: 'open',
      },
      {
        id: 'item-link-1',
        kind: 'item',
        outcome: 'link',
        reason: null,
        pmo_ids: ['i1'],
        external_ids: ['ei1'],
        reason_text: null,
        snapshot: { name: 'Item X' },
        state: 'open',
      },
      {
        id: 'left-open-1',
        kind: 'party',
        outcome: 'review',
        reason: null,
        pmo_ids: ['p2'],
        external_ids: ['e2'],
        reason_text: 'This row could not be applied',
        snapshot: { name: 'Company Unapplied' },
        state: 'open',
      },
    ];

    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'party', pmo_count: 2, erp_count: 2, linked_count: 1, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null },
      { kind: 'item', pmo_count: 1, erp_count: 1, linked_count: 1, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals,
      nextAfterId: null,
    });
    mockIntegrationsRepo.acceptConnectProposals.mockResolvedValue({
      counts: { party: { link: 1, bring_in: 0, send: 0, left_open: 1 }, item: { link: 1, bring_in: 0, send: 0, left_open: 0 } },
      remaining: 1,
    });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    expect(await screen.findByText('Clients & vendors')).toBeInTheDocument();

    // Top-level Accept all (the header button renders before the per-kind cards)
    const topAcceptAll = screen.getAllByRole('button', { name: 'Accept all' })[0];
    fireEvent.click(topAcceptAll);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept all' }));

    await waitFor(() => {
      expect(mockIntegrationsRepo.acceptConnectProposals).toHaveBeenCalledWith('erpnext', null, null);
    });

    // A row left open by the accept shows its plain reason
    fireEvent.click(within(screen.getByTestId('connect-kind-party')).getByRole('button', { name: 'Review list' }));
    expect(await screen.findByText(/This row could not be applied/)).toBeInTheDocument();
  });

  it('FR-ECA-042 purchase documents in the connected system are counted and point to the purchase link screen', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      {
        kind: 'purchase',
        pmo_count: 0,
        erp_count: 7,
        linked_count: 0,
        inactive_erp_count: 0,
        scenario: null,
        accepted_at: null,
      },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: [],
      nextAfterId: null,
    });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    const note = await screen.findByTestId('connect-purchase-note');
    expect(note).toBeInTheDocument();
    expect(
      within(note).getByText('7 purchase documents are in your connected system.'),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Link them to PMO purchases' });
    expect(link).toHaveAttribute('href', '/procurement#erp-documents');
  });

  it('FR-ECA-042 domain row with erp_count null says it has not been checked, never "0"', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      {
        kind: 'purchase',
        pmo_count: 0,
        erp_count: null,
        linked_count: 0,
        inactive_erp_count: 0,
        scenario: null,
        accepted_at: null,
      },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: [],
      nextAfterId: null,
    });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    // A domain-only census is NOT the empty state
    expect(screen.queryByText('Nothing to set up')).not.toBeInTheDocument();
    const note = await screen.findByTestId('connect-purchase-note');
    expect(within(note).getByText('Not checked in your connected system yet')).toBeInTheDocument();
    expect(screen.queryByText('0 purchase documents are in your connected system')).not.toBeInTheDocument();
  });

  it('renders per-kind census lines without integration-system jargon (FR-ECA-002, NFR-ECA-006)', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      {
        kind: 'party',
        pmo_count: 12,
        erp_count: 40,
        linked_count: 9,
        inactive_erp_count: 0,
        scenario: 'S-D',
        accepted_at: null,
      },
      {
        kind: 'item',
        pmo_count: 8,
        erp_count: 12,
        linked_count: 8,
        inactive_erp_count: 0,
        scenario: 'S-D',
        accepted_at: null,
      },
      {
        kind: 'project',
        pmo_count: 42,
        erp_count: 57,
        linked_count: 38,
        inactive_erp_count: 0,
        scenario: 'S-D',
        accepted_at: null,
      },
    ]));

    const projectProposals: ConnectProposal[] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `send-${i}`,
        kind: 'project' as const,
        outcome: 'send' as const,
        reason: null,
        pmo_ids: [`pmo-p-${i}`],
        external_ids: [],
        reason_text: null,
        snapshot: {},
        state: 'open' as const,
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        id: `bring-${i}`,
        kind: 'project' as const,
        outcome: 'bring-in' as const,
        reason: null,
        pmo_ids: [],
        external_ids: [`erp-p-${i}`],
        reason_text: null,
        snapshot: {},
        state: 'open' as const,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `rev-${i}`,
        kind: 'project' as const,
        outcome: 'review' as const,
        reason: null,
        pmo_ids: [`pmo-rev-${i}`],
        external_ids: [`erp-rev-${i}`],
        reason_text: 'Two or more records could be this one',
        snapshot: {},
        state: 'open' as const,
      })),
    ];

    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: projectProposals,
      nextAfterId: null,
    });

    const { container } = renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    // FR-ECA-002's exact plain line, and the same shape for another kind and different numbers (no hard-coded copy)
    expect(await screen.findByText('12 vendors in PMO, 40 in the connected system, 9 are the same')).toBeInTheDocument();
    expect(screen.getByText('8 in PMO, 12 in the connected system, 8 are the same')).toBeInTheDocument();
    expect(
      screen.getByText('42 in PMO, 57 in the connected system: 38 are the same, 4 will be sent, 15 brought in, 2 need you'),
    ).toBeInTheDocument();

    // NFR-ECA-006: no raw doctype names in user copy
    expect(container.textContent).not.toMatch(/\bSupplier\b/);
    expect(container.textContent).not.toMatch(/\bCustomer\b/);
    expect(container.textContent).not.toMatch(/\bERP(?:Next)?\b/i);
  });

  it('AC-ECA-017 an unclear row uses the shared staged search picker and can be linked', async () => {
    const proposals: ConnectProposal[] = [
      {
        id: 'review-ambiguous-1',
        kind: 'party',
        outcome: 'review',
        reason: null,
        pmo_ids: ['pmo-1'],
        external_ids: ['erp-1', 'erp-2'],
        reason_text: 'Two or more records could be this one',
        snapshot: { name: 'Acme Candidate' },
        state: 'open',
        pmo_name: 'Acme PMO',
        erp_name: 'Acme Connected Record',
      },
    ];

    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'party', pmo_count: 1, erp_count: 2, linked_count: 0, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals,
      nextAfterId: null,
    });
    mockIntegrationsRepo.searchConnectStaged.mockResolvedValue([
      { external_id: 'erp-1', name: 'Acme Candidate', code: 'AC-1' },
    ]);
    mockIntegrationsRepo.decideConnectReview.mockResolvedValue(undefined);

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
    const partyCard = await screen.findByTestId('connect-kind-party');
    fireEvent.click(within(partyCard).getByRole('button', { name: 'Review list' }));
    const row = await screen.findByTestId('connect-review-list-row-review-ambiguous-1');
    expect(within(row).getByText('Acme PMO')).toBeInTheDocument();
    expect(within(row).getByText('Acme Connected Record')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Change' }));
    fireEvent.click(within(row).getByRole('combobox', { name: 'Search records' }));
    fireEvent.change(await pickerSearch(), { target: { value: 'Acme' } });
    const candidateOption = await screen.findByRole('option', { name: /Acme Candidate/ });
    fireEvent.click(candidateOption);

    await waitFor(() => {
      expect(mockIntegrationsRepo.decideConnectReview).toHaveBeenCalledWith('erpnext', 'review-ambiguous-1', {
        action: 'link',
        pmoId: 'pmo-1',
        externalId: 'erp-1',
      });
    });
  });

  it('AC-ECA-017 an unclear ERP-only party row can be brought into PMO as new', async () => {
    const proposal: ConnectProposal = {
      id: 'unclear-erp-only', kind: 'party', outcome: 'review', reason: 'ambiguous',
      pmo_ids: [], external_ids: ['Supplier:existing-erp-record'], reason_text: 'Needs a decision',
      snapshot: { name: 'Connected Company' }, state: 'open',
    };
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'party', pmo_count: 0, erp_count: 1, linked_count: 0, inactive_erp_count: 0, scenario: 'S-C', accepted_at: null },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({ proposals: [proposal], nextAfterId: null });
    mockIntegrationsRepo.decideConnectReview.mockResolvedValue(undefined);

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
    const card = await screen.findByTestId('connect-kind-party');
    fireEvent.click(within(card).getByRole('button', { name: 'Review list' }));
    const row = await screen.findByTestId('connect-review-list-row-unclear-erp-only');
    fireEvent.click(within(row).getByRole('button', { name: 'Change' }));
    fireEvent.click(within(row).getByRole('combobox', { name: 'Search records' }));
    fireEvent.click(await screen.findByRole('option', { name: /Add as new in PMO/ }));

    await waitFor(() => expect(mockIntegrationsRepo.decideConnectReview).toHaveBeenCalledWith('erpnext', 'unclear-erp-only', {
      action: 'bring-in', externalId: 'Supplier:existing-erp-record',
    }));
  });

  it('AC-ECA-017 a suggested link can be changed to create its PMO record in the connected system', async () => {
    const proposal: ConnectProposal = {
      id: 'suggested-link', kind: 'party', outcome: 'link', reason: null,
      pmo_ids: ['pmo-1'], external_ids: ['Supplier:old-match'], reason_text: null,
      snapshot: { name: 'Old match' }, state: 'open', pmo_name: 'PMO Company', erp_name: 'Old match',
    };
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'party', pmo_count: 1, erp_count: 1, linked_count: 0, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockImplementation(async (_tier, _kind, _outcome, _afterId, state) => ({
      proposals: state === 'open' ? [proposal] : [], nextAfterId: null,
    }));
    mockIntegrationsRepo.decideConnectReview.mockResolvedValue(undefined);

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
    fireEvent.click(within(await screen.findByTestId('connect-kind-party')).getByRole('button', { name: 'Review list' }));
    const row = await screen.findByTestId('connect-review-list-row-suggested-link');
    fireEvent.click(within(row).getByRole('button', { name: 'Change' }));
    fireEvent.click(within(row).getByRole('combobox', { name: 'Search records' }));
    fireEvent.click(await screen.findByRole('option', { name: /Create as new in the connected system/ }));

    await waitFor(() => expect(mockIntegrationsRepo.decideConnectReview).toHaveBeenCalledWith('erpnext', 'suggested-link', {
      action: 'send', pmoId: 'pmo-1',
    }));
  });

  it('FR-ECA-012 item, account, and people rows lead with names and keep connected ids in a reference disclosure', async () => {
    const proposals: ConnectProposal[] = [
      { id: 'item-name', kind: 'item', outcome: 'link', reason: null, pmo_ids: ['PMO Item Name'], external_ids: ['ERP-ITEM-40'], reason_text: null, snapshot: { itemName: 'Connected Item Name' }, state: 'open' },
      { id: 'account-name', kind: 'account', outcome: 'link', reason: null, pmo_ids: ['Labor'], external_ids: ['ERP-ACCOUNT-40'], reason_text: null, snapshot: { accountName: 'Wages Account' }, state: 'open' },
      { id: 'employee-name', kind: 'employee', outcome: 'link', reason: null, pmo_ids: ['employee-uuid'], external_ids: ['EMP-104'], reason_text: null, snapshot: { employeeName: 'ERP Person Name' }, state: 'open', pmo_name: 'PMO Person Name' },
    ];
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      ...(['item', 'account', 'employee'] as const).map((kind) => ({ kind, pmo_count: 1, erp_count: 1, linked_count: 0, inactive_erp_count: 0, scenario: 'S-D' as const, accepted_at: null })),
    ]));
    mockIntegrationsRepo.listConnectProposals.mockImplementation(async (_tier, kind, _outcome, _afterId, state) => ({
      proposals: state === 'open' ? proposals.filter((proposal) => proposal.kind === kind) : [], nextAfterId: null,
    }));

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
    for (const entry of [
      { kind: 'item', id: 'item-name', pmo: 'PMO Item Name', erp: 'Connected Item Name', externalId: 'ERP-ITEM-40' },
      { kind: 'account', id: 'account-name', pmo: 'Labor', erp: 'Wages Account', externalId: 'ERP-ACCOUNT-40' },
      { kind: 'employee', id: 'employee-name', pmo: 'PMO Person Name', erp: 'ERP Person Name', externalId: 'EMP-104' },
    ]) {
      const card = await screen.findByTestId(`connect-kind-${entry.kind}`);
      fireEvent.click(within(card).getByRole('button', { name: 'Review list' }));
      const row = await screen.findByTestId(`connect-review-list-row-${entry.id}`);
      expect(within(row).getAllByText(entry.pmo).length).toBeGreaterThan(0);
      expect(within(row).getByText(entry.erp)).toBeInTheDocument();
      const reference = within(row).getByTestId('record-reference');
      expect(reference).toHaveTextContent(entry.externalId);
      expect(reference.querySelector('code')).toHaveClass('font-mono');
      fireEvent.click(within(card).getByRole('button', { name: 'Close list' }));
    }
  });

  it('FR-ECA-018 staged search options wrap full names and show a distinguishing code on a second line', async () => {
    const longNames = [
      'PT Mutiara Engineering Surabaya Barat',
      'PT Mutiara Engineering Surabaya Timur',
    ];
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'party', pmo_count: 1, erp_count: 2, linked_count: 0, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({ proposals: [
      { id: 'long-search', kind: 'party', outcome: 'review', reason: 'ambiguous', pmo_ids: ['pmo-1'], external_ids: ['candidate-1', 'candidate-2'], reason_text: null, snapshot: {}, state: 'open' },
    ], nextAfterId: null });
    mockIntegrationsRepo.searchConnectStaged.mockResolvedValue([
      { external_id: 'supplier-1', name: longNames[0], code: 'NPWP 01.234.567.8' },
      { external_id: 'supplier-2', name: longNames[1], code: 'NPWP 09.876.543.2' },
    ]);

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
    const card = await screen.findByTestId('connect-kind-party');
    fireEvent.click(within(card).getByRole('button', { name: 'Review list' }));
    const row = await screen.findByTestId('connect-review-list-row-long-search');
    fireEvent.click(within(row).getByRole('button', { name: 'Change' }));
    fireEvent.click(within(row).getByRole('combobox', { name: 'Search records' }));
    fireEvent.change(await pickerSearch(), { target: { value: 'Mutiara' } });

    for (const [index, name] of longNames.entries()) {
      const option = await screen.findByRole('option', { name: new RegExp(name) });
      const fullName = option.querySelector('.whitespace-normal');
      expect(fullName?.textContent).toContain(name);
      expect(fullName).toHaveClass('whitespace-normal');
      expect(within(option).getByText(index === 0 ? 'NPWP 01.234.567.8' : 'NPWP 09.876.543.2')).toBeInTheDocument();
    }
    expect(mockIntegrationsRepo.searchConnectStaged).toHaveBeenCalledWith('erpnext', 'party', 'Mutiara');
  });

  it('FR-ECA-018 typed search replaces old results immediately and ignores late responses', async () => {
    let resolveMutiara: ((rows: Array<{ external_id: string; name: string; code: string }>) => void) | undefined;
    let resolveLatest: ((rows: Array<{ external_id: string; name: string; code: string }>) => void) | undefined;
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'party', pmo_count: 1, erp_count: 2, linked_count: 0, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({ proposals: [
      { id: 'query-row', kind: 'party', outcome: 'review', reason: 'ambiguous', pmo_ids: ['pmo-1'], external_ids: ['candidate-1', 'candidate-2'], reason_text: null, snapshot: {}, state: 'open' },
    ], nextAfterId: null });
    mockIntegrationsRepo.searchConnectStaged.mockImplementation((_tier, _kind, query) => {
      if (query === 'Sinar') return Promise.resolve([{ external_id: 'sinar', name: 'PT Sinar Daya', code: 'SIN-1' }]);
      if (query === 'Mutiara') return new Promise((resolve) => { resolveMutiara = resolve; });
      if (query === 'Mutiara Baru') return new Promise((resolve) => { resolveLatest = resolve; });
      return Promise.resolve([]);
    });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
    const card = await screen.findByTestId('connect-kind-party');
    fireEvent.click(within(card).getByRole('button', { name: 'Review list' }));
    const row = await screen.findByTestId('connect-review-list-row-query-row');
    fireEvent.click(within(row).getByRole('button', { name: 'Change' }));
    fireEvent.click(within(row).getByRole('combobox', { name: 'Search records' }));
    const searchbox = await pickerSearch();

    fireEvent.change(searchbox, { target: { value: 'Sinar' } });
    expect(await screen.findByRole('option', { name: /PT Sinar Daya/ })).toBeInTheDocument();
    fireEvent.change(searchbox, { target: { value: 'Mutiara' } });
    expect(screen.queryByRole('option', { name: /PT Sinar Daya/ })).toBeNull();
    await waitFor(() => expect(mockIntegrationsRepo.searchConnectStaged).toHaveBeenCalledWith('erpnext', 'party', 'Mutiara'));
    fireEvent.change(searchbox, { target: { value: 'Mutiara Baru' } });
    await waitFor(() => expect(mockIntegrationsRepo.searchConnectStaged).toHaveBeenCalledWith('erpnext', 'party', 'Mutiara Baru'));

    resolveLatest?.([{ external_id: 'latest', name: 'PT Mutiara Baru', code: 'MUT-2' }]);
    expect(await screen.findByRole('option', { name: /PT Mutiara Baru/ })).toBeInTheDocument();
    resolveMutiara?.([{ external_id: 'stale', name: 'PT Mutiara Lama', code: 'MUT-1' }]);
    await waitFor(() => expect(screen.getByRole('option', { name: /PT Mutiara Baru/ })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: /PT Mutiara Lama/ })).toBeNull();
  });

  it('FR-ECA-042 item census copy uses the connected-system wording in English and Indonesian', async () => {
    const census = [{ kind: 'item' as const, pmo_count: 3, erp_count: 4, linked_count: 2, inactive_erp_count: 0, scenario: 'S-D' as const, accepted_at: null }];
    const previousLanguage = i18next.language;
    i18next.addResourceBundle('id', 'administration', idAdministration, true, true);
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus(census));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({ proposals: [], nextAfterId: null });
    try {
      await i18next.changeLanguage('en');
      const english = renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
      const englishCard = await screen.findByTestId('connect-kind-item');
      expect(englishCard.textContent).toContain('3 in PMO, 4 in the connected system, 2 are the same');
      expect(englishCard.textContent).not.toContain('3 items in PMO');
      english.unmount();

      await i18next.changeLanguage('id');
      renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
      expect((await screen.findByTestId('connect-kind-item')).textContent).toContain('3 di PMO, 4 di sistem yang terhubung, 2 data sama');
    } finally {
      cleanup();
      await i18next.changeLanguage(previousLanguage || 'en');
      i18next.removeResourceBundle('id', 'administration');
    }
  });

  it('FR-ECA-042 keeps an unticked review-row checkbox empty with a visible focus outline', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'party', pmo_count: 1, erp_count: 1, linked_count: 0, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: [{
        id: 'selectable-row', kind: 'party', outcome: 'send', reason: null,
        pmo_ids: ['pmo-1'], external_ids: [], reason_text: null,
        snapshot: { name: 'Acme Corp' }, state: 'open',
      }],
      nextAfterId: null,
    });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
    const card = await screen.findByTestId('connect-kind-party');
    fireEvent.click(within(card).getByRole('button', { name: 'Review list' }));
    const row = await screen.findByTestId('connect-review-list-row-selectable-row');
    const checkbox = within(row).getByRole('checkbox', { name: 'Select Acme Corp' });

    fireEvent.click(checkbox);

    await waitFor(() => expect(checkbox).toHaveAttribute('aria-checked', 'false'));
    expect(checkbox).toHaveClass(
      'border-input',
      'bg-background',
      'hover:bg-background',
      'focus-visible:bg-background',
      'focus-visible:outline',
      'focus-visible:outline-2',
      'focus-visible:outline-offset-2',
      'focus-visible:outline-ring',
      'transition-none',
    );
    expect(checkbox).not.toHaveClass('bg-primary');
  });

  it('shows staging state with "Reading records from your connected system…" and polls', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue({
      run: { id: 'run-1', state: 'staging', finished_at: null, error_class: null },
      census: [],
      waitingForSend: 0,
    });
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: [],
      nextAfterId: null,
    });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    expect(await screen.findByText('Reading records from your connected system…')).toBeInTheDocument();
  });

  it('shows error state with plain words and retry button', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue({
      run: { id: 'run-1', state: 'failed', finished_at: 'now', error_class: 'network-timeout' },
      census: [],
      waitingForSend: 0,
    });
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: [],
      nextAfterId: null,
    });
    mockIntegrationsRepo.startConnectCensus.mockResolvedValue({ runId: 'run-2', census: [] });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    expect(await screen.findByText('Could not read records')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockIntegrationsRepo.startConnectCensus).toHaveBeenCalledWith('erpnext');
    });
  });

  it('shows empty state when nothing to set up', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: [],
      nextAfterId: null,
    });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    expect(await screen.findByText('Nothing to set up')).toBeInTheDocument();
    expect(screen.getByText('No records to set up. All records are connected.')).toBeInTheDocument();
  });

  it('shows all-clear state when all records are connected', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'party', pmo_count: 10, erp_count: 10, linked_count: 10, inactive_erp_count: 0, scenario: 'S-D', accepted_at: '2026-11-01' },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: [
        { id: 'app-1', kind: 'party', outcome: 'link', reason: null, pmo_ids: ['p1'], external_ids: ['e1'], reason_text: null, snapshot: {}, state: 'applied' },
      ],
      nextAfterId: null,
    });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    expect(await screen.findByText('All records connected')).toBeInTheDocument();
    expect(screen.getByText('All records are connected. Everything is up to date.')).toBeInTheDocument();
  });

  it('shows inline sending progress "Sending 4 of 12" from the queued and pending send rows', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'party', pmo_count: 12, erp_count: 12, linked_count: 0, inactive_erp_count: 0, scenario: 'S-C', accepted_at: null },
    ], 4));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: Array.from({ length: 12 }, (_, i) => ({
        id: `send-${i}`,
        kind: 'party' as const,
        outcome: 'send' as const,
        reason: null,
        pmo_ids: [`p-${i}`],
        external_ids: [],
        reason_text: null,
        snapshot: { name: `Vendor ${i}` },
        state: (i < 4 ? 'sending' : 'open') as 'sending' | 'open',
      })),
      nextAfterId: null,
    });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    expect(await screen.findByText('Sending 4 of 12')).toBeInTheDocument();
  });

  it('labels people the connected system cannot take in English and Indonesian', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'employee', pmo_count: 2, erp_count: 0, linked_count: 0, inactive_erp_count: 0, scenario: 'S-C', accepted_at: null },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: [
        {
          id: 'emp-1',
          kind: 'employee',
          outcome: 'send',
          reason: null,
          pmo_ids: ['emp-pmo-1'],
          external_ids: [],
          reason_text: 'The connected system requires birth date and gender, add these in the connected system by hand',
          snapshot: { name: 'Alice Smith' },
          state: 'open',
        },
        {
          id: 'emp-2',
          kind: 'employee',
          outcome: 'send',
          reason: null,
          pmo_ids: ['emp-pmo-2'],
          external_ids: [],
          reason_text: 'Add these in the connected system by hand',
          snapshot: { name: 'Bob Jones' },
          state: 'open',
        },
      ],
      nextAfterId: null,
    });

    const previousLanguage = i18next.language;
    i18next.addResourceBundle('id', 'administration', idAdministration, true, true);
    try {
      await i18next.changeLanguage('en');
      const english = renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
      expect(await screen.findByText('Add these in the connected system by hand')).toBeInTheDocument();
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
      english.unmount();

      await i18next.changeLanguage('id');
      renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
      expect(await screen.findByText('Tambahkan orang-orang ini secara manual di sistem yang terhubung')).toBeInTheDocument();
    } finally {
      cleanup();
      await i18next.changeLanguage(previousLanguage || 'en');
      i18next.removeResourceBundle('id', 'administration');
    }
  });

  // Role gating: all six roles checked
  const ALL_SIX_ROLES = [
    { role: 'Admin', canGlobalAccept: true, canAccountAccept: true, canPartyAccept: true },
    { role: 'Finance', canGlobalAccept: false, canAccountAccept: true, canPartyAccept: false },
    { role: 'Executive', canGlobalAccept: false, canAccountAccept: false, canPartyAccept: false },
    { role: 'Project Manager', canGlobalAccept: false, canAccountAccept: false, canPartyAccept: false },
    { role: 'Engineer', canGlobalAccept: false, canAccountAccept: false, canPartyAccept: false },
    { role: null, canGlobalAccept: false, canAccountAccept: false, canPartyAccept: false },
  ];

  it.each(ALL_SIX_ROLES)(
    'gates affordances correctly for role: $role (all six roles checked)',
    async ({ role, canGlobalAccept, canAccountAccept, canPartyAccept }) => {
      mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
        { kind: 'party', pmo_count: 5, erp_count: 5, linked_count: 5, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null },
        { kind: 'account', pmo_count: 3, erp_count: 3, linked_count: 3, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null },
      ]));
      mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
        proposals: [
          { id: 'p1', kind: 'party', outcome: 'link', reason: null, pmo_ids: ['p1'], external_ids: ['e1'], reason_text: null, snapshot: { name: 'P1' }, state: 'open' },
          { id: 'a1', kind: 'account', outcome: 'link', reason: null, pmo_ids: ['a1'], external_ids: ['ea1'], reason_text: null, snapshot: { name: 'A1' }, state: 'open' },
        ],
        nextAfterId: null,
      });

      renderWithRole(role, <ConnectProposalReview tier='erpnext' orgId='org-1' />);

      expect(await screen.findByText('Clients & vendors')).toBeInTheDocument();

      // Top-level Accept all
      const topAcceptAll = screen.queryByText('Read only. Only administrators can accept all record matches.');
      if (canGlobalAccept) {
        expect(topAcceptAll).not.toBeInTheDocument();
      } else {
        expect(topAcceptAll).toBeInTheDocument();
      }

      // Party card accept
      const partyCard = screen.getByTestId('connect-kind-party');
      const partyAccept = within(partyCard).queryByRole('button', { name: 'Accept all' });
      if (canPartyAccept) {
        expect(partyAccept).toBeInTheDocument();
      } else {
        expect(partyAccept).toBeNull();
      }

      // Accounts card accept
      const accountCard = screen.getByTestId('connect-kind-account');
      const accountAccept = within(accountCard).queryByRole('button', { name: 'Accept all' });
      if (canAccountAccept) {
        expect(accountAccept).toBeInTheDocument();
      } else {
        expect(accountAccept).toBeNull();
      }
    },
  );

  it('AC-ECA-016 unticking one paged row accepts the remaining rows by exclusion', async () => {
    const proposals: ConnectProposal[] = [
      { id: 'proposal-1', kind: 'party', outcome: 'link', reason: null, pmo_ids: ['p1'], external_ids: ['e1'], reason_text: null, snapshot: { name: 'Connected One' }, state: 'open', pmo_name: 'Partner One', erp_name: 'Connected One' },
      { id: 'proposal-2', kind: 'party', outcome: 'link', reason: null, pmo_ids: ['p2'], external_ids: ['e2'], reason_text: null, snapshot: { name: 'Connected Two' }, state: 'open', pmo_name: 'Partner Two', erp_name: 'Connected Two' },
    ];
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue({
      ...readyStatus([{ kind: 'party', pmo_count: 2, erp_count: 2, linked_count: 0, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null }]),
      proposalCounts: { party: { link: 2, bring_in: 0, send: 0, review: 0 } },
    } as never);
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({ proposals, nextAfterId: null });
    mockIntegrationsRepo.acceptConnectProposals.mockResolvedValue({ counts: {}, remaining: 0 });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
    const partyCard = await screen.findByTestId('connect-kind-party');
    fireEvent.click(within(partyCard).getByRole('button', { name: 'Review list' }));
    const selectedRow = await screen.findByTestId('connect-review-list-row-proposal-1');
    expect(within(selectedRow).getByText('Partner One')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Partner One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept 1 selected' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept selected' }));

    await waitFor(() => {
      expect(mockIntegrationsRepo.acceptConnectProposals).toHaveBeenCalledWith('erpnext', 'party', null, ['proposal-1']);
    });
  });

  it('AC-ECA-017 Change searches staged records and links the chosen record', async () => {
    const proposal: ConnectProposal = {
      id: 'proposal-change', kind: 'party', outcome: 'link', reason: null, pmo_ids: ['pmo-1'], external_ids: ['old-id'],
      reason_text: null, snapshot: { name: 'Old Connected Name' }, state: 'open',
    };
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue({
      ...readyStatus([{ kind: 'party', pmo_count: 1, erp_count: 2, linked_count: 0, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null }]),
      proposalCounts: { party: { link: 1, bring_in: 0, send: 0, review: 0 } },
    } as never);
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({ proposals: [proposal], nextAfterId: null });
    mockIntegrationsRepo.searchConnectStaged.mockResolvedValue([
      { external_id: 'new-id', name: 'New Connected Name', code: 'N-1' },
    ]);
    mockIntegrationsRepo.decideConnectReview.mockResolvedValue(undefined);

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
    fireEvent.click(within(await screen.findByTestId('connect-kind-party')).getByRole('button', { name: 'Review list' }));
    const row = await screen.findByTestId('connect-review-list-row-proposal-change');
    fireEvent.click(within(row).getByRole('button', { name: 'Change' }));
    fireEvent.click(within(row).getByRole('combobox', { name: 'Search records' }));
    fireEvent.change(await pickerSearch(), { target: { value: 'New' } });
    const option = await screen.findByRole('option', { name: /New Connected Name/ });
    fireEvent.click(option);

    await waitFor(() => {
      expect(mockIntegrationsRepo.decideConnectReview).toHaveBeenCalledWith('erpnext', 'proposal-change', {
        action: 'link', pmoId: 'pmo-1', externalId: 'new-id',
      });
    });
  });

  it('AC-ECA-019 only links that can still be removed show Undo', async () => {
    const applied: ConnectProposal[] = [
      { id: 'safe-link', kind: 'party', outcome: 'link', reason: null, pmo_ids: ['p1'], external_ids: ['e1'], reason_text: null, snapshot: { name: 'Partner One' }, state: 'applied', pmo_name: 'Partner One', erp_name: 'Connected One', can_unlink: true },
      { id: 'used-link', kind: 'party', outcome: 'link', reason: null, pmo_ids: ['p2'], external_ids: ['e2'], reason_text: null, snapshot: { name: 'Partner Two' }, state: 'applied', pmo_name: 'Partner Two', erp_name: 'Connected Two', can_unlink: false },
    ];
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue({
      ...readyStatus([{ kind: 'party', pmo_count: 2, erp_count: 2, linked_count: 2, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null }]),
      proposalCounts: { party: { link: 0, bring_in: 0, send: 0, review: 0, applied_link: 2 } },
    } as never);
    mockIntegrationsRepo.listConnectProposals.mockImplementation(async (_tier, _kind, _outcome, _afterId, state) => ({
      proposals: state === 'applied' ? applied : [], nextAfterId: null,
    }));
    mockIntegrationsRepo.unlinkConnectMatch.mockResolvedValue(undefined);

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
    fireEvent.click(within(await screen.findByTestId('connect-kind-party')).getByRole('button', { name: 'Review list' }));
    const safeRow = await screen.findByTestId('connect-review-list-row-safe-link');
    const usedRow = await screen.findByTestId('connect-review-list-row-used-link');
    expect(within(safeRow).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(within(usedRow).queryByRole('button', { name: 'Undo' })).toBeNull();
    fireEvent.click(within(safeRow).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(mockIntegrationsRepo.unlinkConnectMatch).toHaveBeenCalledWith('erpnext', 'safe-link'));
  });

  it('AC-ECA-020 read-only roles see no Accept, Change, Undo, or row selection', async () => {
    const proposals: ConnectProposal[] = [
      { id: 'readonly-open', kind: 'party', outcome: 'link', reason: null, pmo_ids: ['p1'], external_ids: ['e1'], reason_text: null, snapshot: { name: 'Partner One' }, state: 'open' },
      { id: 'readonly-applied', kind: 'party', outcome: 'link', reason: null, pmo_ids: ['p2'], external_ids: ['e2'], reason_text: null, snapshot: { name: 'Partner Two' }, state: 'applied', can_unlink: true },
    ];
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue({
      ...readyStatus([{ kind: 'party', pmo_count: 2, erp_count: 2, linked_count: 1, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null }]),
      proposalCounts: { party: { link: 1, bring_in: 0, send: 0, review: 0, applied_link: 1 } },
    } as never);
    mockIntegrationsRepo.listConnectProposals.mockImplementation(async (_tier, _kind, _outcome, _afterId, state) => ({
      proposals: state === 'applied' ? [proposals[1]] : [proposals[0]], nextAfterId: null,
    }));

    renderWithRole('Engineer', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
    const partyCard = await screen.findByTestId('connect-kind-party');
    expect(within(partyCard).queryByRole('button', { name: 'Accept all' })).toBeNull();
    fireEvent.click(within(partyCard).getByRole('button', { name: 'Review list' }));
    const openRow = await screen.findByTestId('connect-review-list-row-readonly-open');
    const appliedRow = await screen.findByTestId('connect-review-list-row-readonly-applied');
    expect(within(openRow).queryByRole('button', { name: 'Change' })).toBeNull();
    expect(within(openRow).queryByRole('checkbox')).toBeNull();
    expect(within(appliedRow).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  describe('FR-ECA-001 census starts when the review opens', () => {
    const noRun = { run: null, census: [], waitingForSend: 0 } as never;
    const none = { proposals: [], nextAfterId: null };

    it('starts the census exactly once when there is no run, and shows the reading state', async () => {
      mockIntegrationsRepo.getConnectStatus.mockResolvedValue(noRun);
      mockIntegrationsRepo.listConnectProposals.mockResolvedValue(none);
      mockIntegrationsRepo.startConnectCensus.mockResolvedValue({ runId: 'run-1', census: [] });

      renderWithRole('Admin', <React.StrictMode><ConnectProposalReview tier='erpnext' orgId='org-1' /></React.StrictMode>);

      expect(await screen.findByText('Reading records from your connected system…')).toBeInTheDocument();
      await waitFor(() => expect(mockIntegrationsRepo.startConnectCensus).toHaveBeenCalledTimes(1));
      expect(mockIntegrationsRepo.startConnectCensus).toHaveBeenCalledWith('erpnext');
    });

    it('does not start the census when a run already exists', async () => {
      mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([]));
      mockIntegrationsRepo.listConnectProposals.mockResolvedValue(none);

      renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

      expect(await screen.findByText('Nothing to set up')).toBeInTheDocument();
      expect(mockIntegrationsRepo.startConnectCensus).not.toHaveBeenCalled();
    });

    it('does not start the census for a role that may not run it', async () => {
      mockIntegrationsRepo.getConnectStatus.mockResolvedValue(noRun);
      mockIntegrationsRepo.listConnectProposals.mockResolvedValue(none);

      renderWithRole('Viewer', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

      await screen.findByText('Nothing to set up');
      expect(mockIntegrationsRepo.startConnectCensus).not.toHaveBeenCalled();
    });

    it('lands a failed start in the error state', async () => {
      mockIntegrationsRepo.getConnectStatus.mockResolvedValue(noRun);
      mockIntegrationsRepo.listConnectProposals.mockResolvedValue(none);
      mockIntegrationsRepo.startConnectCensus.mockRejectedValue(new Error('boom'));

      renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

      expect(await screen.findByText('Could not read records')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('Re-check on the ready state re-runs the census and refetches status', async () => {
      mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
        { kind: 'party', pmo_count: 3, erp_count: 0, linked_count: 0, inactive_erp_count: 0, scenario: 'S-A', accepted_at: null },
      ]));
      mockIntegrationsRepo.listConnectProposals.mockResolvedValue(none);
      mockIntegrationsRepo.startConnectCensus.mockResolvedValue({ runId: 'run-2', census: [] });

      renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

      const btn = await screen.findByRole('button', { name: 'Check again' });
      const before = mockIntegrationsRepo.getConnectStatus.mock.calls.length;
      fireEvent.click(btn);

      await waitFor(() => expect(mockIntegrationsRepo.startConnectCensus).toHaveBeenCalledWith('erpnext'));
      await waitFor(() => expect(mockIntegrationsRepo.getConnectStatus.mock.calls.length).toBeGreaterThan(before));
    });

    it('Re-check shows on the empty state too, and not for a read-only role', async () => {
      mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([]));
      mockIntegrationsRepo.listConnectProposals.mockResolvedValue(none);

      const { unmount } = renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
      expect(await screen.findByRole('button', { name: 'Check again' })).toBeInTheDocument();
      unmount();

      renderWithRole('Viewer', <ConnectProposalReview tier='erpnext' orgId='org-1' />);
      await screen.findByText('Nothing to set up');
      expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    });
  });
});

// plain-words C20-3b: the review row names the records a person is deciding between. The raw
// record ids are reference material and sit behind a disclosure on the Admin surface.
describe('Connect review record references (plain-words C20-3b)', () => {
  const PMO_ID = 'c1f0a7d2-9b3e-4c58-8f61-2d4b7a9e0c33';

  it('C20-3b: a review row names both records and keeps the raw ids inside a reference disclosure', async () => {
    const proposal: ConnectProposal = {
      id: 'item-review-1',
      kind: 'item',
      outcome: 'review',
      reason: 'ambiguous',
      pmo_ids: [PMO_ID],
      external_ids: ['ACC-BRK-01'],
      reason_text: 'Two or more records could be this one',
      snapshot: { name: 'Brake pad set' },
      state: 'open',
      pmo_name: 'Brake pad set',
      erp_name: 'Brake pad set (connected system)',
    };

    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'item', pmo_count: 1, erp_count: 1, linked_count: 0, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({ proposals: [proposal], nextAfterId: null });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    fireEvent.click(within(await screen.findByTestId('connect-kind-item')).getByRole('button', { name: 'Review list' }));
    const row = await screen.findByTestId('connect-review-list-row-item-review-1');

    expect(row).toHaveTextContent('PMO record: Brake pad set');
    expect(row).toHaveTextContent('Linked record: Brake pad set (connected system)');

    const reference = within(row).getByTestId('record-reference');
    expect(reference.tagName).toBe('DETAILS');
    expect(within(reference).getByText('Reference')).toBeInTheDocument();
    expect(reference).toHaveTextContent(PMO_ID);
    expect((reference as HTMLDetailsElement).open).toBe(false);
  });
});
