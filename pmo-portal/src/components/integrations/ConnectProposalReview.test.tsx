import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
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

describe('ConnectProposalReview (AC-ECA-003, FR-ECA-012, FR-ECA-042)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-ECA-003 accept all applies 35 rows after one confirm stating the counts and leaves 2 review rows open', async () => {
    const partyProposals: ConnectProposal[] = [
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `link-${i}`,
        kind: 'party' as const,
        outcome: 'link' as const,
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
        pmo_ids: [],
        external_ids: [`erp-bring-${i}`],
        reason_text: null,
        snapshot: { name: `ERP Partner ${i}` },
        state: 'open' as const,
      })),
      {
        id: 'review-1',
        kind: 'party' as const,
        outcome: 'review' as const,
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
    expect(screen.getAllByText('Needs a decision').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Beta Ltd')).toBeInTheDocument();
  });

  it('FR-ECA-012 "Accept all" accepts every kind in one action after one confirm', async () => {
    const proposals: ConnectProposal[] = [
      {
        id: 'p-link-1',
        kind: 'party',
        outcome: 'link',
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
    expect(await screen.findByText('This row could not be applied')).toBeInTheDocument();
  });

  it('FR-ECA-042 purchase documents in the ERP are counted and point to the purchase link screen', async () => {
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
      within(note).getByText('7 purchase documents are in the ERP.'),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Link them to PMO purchases' });
    expect(link).toHaveAttribute('href', '/procurement#erp-documents');
  });

  it('FR-ECA-042 domain row with erp_count null reads "Not checked for this ERP yet", never "0"', async () => {
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
    expect(within(note).getByText('Not checked for this ERP yet')).toBeInTheDocument();
    expect(screen.queryByText('0 purchase documents are in the ERP')).not.toBeInTheDocument();
  });

  it('renders per-kind census lines without doctype jargon (FR-ECA-002, NFR-ECA-006)', async () => {
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
    expect(await screen.findByText('12 vendors in PMO, 40 in the ERP, 9 are the same')).toBeInTheDocument();
    expect(screen.getByText('8 items in PMO, 12 in the ERP, 8 are the same')).toBeInTheDocument();
    expect(
      screen.getByText('42 in PMO, 57 in the ERP: 38 are the same, 4 will be sent, 15 brought in, 2 need you'),
    ).toBeInTheDocument();

    // NFR-ECA-006: no raw doctype names in user copy
    expect(container.textContent).not.toMatch(/\bSupplier\b/);
    expect(container.textContent).not.toMatch(/\bCustomer\b/);
  });

  it('review row "Choose" opens a Combobox of its candidates and calls decideConnectReview', async () => {
    const proposals: ConnectProposal[] = [
      {
        id: 'review-ambiguous-1',
        kind: 'party',
        outcome: 'review',
        pmo_ids: ['pmo-1'],
        external_ids: ['erp-1', 'erp-2'],
        reason_text: 'Two or more records could be this one',
        snapshot: { name: 'Acme Candidate' },
        state: 'open',
      },
    ];

    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'party', pmo_count: 1, erp_count: 2, linked_count: 0, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals,
      nextAfterId: null,
    });
    mockIntegrationsRepo.decideConnectReview.mockResolvedValue(undefined);

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    expect(await screen.findByText('Acme Candidate')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));

    // Combobox appears with the row's candidates
    const combobox = screen.getByRole('combobox', { name: 'Choose' });
    expect(combobox).toBeInTheDocument();
    fireEvent.click(combobox);

    // Pick candidate
    const candidateOption = await screen.findByRole('option', { name: /erp-1/ });
    fireEvent.click(candidateOption);

    await waitFor(() => {
      expect(mockIntegrationsRepo.decideConnectReview).toHaveBeenCalledWith('erpnext', 'review-ambiguous-1', {
        action: 'link',
        pmoId: 'pmo-1',
        externalId: 'erp-1',
      });
    });
  });

  it('shows staging state with "Reading records from the ERP…" and polls', async () => {
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

    expect(await screen.findByText('Reading records from the ERP…')).toBeInTheDocument();
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
        { id: 'app-1', kind: 'party', outcome: 'link', pmo_ids: ['p1'], external_ids: ['e1'], reason_text: null, snapshot: {}, state: 'applied' },
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

  it('lists people the ERP cannot take as "Add these in the ERP by hand"', async () => {
    mockIntegrationsRepo.getConnectStatus.mockResolvedValue(readyStatus([
      { kind: 'employee', pmo_count: 2, erp_count: 0, linked_count: 0, inactive_erp_count: 0, scenario: 'S-C', accepted_at: null },
    ]));
    mockIntegrationsRepo.listConnectProposals.mockResolvedValue({
      proposals: [
        {
          id: 'emp-1',
          kind: 'employee',
          outcome: 'send',
          pmo_ids: ['emp-pmo-1'],
          external_ids: [],
          reason_text: 'The ERP requires birth date and gender, add these in the ERP by hand',
          snapshot: { name: 'Alice Smith' },
          state: 'open',
        },
        {
          id: 'emp-2',
          kind: 'employee',
          outcome: 'send',
          pmo_ids: ['emp-pmo-2'],
          external_ids: [],
          reason_text: 'Add these in the ERP by hand',
          snapshot: { name: 'Bob Jones' },
          state: 'open',
        },
      ],
      nextAfterId: null,
    });

    renderWithRole('Admin', <ConnectProposalReview tier='erpnext' orgId='org-1' />);

    expect(await screen.findByText('Add these in the ERP by hand')).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
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
          { id: 'p1', kind: 'party', outcome: 'link', pmo_ids: ['p1'], external_ids: ['e1'], reason_text: null, snapshot: { name: 'P1' }, state: 'open' },
          { id: 'a1', kind: 'account', outcome: 'link', pmo_ids: ['a1'], external_ids: ['ea1'], reason_text: null, snapshot: { name: 'A1' }, state: 'open' },
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
});
