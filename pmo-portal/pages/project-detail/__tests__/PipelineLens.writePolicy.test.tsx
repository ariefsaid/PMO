import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
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
vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject };
});

const pipelineState = {
  data: {
    stages: [],
    projects: [
      { id: 'd1', name: 'Acme Tender Bid', status: 'Tender Submitted', contract_value: 1200000, win_probability: 0.5 },
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
  contract_value: 1200000,
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
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Moved to Negotiation/i);
    });
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
});
