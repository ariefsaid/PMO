/**
 * AC-IXD-PIPE-W5-C5 — Pipeline attention signals + "Needs attention" filter (N14)
 *
 * DATA-CHECK NOTES (binding, per honest-dashboard rule):
 *  - `get_sales_pipeline()` now (migration 0020) projects, per OPEN pipeline row:
 *    { id, name, client_name, status, contract_value, win_probability, last_update, pm_name }.
 *    So OPEN deals carry real aging + owner — the Owner / Last touch columns and the
 *    "Needs attention" filter work on OPEN deals, not just lost ones.
 *  - Lost deals (via useLostDeals → repositories.project.list) come through as
 *    ProjectWithRefs which includes `last_update` and `pm.full_name`.
 *  - A row that GENUINELY lacks last_update / pm_name (e.g. a project with no PM, or an
 *    edge RPC payload) still renders "—" (honest, no fabrication) and is excluded from the
 *    attention filter (no false positive from missing data).
 *
 * AGING THRESHOLD: 30 days. A deal untouched for ≥ 30 days is "needs attention".
 *   - "Needs attention" filter = table rows (open ∪ lost) where last_update IS present AND
 *     days since last_update >= 30.
 *   - Rows that lack last_update are excluded from the filter (honest).
 *
 * TESTS:
 * 1. Table view renders "Owner" and "Last touch" column headers.
 * 2. An OPEN pipeline row from the RPC shows its real Owner (pm_name) and Last touch.
 * 2b. A row genuinely missing last_update/pm_name still shows "—" (honest, no fabrication).
 * 3. A lost deal row with a recent last_update shows the PM name and "X days ago".
 * 4. The "Needs attention" filter tab is present in the table toolbar.
 * 5. "Needs attention" filter shows only deals with last_update >= 30 days ago.
 * 6. "Needs attention" filter excludes deals with last_update < 30 days ago.
 * 7. "Needs attention" filter INCLUDES a stale OPEN deal (now that open rows carry last_update).
 * 8. "Needs attention" filter shows an honest empty state when there are no stale deals.
 * 9. Owner column: text label (not color-only), has accessible column header.
 * 10. Last touch aging signal uses text label (not color-only); stale row shows warning label.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

// ── Fixtures ────────────────────────────────────────────────────────────────

// 35 days ago — stale (>= 30 day threshold)
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

// An OPEN deal as the RPC NOW returns it (migration 0020): real last_update + owner. Recent → not stale.
const openProjectRecent = {
  id: 'p-open-1',
  name: 'Northwind ERP Rollout',
  client_name: 'Northwind',
  status: 'Tender Submitted',
  contract_value: 1_200_000,
  win_probability: 0.5,
  last_update: daysAgo(3), // 3 days ago — NOT stale
  pm_name: 'Alice Manager',
};

// An OPEN deal that has gone stale — open rows now carry last_update, so the attention filter flags it.
const openProjectStale = {
  id: 'p-open-stale',
  name: 'Eastgate Depot Upgrade',
  client_name: 'Eastgate',
  status: 'Negotiation',
  contract_value: 2_000_000,
  win_probability: 0.7,
  last_update: daysAgo(40), // 40 days ago — STALE (>= 30 days)
  pm_name: 'Carol Owner',
};

// A row that GENUINELY lacks last_update / pm_name (defensive edge): renders "—" and is filter-excluded.
const openProjectNoData = {
  id: 'p-open-nodata',
  name: 'Bare Opportunity',
  client_name: 'Bare Co',
  status: 'Leads',
  contract_value: 100_000,
  win_probability: 0.1,
  // NO last_update, NO pm_name
};

const lostProjectRecent = {
  id: 'p-lost-recent',
  name: 'Coastal Depot Bid',
  client_name: 'Coastal',
  status: 'Loss Tender',
  contract_value: 950_000,
  win_probability: 0,
  last_update: daysAgo(5), // 5 days ago — NOT stale
  pm_name: 'Alice PM',
};

const lostProjectStale = {
  id: 'p-lost-stale',
  name: 'Stale Northern Tender',
  client_name: 'Northern Co',
  status: 'Loss Tender',
  contract_value: 600_000,
  win_probability: 0,
  last_update: daysAgo(35), // 35 days ago — STALE (>= 30 days)
  pm_name: 'Bob Manager',
};

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

const pipelineState: {
  data: { stages: unknown[]; projects: unknown[] } | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: { stages: [], projects: [openProjectRecent] },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

const lostState: { data: unknown[] } = { data: [] };

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useLostDeals: () => lostState,
}));

vi.mock('@/src/hooks/usePipelineView', () => ({
  usePipelineView: () => ['table', vi.fn()],
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

vi.mock('../../components/ProjectFormModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="New opportunity">
      <button onClick={onClose}>Cancel</button>
    </div>
  ),
}));

import SalesPipeline from '../SalesPipeline';

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  sessionStorage.clear();
  pipelineState.data = { stages: [], projects: [openProjectRecent] };
  pipelineState.isPending = false;
  pipelineState.isError = false;
  lostState.data = [];
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AC-IXD-PIPE-W5-C5 — Pipeline table attention signals (N14)', () => {
  it('AC-IXD-PIPE-W5-C5-1: table view renders "Owner" and "Last touch" column headers', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    expect(screen.getByRole('columnheader', { name: /owner/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /last touch/i })).toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-2: open pipeline row (RPC migration 0020) shows its real Owner and Last touch', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    const row = screen.getByText('Northwind ERP Rollout').closest('tr')!;
    // Owner is the PM name supplied by the RPC; Last touch is the aged last_update — NOT "—".
    expect(within(row).getByText('Alice Manager')).toBeInTheDocument();
    expect(within(row).getByText(/days ago/i)).toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-2b: a row genuinely missing last_update/pm_name still shows "—" (honest, no fabrication)', async () => {
    pipelineState.data = { stages: [], projects: [openProjectNoData] };
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    const row = screen.getByText('Bare Opportunity').closest('tr')!;
    const dashCells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent ?? '')
      .filter((t) => t.trim() === '—');
    // Both Owner and Last touch render "—" when the row has no data.
    expect(dashCells.length).toBeGreaterThanOrEqual(2);
  });

  it('AC-IXD-PIPE-W5-C5-3: lost deal row with data shows PM name and "X days ago" in Last touch', async () => {
    lostState.data = [lostProjectRecent];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Lost$/i }));
    const row = screen.getByText('Coastal Depot Bid').closest('tr')!;
    expect(within(row).getByText('Alice PM')).toBeInTheDocument();
    expect(within(row).getByText(/days ago/i)).toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-4: "Needs attention" filter tab is present in the table toolbar', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    expect(
      screen.getByRole('tab', { name: /needs attention/i }),
    ).toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-5: "Needs attention" filter shows stale deals (last_update >= 30 days ago)', async () => {
    lostState.data = [lostProjectStale];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    await userEvent.click(screen.getByRole('tab', { name: /needs attention/i }));
    expect(screen.getByText('Stale Northern Tender')).toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-6: "Needs attention" filter excludes deals with last_update < 30 days ago', async () => {
    lostState.data = [lostProjectRecent, lostProjectStale];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    await userEvent.click(screen.getByRole('tab', { name: /needs attention/i }));
    expect(screen.queryByText('Coastal Depot Bid')).not.toBeInTheDocument();
    expect(screen.getByText('Stale Northern Tender')).toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-7: "Needs attention" filter INCLUDES a stale OPEN deal (open rows now carry last_update)', async () => {
    // openProjectRecent (3d, not stale) + openProjectStale (40d, stale) are both OPEN deals.
    pipelineState.data = { stages: [], projects: [openProjectRecent, openProjectStale] };
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    await userEvent.click(screen.getByRole('tab', { name: /needs attention/i }));
    // The stale OPEN deal IS flagged; the recent OPEN deal is NOT.
    expect(screen.getByText('Eastgate Depot Upgrade')).toBeInTheDocument();
    expect(screen.queryByText('Northwind ERP Rollout')).not.toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-7b: "Needs attention" filter excludes a row genuinely missing last_update (honest — no false positive)', async () => {
    pipelineState.data = { stages: [], projects: [openProjectNoData] };
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    await userEvent.click(screen.getByRole('tab', { name: /needs attention/i }));
    expect(screen.queryByText('Bare Opportunity')).not.toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-8: "Needs attention" filter shows an honest empty state when no stale deals exist', async () => {
    lostState.data = [lostProjectRecent]; // recent — NOT stale
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    await userEvent.click(screen.getByRole('tab', { name: /needs attention/i }));
    expect(screen.getByText(/no deals need attention/i)).toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-9: Owner column header is accessible (columnheader role with name)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    const ownerHeader = screen.getByRole('columnheader', { name: /owner/i });
    expect(ownerHeader).toBeInTheDocument();
    // Text label — not color-only
    expect(ownerHeader.textContent?.trim()).toBeTruthy();
  });

  it('AC-IXD-PIPE-W5-C5-10: stale lost deal shows the aging warning label text (text, not color-only)', async () => {
    lostState.data = [lostProjectStale];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    await userEvent.click(screen.getByRole('tab', { name: /^Lost$/i }));
    const row = screen.getByText('Stale Northern Tender').closest('tr')!;
    // Should show a text-based aging signal (e.g. "35 days ago" and/or an "Overdue" label)
    expect(within(row).getByText(/days ago/i)).toBeInTheDocument();
  });
});
