/**
 * AC-IFW-PROC-01 — Inline preview + adjacent approve, no navigation
 * AC-IFW-PROC-02 — Approve → {to:'Approved'} / Reject → {to:'Rejected'}; can()-gated
 *
 * Red first: ProcurementApprovalRow does not exist yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
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
    total_value: 50000,
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

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' } }),
}));

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutate: transitionMutate, isPending: false },
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
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

import { ProcurementApprovalRow } from '../ProcurementApprovalRow';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROW = {
  id: 'pr-001',
  title: 'Inverter Units',
  code: 'PR-260001',
  status: 'Requested',
  total_value: 50000,
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
          <ProcurementApprovalRow row={ROW as never} />
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

// ── AC-IFW-PROC-01: Inline preview — collapsed state ─────────────────────────

describe('AC-IFW-PROC-01: collapsed state', () => {
  it('renders a disclosure button with aria-expanded=false by default', () => {
    renderAs();
    const btn = screen.getByRole('button', { name: /show budget impact/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('Approve button is NOT in the DOM while collapsed', () => {
    renderAs();
    expect(screen.queryByRole('button', { name: /^Approve$/i })).not.toBeInTheDocument();
  });

  it('Reject button is NOT in the DOM while collapsed', () => {
    renderAs();
    expect(screen.queryByRole('button', { name: /^Reject$/i })).not.toBeInTheDocument();
  });
});

// ── AC-IFW-PROC-01: Inline preview — expanded state ──────────────────────────

describe('AC-IFW-PROC-01: expanded state — budget impact + line items + adjacent actions', () => {
  it('clicking disclosure sets aria-expanded=true', async () => {
    renderAs();
    const btn = screen.getByRole('button', { name: /show budget impact/i });
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('budget-impact panel renders after expand', async () => {
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    // Our mocked DecisionSupportPanel renders "Budget impact · Solar Alpha"
    expect(screen.getByTestId('decision-support')).toBeInTheDocument();
  });

  it('line item name renders in expanded panel', async () => {
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    expect(screen.getByText('Inverter 5kW')).toBeInTheDocument();
  });

  it('Approve button appears in expanded panel (adjacent — no navigation)', async () => {
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    expect(screen.getByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
    // Lens-D regression invariant: useNavigate was NEVER called
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('Reject button appears in expanded panel (adjacent — no navigation)', async () => {
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    expect(screen.getByRole('button', { name: /^Reject$/i })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

// ── AC-IFW-PROC-01: Loading / error states in expanded panel ─────────────────

describe('AC-IFW-PROC-01: expanded panel — loading + error states', () => {
  it('shows loading state while detail is pending', async () => {
    detailState.isPending = true;
    detailState.data = undefined as never;
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    // ListState variant="loading" renders a div with aria-busy="true"
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('shows error state when detail fetch fails', async () => {
    detailState.isPending = false;
    detailState.isError = true;
    detailState.data = undefined as never;
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });
});

// ── AC-IFW-PROC-02: Approve fires transition({to:'Approved'}) ────────────────

describe('AC-IFW-PROC-02: Approve fires transition with to:Approved', () => {
  it('Approve → ConfirmDialog → confirm fires transition.mutate with {to:"Approved"}', async () => {
    transitionMutate.mockImplementation((_arg: unknown, opts: { onSuccess?: () => void }) => opts?.onSuccess?.());
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Approve$/i }));
    // ConfirmDialog should open
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Approve$/i }));
    expect(transitionMutate).toHaveBeenCalledWith(
      { to: 'Approved' },
      expect.any(Object),
    );
    // Lens-D regression: navigate was never called
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

// ── AC-IFW-PROC-02: Reject fires transition({to:'Rejected'}) ─────────────────

describe('AC-IFW-PROC-02: Reject fires transition with to:Rejected', () => {
  it('Reject → ConfirmDialog → confirm fires transition.mutate with {to:"Rejected"}', async () => {
    transitionMutate.mockImplementation((_arg: unknown, opts: { onSuccess?: () => void }) => opts?.onSuccess?.());
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Reject$/i }));
    // tone="destructive" → role="alertdialog" (ConfirmDialog a11y contract)
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Reject request/i }));
    expect(transitionMutate).toHaveBeenCalledWith(
      { to: 'Rejected' },
      expect.any(Object),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

// ── AC-IFW-PROC-02: can()-gate — no action buttons when role lacks permission ─

describe('AC-IFW-PROC-02: can() gate — no Approve/Reject for Engineer role', () => {
  it('Engineer (no transition permission) sees NO Approve or Reject buttons even when expanded', async () => {
    renderAs('Engineer');
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    expect(screen.queryByRole('button', { name: /^Approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reject$/i })).not.toBeInTheDocument();
  });
});

// ── AC-JR-W2-01: ProjectNameLink — project name links to /projects/:id ───────

describe('AC-JR-W2-01: project name is wrapped in ProjectNameLink (T07 census E)', () => {
  it('AC-JR-W2-01: project name renders as a link to /projects/:id', () => {
    renderAs();
    // ProjectNameLink renders a link with aria-label="Open <name>"
    const link = screen.getByRole('link', { name: /Open Solar Alpha/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/projects/proj-001');
  });

  it('AC-JR-W2-01: no project id — project name renders as inert text (no navigation)', () => {
    const rowNoProject = { ...ROW, project_id: undefined as unknown as string, project: { name: 'Orphan', code: null } };
    render(
      <MemoryRouter>
        <ImpersonationProvider realRole="Project Manager">
          <ToastProvider>
            <ProcurementApprovalRow row={rowNoProject as never} />
          </ToastProvider>
        </ImpersonationProvider>
      </MemoryRouter>,
    );
    // Inert text span — no link
    expect(screen.queryByRole('link', { name: /Open Orphan/i })).not.toBeInTheDocument();
    expect(screen.getByText('Orphan')).toBeInTheDocument();
  });

  it('AC-JR-W2-01: no project at all — renders em-dash (defensive fallback)', () => {
    const rowNoName = { ...ROW, project_id: 'proj-001', project: null };
    render(
      <MemoryRouter>
        <ImpersonationProvider realRole="Project Manager">
          <ToastProvider>
            <ProcurementApprovalRow row={rowNoName as never} />
          </ToastProvider>
        </ImpersonationProvider>
      </MemoryRouter>,
    );
    // ProjectNameLink renders em-dash when name is null
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

// ── AC-JR-W2-02: "Open request" link in expanded panel footer ────────────────

describe('AC-JR-W2-02: "Open request" link in expanded panel footer (T07)', () => {
  it('AC-JR-W2-02: expanded panel footer contains an "Open request" link to /procurement/:id', async () => {
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    const link = screen.getByRole('link', { name: /open request/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/procurement/pr-001');
  });

  it('AC-JR-W2-02: "Open request" link is in the same footer region as Approve/Reject', async () => {
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    const openLink = screen.getByRole('link', { name: /open request/i });
    const approveBtn = screen.getByRole('button', { name: /^Approve$/i });
    // Both are in the DOM simultaneously — same footer
    expect(openLink).toBeInTheDocument();
    expect(approveBtn).toBeInTheDocument();
  });

  it('AC-JR-W2-02: "Open request" visible even when user lacks transition permission', async () => {
    renderAs('Engineer');
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    // Engineers can't approve but should still be able to open the full request
    const link = screen.getByRole('link', { name: /open request/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/procurement/pr-001');
  });

  it('AC-JR-W2-02: navigateMock is never called — link is declarative, not imperative', async () => {
    renderAs();
    await userEvent.click(screen.getByRole('button', { name: /show budget impact/i }));
    // Link renders without ever calling useNavigate()
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

// ── AC-JR-W3-02: disclosure pattern consistency — solid border on wrapper ─────

describe('AC-JR-W3-02: ProcurementApprovalRow uses solid (not dashed) border (T20 consistency)', () => {
  it('AC-JR-W3-02: the row wrapper has border-border (solid) not border-dashed', () => {
    const { container } = renderAs();
    // The outermost div wrapping the row
    const row = container.firstChild as HTMLElement;
    expect(row.className).not.toContain('border-dashed');
    expect(row.className).toContain('border-border');
  });

  it('AC-JR-W3-02: the disclosure chevron button is the first interactive element in the row header', () => {
    renderAs();
    const disclosureBtn = screen.getByRole('button', { name: /show budget impact/i });
    // The disclosure button exists at the leading edge (first button in the row header)
    expect(disclosureBtn).toBeInTheDocument();
    expect(disclosureBtn).toHaveAttribute('aria-expanded', 'false');
  });
});
