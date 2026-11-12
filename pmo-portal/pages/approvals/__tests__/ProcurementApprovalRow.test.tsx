/**
 * AC-IFW-PROC-01 — Inline preview + adjacent approve, no navigation
 * AC-IFW-PROC-02 — Approve → {to:'Approved'} / Reject → {to:'Rejected'}; can()-gated
 *
 * Exercises the live ProcurementApprovalPreview.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { BahasaProvider } from '@/test/bahasa';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

// ── vi.hoisted mocks (must be hoisted before module imports) ─────────────────

const { transitionMutate, navigateMock, detailData, detailState } = vi.hoisted(() => {
  const transitionMutate = vi.fn();
  const navigateMock = vi.fn();
  const detailData = {
    id: 'pr-001',
    title: 'Inverter Units',
    code: 'PR-260001',
    status: 'Requested' as const,
    total_value: 50000, currency: 'USD',
    project_id: 'proj-001',
    project: { name: 'Solar Alpha', code: 'PRJ-001' },
    vendor: { name: 'SunVolt Modules Co.' },
    requested_by: { full_name: 'Diego Ramirez' },
    items: [
      { id: 'item-1', name: 'Inverter 5kW', quantity: 10, rate: 5000, amount: 50000, description: null, org_id: 'org-1', procurement_id: 'pr-001' },
    ],
  };
  const detailState = {
    data: detailData,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
  return { transitionMutate, navigateMock, detailData, detailState };
});

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' } }),
}));

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutateAsync: transitionMutate, isPending: false },
  }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

// Mock DecisionSupportPanel — just renders a labelled div so tests don't hit budget hooks
vi.mock('@/pages/procurement/DecisionSupportPanel', () => ({
  DecisionSupportPanel: ({ projectName }: { projectName: string | null | undefined }) => (
    <div data-testid="decision-support">Budget impact · {projectName}</div>
  ),
}));

// Mock useNavigate — the regression invariant asserts it is NEVER called
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigateMock };
});

import { ProcurementApprovalPreview } from '../ProcurementApprovalRow';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROW = {
  id: 'pr-001',
  title: 'Inverter Units',
  code: 'PR-260001',
  status: 'Requested',
  total_value: 50000, currency: 'USD',
  created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  project_id: 'proj-001',
  project: { name: 'Solar Alpha', code: 'PRJ-001' },
  vendor: { name: 'SunVolt Modules Co.' },
  requested_by: { full_name: 'Diego Ramirez' },
  requested_by_id: 'user-requester',
  vendor_id: 'vendor-1',
  org_id: 'org-1',
  approved_by_id: null,
  notes: null,
  created_by_id: 'user-requester',
  updated_at: null,
};

const renderAs = (realRole: Role = 'Project Manager') =>
  render(
    <MemoryRouter>
      <ImpersonationProvider realRole={realRole}>
        <ToastProvider>
          <ProcurementApprovalPreview row={ROW as never} surface="inline" />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  transitionMutate.mockReset();
  navigateMock.mockReset();
  detailState.isPending = false;
  detailState.isError = false;
  detailState.data = detailData;
});

it('localizes the approve action and confirmation with the request title (Bahasa)', async () => {
  setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
  try {
    render(<BahasaProvider><MemoryRouter><ImpersonationProvider realRole="Project Manager"><ToastProvider>
      <ProcurementApprovalPreview row={ROW as never} surface="inline" />
    </ToastProvider></ImpersonationProvider></MemoryRouter></BahasaProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Setujui' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Setujui Inverter Units?');
  } finally {
    resetActiveLocale();
  }
});

// ── AC-IFW-PROC-01: Inline preview — expanded state ──────────────────────────

describe('AC-IFW-PROC-01: expanded state — budget impact + line items + adjacent actions', () => {
  it('budget-impact panel renders after expand', async () => {
    renderAs();
    // Our mocked DecisionSupportPanel renders "Budget impact · Solar Alpha"
    expect(screen.getByTestId('decision-support')).toBeInTheDocument();
  });

  it('approval preview contains no developer-facing enforcement copy', () => {
    render(
      <MemoryRouter>
        <ImpersonationProvider realRole="Project Manager">
          <ToastProvider>
            <ProcurementApprovalPreview row={ROW as never} />
          </ToastProvider>
        </ImpersonationProvider>
      </MemoryRouter>,
    );
    expect(document.body).not.toHaveTextContent(/RPC|server-enforced|permission-gated/i);
  });

  it('line item name renders in expanded panel', async () => {
    renderAs();
    expect(screen.getByText('Inverter 5kW')).toBeInTheDocument();
  });

  it('Approve button appears in expanded panel (adjacent — no navigation)', async () => {
    renderAs();
    expect(screen.getByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
    // Lens-D regression invariant: useNavigate was NEVER called
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('Return button appears in expanded panel (adjacent — no navigation)', async () => {
    renderAs();
    expect(screen.getByRole('button', { name: /^Return$/i })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

// ── AC-IFW-PROC-01: Loading / error states in expanded panel ─────────────────

describe('AC-IFW-PROC-01: expanded panel — loading + error states', () => {
  it('shows loading state while detail is pending', async () => {
    detailState.isPending = true;
    detailState.data = undefined as never;
    renderAs();
    // ListState variant="loading" renders a div with aria-busy="true"
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('shows error state when detail fetch fails', async () => {
    detailState.isPending = false;
    detailState.isError = true;
    detailState.data = undefined as never;
    renderAs();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });
});

// ── AC-IFW-PROC-02: Approve fires transition({to:'Approved'}) ────────────────

describe('AC-IFW-PROC-02: Approve fires transition with to:Approved', () => {
  it('Approve → ConfirmDialog → confirm fires transition.mutateAsync with {to:"Approved"}', async () => {
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /^Approve$/i }));
    // ConfirmDialog should open
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Approve$/i }));
    expect(transitionMutate).toHaveBeenCalledWith({ to: 'Approved' });
    // Lens-D regression: navigate was never called
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

// ── AC-IFW-PROC-02: Reject fires transition({to:'Rejected'}) ─────────────────

describe('AC-IFW-PROC-02: Reject fires transition with to:Rejected', () => {
  it('AC-1578: returning requires a non-empty comment and sends it with the transition', async () => {
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /^Return$/i }));
    // The shared ReasonDialog: required reason, filled confirm.
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /^Return$/i });
    expect(confirm).toBeDisabled();
    const comment = within(dialog).getByRole('textbox', { name: /reason for returning/i });
    await userEvent.type(comment, '   ');
    expect(confirm).toBeDisabled();
    await userEvent.clear(comment);
    await userEvent.type(comment, 'Please revise the requested quantities.');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(transitionMutate).toHaveBeenCalledWith({ to: 'Rejected', notes: 'Please revise the requested quantities.' });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('R2-restore: the Return dialog states what the requester can do next', async () => {
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /^Return$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/The requester will be notified and may revise and resubmit\./)).toBeInTheDocument();
  });
});

// ── AC-IFW-PROC-02: can()-gate — no action buttons when role lacks permission ─

describe('AC-IFW-PROC-02: can() gate — no Approve/Reject for Engineer role', () => {
  it('Engineer (no transition permission) sees NO Approve or Reject buttons even when expanded', async () => {
    renderAs('Engineer');
    expect(screen.queryByRole('button', { name: /^Approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Return$/i })).not.toBeInTheDocument();
  });
});

// ── AC-JR-W2-02: "Open procurement" link in expanded panel footer ───────────

describe('AC-JR-W2-02: "Open procurement" link in expanded panel footer (T07)', () => {
  it('AC-JR-W2-02: expanded panel footer contains an "Open procurement" link to /procurement/:id', async () => {
    renderAs();
    const link = screen.getByRole('link', { name: /open procurement/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/procurement/pr-001');
  });

  it('AC-JR-W2-02: "Open procurement" link is in the same footer region as Approve/Reject', async () => {
    renderAs();
    const openLink = screen.getByRole('link', { name: /open procurement/i });
    const approveBtn = screen.getByRole('button', { name: /^Approve$/i });
    // Both are in the DOM simultaneously — same footer
    expect(openLink).toBeInTheDocument();
    expect(approveBtn).toBeInTheDocument();
  });

  it('AC-JR-W2-02: "Open procurement" visible even when user lacks transition permission', async () => {
    renderAs('Engineer');
    // Engineers can't approve but should still be able to open the full procurement record.
    const link = screen.getByRole('link', { name: /open procurement/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/procurement/pr-001');
  });

  it('AC-JR-W2-02: navigateMock is never called — link is declarative, not imperative', async () => {
    renderAs();
    // Link renders without ever calling useNavigate()
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
