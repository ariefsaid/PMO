import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * AC-IXD-WP-004 (write-policy, OD-UX-1; plan task 12):
 *   Given an open deal in the pipeline lens, when the user clicks "Advance to <stage>",
 *   then NO confirm dialog appears, the stage advances on the single click + a toast;
 *   AND clicking "Mark lost" still opens the destructive confirm.
 *
 * A routine forward `Advance` is reversible + routine → single-click + toast (aligned
 * to procurement + Tasks). `Mark lost` is terminal/destructive → keeps its confirm.
 * `Mark won` keeps its inline SoD capture panel (the consequential confirm).
 */

// vi.mock factories are hoisted above top-level consts, so the mock fn must be
// created via vi.hoisted (the project's established pattern).
const { transitionProject } = vi.hoisted(() => ({
  transitionProject: vi.fn().mockResolvedValue(undefined),
}));
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject };
});

const pipelineState = {
  data: {
    stages: [],
    projects: [
      { id: 'd1', name: 'Acme Tender Bid', status: 'Tender Submitted', contract_value: 1200000, currency: 'USD', win_probability: 0.5 },
    ] as Array<Record<string, unknown>>,
  },
};
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => pipelineState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

import PipelineLens from '../PipelineLens';

const dealRow = {
  id: 'd1',
  name: 'Acme Tender Bid',
  code: 'OPP-0042',
  status: 'Tender Submitted',
  client_id: 'c1',
  project_manager_id: 'u-alice',
  contract_value: 1200000, currency: 'USD',
  budget: 0,
  spent: 0,
  start_date: null,
  end_date: null,
  contract_date: null,
  decided_at: null,
  customer_contract_ref: null,
  client: { name: 'Acme' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

// The write-policy journey is a PM advancing a deal; render under a PM real role so the
// A-1 lifecycle gate (Admin·Exec·PM) shows the action cluster being exercised here.
const renderLens = (project: ProjectWithRefs = dealRow) =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <ToastProvider>
        <PipelineLens project={project} />
      </ToastProvider>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  transitionProject.mockClear();
  transitionProject.mockResolvedValue(undefined);
});

describe('PipelineLens — write policy (AC-IXD-WP-004, OD-UX-1)', () => {
  it('AC-IXD-WP-004: clicking "Advance to <stage>" fires the transition on a SINGLE click — no confirm dialog', async () => {
    renderLens();
    const advance = screen.getByRole('button', { name: /Advance to/i });
    await userEvent.click(advance);

    // No confirm surface appears for the routine forward step.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // The transition fired on the single click (Tender Submitted → Negotiation).
    await waitFor(() => expect(transitionProject).toHaveBeenCalledWith('d1', 'Negotiation'));
  });

  it('AC-IXD-WP-004: a routine Advance shows a quiet success toast', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Advance to/i }));
    expect(await findToastAnnouncement('status', /Moved to Negotiation/i)).toBeInTheDocument();
  });

  it('AC-IXD-WP-004: "Mark lost" STILL opens a destructive confirm before writing', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Mark lost/i }));

    // The destructive confirm appears; nothing has been written yet.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(transitionProject).not.toHaveBeenCalled();

    // Confirming inside the dialog fires the terminal transition.
    await userEvent.click(within(dialog).getByRole('button', { name: /Mark lost/i }));
    await waitFor(() => expect(transitionProject).toHaveBeenCalledWith('d1', 'Loss Tender'));
  });

  // #774: "Decline to bid" is the third terminal outcome — also confirm-gated, writes 'Declined'.
  it('AC-DEC-001: "Decline to bid" confirms, then transitions the project to Declined', async () => {
    renderLens();
    await userEvent.click(screen.getByRole('button', { name: /Decline to bid/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(transitionProject).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: /Decline to bid/i }));
    await waitFor(() => expect(transitionProject).toHaveBeenCalledWith('d1', 'Declined'));
  });
});

describe('AC-PLC-005: the decision date follows the profile timezone', () => {
  afterEach(() => resetActiveLocale());

  it('shows decided_at on the calendar day of the viewer timezone', () => {
    // A lost deal: the only undecided-by-contract row whose decided_at is shown (#732).
    const decided = { ...dealRow, status: 'Loss Tender', decided_at: '2026-06-14T23:30:00Z' } as ProjectWithRefs;
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const { unmount } = renderLens(decided);
    expect(screen.getByText('6/14/2026')).toBeInTheDocument();
    unmount();

    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    renderLens(decided);
    expect(screen.getByText('6/15/2026')).toBeInTheDocument();
  });

  // #732: a win writes decided_at = contract_date::timestamptz, so the stored instant is midnight UTC
  // ONLY on a UTC database session. Model a UTC+7 session (2026-09-01 00:00 +07 = 2026-08-31T17:00Z):
  // decided_at is NOT midnight UTC, yet the tile must still show the contract date for every viewer.
  it.each(['America/Los_Angeles', 'Etc/GMT+8', 'Asia/Jakarta', 'UTC'])(
    '#732: a won project shows its contract_date, not a shifted decided_at instant, for a %s viewer',
    (timezone) => {
      const won = {
        ...dealRow,
        status: 'Won, Pending KoM',
        contract_date: '2026-09-01',
        decided_at: '2026-08-31T17:00:00+00:00',
      } as ProjectWithRefs;
      setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone });
      renderLens(won);
      expect(screen.getByText('9/1/2026')).toBeInTheDocument();
    },
  );

  it('#732: a won project on a UTC session (decided_at at midnight UTC) still shows its contract_date', () => {
    const won = {
      ...dealRow,
      status: 'Won, Pending KoM',
      contract_date: '2026-09-01',
      decided_at: '2026-09-01T00:00:00+00:00',
    } as ProjectWithRefs;
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Etc/GMT+8' });
    renderLens(won);
    expect(screen.getByText('9/1/2026')).toBeInTheDocument();
  });

  it('#732: a lost project (no contract_date) keeps the instant path, even at midnight UTC', () => {
    // A loss stamps now(); it is a real moment, so it follows the viewer timezone. There is no
    // calendar-date special case for an instant that merely happens to land on 00:00:00Z.
    const lost = {
      ...dealRow,
      status: 'Loss Tender',
      contract_date: null,
      decided_at: '2026-09-01T00:00:00+00:00',
    } as ProjectWithRefs;
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Etc/GMT+8' });
    renderLens(lost);
    expect(screen.getByText('8/31/2026')).toBeInTheDocument();
  });

  it('#732: a lost deal revived to Negotiation shows Pending, not its old loss date', () => {
    // Loss Tender -> Negotiation keeps the loss's decided_at on the row; the deal is undecided again.
    const revived = {
      ...dealRow,
      status: 'Negotiation',
      contract_date: null,
      decided_at: '2026-08-15T09:30:00+00:00',
    } as ProjectWithRefs;
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Etc/GMT+8' });
    renderLens(revived);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText('8/15/2026')).not.toBeInTheDocument();
  });
});
