/**
 * WorkOrdersTab — the client's inbound POs and the controls around them (#566).
 *
 * What is worth pinning here, in order of consequence:
 *   1. The over-commitment path. Issuing goes out with NO acknowledgement; the server's refusal is
 *      put in front of the user; only a SECOND, separate confirm sends the acknowledgement. An
 *      auto-retry would turn `over_commit_ack_by` from "a person chose this" into a formality.
 *   2. Nothing writes on a single click — every status move is one-way and there is no undo.
 *   3. The affordances match what the server will actually honour: no Edit or Set value on a row
 *      that has left Draft (the body freezes, DD-WO-5), nothing at all for an Engineer.
 *   4. OD-TAX-1: no bare money figure — every order value renders with its tax basis.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import type { Role } from '@/src/auth/AuthContext';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { listState, drawdownState, mutations } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  drawdownState: {
    data: { committed: 0, draft: 0, ceiling: 1_000_000, currency: 'USD', basis: 'net' } as unknown,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    setValue: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectWorkOrders: () => listState,
  useProjectDrawdown: () => drawdownState,
  useWorkOrderMutations: () => mutations,
}));

let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: realRole }),
}));

import WorkOrdersTab from '../tabs/WorkOrdersTab';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const row = (over: Partial<WorkOrderRow> = {}): WorkOrderRow =>
  ({
    id: 'wo-1',
    org_id: 'org-1',
    project_id: 'p1',
    wo_number: null,
    client_po_number: 'PO-77',
    title: 'Phase 1 fabrication',
    description: null,
    status: 'Draft',
    order_value: 250_000,
    currency: 'USD',
    tax_treatment: 'exclusive',
    tax_amount: 27_500,
    tax_rate: 11,
    tax_template: null,
    order_date: '2026-08-01',
    start_date: null,
    end_date: null,
    order_value_set_by: 'u-2',
    order_value_set_at: '2026-08-01T00:00:00Z',
    issued_by: null,
    issued_at: null,
    over_commit_ack_by: null,
    over_commit_ack_at: null,
    closed_at: null,
    cancelled_at: null,
    created_at: '2026-08-01T00:00:00Z',
    ...over,
  }) as WorkOrderRow;

const renderTab = (role: Role = 'Project Manager') => {
  realRole = role;
  return render(
    <ToastProvider>
      <WorkOrdersTab projectId="p1" currency="USD" />
    </ToastProvider>,
  );
};

beforeEach(() => {
  listState.data = [];
  listState.isPending = false;
  listState.isError = false;
  listState.refetch.mockClear();
  for (const m of Object.values(mutations)) {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  }
  realRole = 'Project Manager';
});

// ── List states ───────────────────────────────────────────────────────────────

describe('list states', () => {
  it('renders the empty state when the project has no work orders yet', () => {
    renderTab();
    expect(screen.getByText('No work orders on this project yet')).toBeInTheDocument();
  });

  it('renders a loading state, not an empty one, while the list is in flight', () => {
    listState.isPending = true;
    renderTab();
    expect(screen.queryByText('No work orders on this project yet')).not.toBeInTheDocument();
  });

  it('renders an error with a retry when the list fails', async () => {
    listState.isError = true;
    renderTab();
    expect(screen.getByText('Couldn’t load the work orders')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(listState.refetch).toHaveBeenCalled();
  });
});

// ── The rows ──────────────────────────────────────────────────────────────────

describe('the rows', () => {
  it('OD-TAX-1: an order value never renders bare — it carries its tax basis', () => {
    listState.data = [
      row({ id: 'wo-1', tax_treatment: 'exclusive' }),
      row({ id: 'wo-2', tax_treatment: 'inclusive', order_value: 111_000, wo_number: 'WO-0001', status: 'Issued' }),
    ];
    renderTab();
    expect(screen.getByTestId('wo-value-wo-1')).toHaveTextContent('$250,000 excl. PPN');
    expect(screen.getByTestId('wo-value-wo-2')).toHaveTextContent('$111,000 incl. PPN');
  });

  it('says a draft has no WO number yet rather than showing an empty cell', () => {
    listState.data = [row({ wo_number: null })];
    renderTab();
    expect(screen.getByText('Not issued yet')).toBeInTheDocument();
  });
});

// ── Affordances match what the server will honour ─────────────────────────────

describe('authorization (UX gate; the RPCs are the authority)', () => {
  it('a PM gets create, edit, set-value, issue and cancel on a draft', () => {
    listState.data = [row()];
    renderTab('Project Manager');
    expect(screen.getByRole('button', { name: 'New work order' })).toBeInTheDocument();
    for (const name of ['Edit', 'Set value', 'Issue', 'Cancel']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('an Engineer may READ work orders but gets no write affordance anywhere', () => {
    listState.data = [row()];
    renderTab('Engineer');
    expect(screen.getByText('Phase 1 fabrication')).toBeInTheDocument();
    for (const name of ['New work order', 'Edit', 'Set value', 'Issue', 'Cancel']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('an ISSUED row offers Close and Cancel but neither Edit nor Set value (the body freezes)', () => {
    listState.data = [row({ status: 'Issued', wo_number: 'WO-0001' })];
    renderTab('Project Manager');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set value' })).not.toBeInTheDocument();
  });

  it('a terminal row offers nothing — Closed and Cancelled are the end of the line', () => {
    listState.data = [
      row({ id: 'wo-1', status: 'Closed', wo_number: 'WO-0001' }),
      row({ id: 'wo-2', status: 'Cancelled', wo_number: 'WO-0002' }),
    ];
    renderTab('Project Manager');
    for (const name of ['Edit', 'Set value', 'Issue', 'Close', 'Cancel']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});

// ── Confirm-before-write ──────────────────────────────────────────────────────

describe('nothing writes on a single click', () => {
  it('Issue asks first, and only the confirm sends the transition', async () => {
    listState.data = [row()];
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    expect(mutations.transition.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Issue this work order?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Issue work order' }));
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'wo-1', to: 'Issued' }),
    );
  });

  it('Cancel asks first and sends no acknowledgement with the cancel', async () => {
    listState.data = [row()];
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mutations.transition.mutateAsync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel work order' }));
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'wo-1', to: 'Cancelled' }),
    );
    // DD-WO-10: the RPC refuses an acknowledgement on a non-issue transition.
    expect(mutations.transition.mutateAsync.mock.calls[0][0]).not.toHaveProperty(
      'overCommitAck',
      true,
    );
  });

  it('abandoning the confirm writes nothing', async () => {
    listState.data = [row()];
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    // Scoped to the dialog: the row's own destructive "Cancel" carries the same accessible name,
    // and clicking THAT would open a second confirm rather than dismissing this one.
    const dialog = within(screen.getByRole('dialog'));
    await userEvent.click(dialog.getByRole('button', { name: /^Cancel$/ }));
    expect(mutations.transition.mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByText('Issue this work order?')).not.toBeInTheDocument();
  });
});

// ── The over-commitment path ──────────────────────────────────────────────────

const OVER_COMMIT_REFUSAL = new AppError(
  'issuing this work order would commit 1200000 against a contract ceiling of 1000000 ' +
    '(already committed: 900000): this is allowed, but it must be acknowledged explicitly — ' +
    're-issue with the over-commitment acknowledgement so the decision is recorded against your name',
  'P0001',
);

describe('over-commitment: the server refuses, the human answers, nothing auto-retries', () => {
  beforeEach(() => {
    listState.data = [row()];
  });

  it('shows the server’s own refusal — the figures come from the authority, not from a stale cache', async () => {
    mutations.transition.mutateAsync.mockRejectedValueOnce(OVER_COMMIT_REFUSAL);
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Issue work order' }));

    await waitFor(() =>
      expect(screen.getByText('This would go past the contract ceiling')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('wo-over-commit-message')).toHaveTextContent(
      'must be acknowledged explicitly',
    );
    // The first attempt carried NO acknowledgement — the RPC is asked, never assumed.
    expect(mutations.transition.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'wo-1', to: 'Issued' });
  });

  it('sends the acknowledgement only after a SECOND, explicit confirm', async () => {
    mutations.transition.mutateAsync.mockRejectedValueOnce(OVER_COMMIT_REFUSAL);
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Issue work order' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Acknowledge and issue' })).toBeInTheDocument(),
    );
    // Still exactly one call: showing the dialog is not a retry.
    expect(mutations.transition.mutateAsync).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge and issue' }));
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenLastCalledWith({
        id: 'wo-1',
        to: 'Issued',
        overCommitAck: true,
      }),
    );
  });

  it('declining the acknowledgement issues nothing', async () => {
    mutations.transition.mutateAsync.mockRejectedValueOnce(OVER_COMMIT_REFUSAL);
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Issue work order' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Acknowledge and issue' })).toBeInTheDocument(),
    );

    const ack = within(screen.getByRole('alertdialog'));
    await userEvent.click(ack.getByRole('button', { name: /^Cancel$/ }));
    expect(mutations.transition.mutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Acknowledge and issue' })).not.toBeInTheDocument();
  });

  it('a DIFFERENT refusal is reported, not dressed up as an over-commitment', async () => {
    mutations.transition.mutateAsync.mockRejectedValueOnce(
      new AppError(
        'you set this work order’s value yourself, so you cannot also issue it',
        '42501',
      ),
    );
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Issue work order' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Acknowledge and issue' })).not.toBeInTheDocument(),
    );
    expect(mutations.transition.mutateAsync).toHaveBeenCalledTimes(1);
  });
});
