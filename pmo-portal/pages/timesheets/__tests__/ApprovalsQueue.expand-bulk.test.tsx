import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * AC-IXD-TS-W5-3 — timesheet approval depth (N11 expand-in-place) +
 * evidence-based bulk approve (N12). The queue already excludes the caller's own
 * sheets (SoD) at the DAL; bulk select must additionally only offer rows where
 * `timesheetActions(...).approve` is true. Bulk fires the existing per-sheet approve
 * RPC N times, resilient to partial failure, aggregated into ONE toast.
 */
const { queue, approveMock, mutateAsyncMock } = vi.hoisted(() => ({
  approveMock: vi.fn(),
  mutateAsyncMock: vi.fn(),
  queue: {
    data: [
      {
        id: 's1',
        status: 'Submitted',
        week_start_date: '2026-06-01',
        owner: { full_name: 'Anita Rao' },
        entries: [
          { project_id: 'pA', entry_date: '2026-06-01', hours: 8, project: { name: 'Apollo', code: 'PRJ-014' } },
          { project_id: 'pA', entry_date: '2026-06-02', hours: 8, project: { name: 'Apollo', code: 'PRJ-014' } },
          { project_id: 'pB', entry_date: '2026-06-03', hours: 4, project: { name: 'Internal', code: null } },
        ],
      },
      {
        id: 's2',
        status: 'Submitted',
        week_start_date: '2026-06-01',
        owner: { full_name: 'Dev Shah' },
        entries: [
          { project_id: 'pA', entry_date: '2026-06-01', hours: 7, project: { name: 'Apollo', code: 'PRJ-014' } },
        ],
      },
    ] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => queue,
  useTimesheetMutations: () => ({
    approve: { mutate: approveMock, mutateAsync: mutateAsyncMock, isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
}));

import { ApprovalsQueue } from '../ApprovalsQueue';

const renderAs = (realRole: Role) =>
  render(
    <MemoryRouter>
      <ImpersonationProvider realRole={realRole}>
        <ToastProvider>
          <ApprovalsQueue />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  approveMock.mockReset();
  mutateAsyncMock.mockReset();
  queue.isPending = false;
  queue.isError = false;
});

// ── N11: expand-in-place ──────────────────────────────────────────────────────
describe('AC-IXD-TS-W5-3: N11 expand-in-place breakdown', () => {
  it('each row has a disclosure button with aria-expanded=false by default', () => {
    renderAs('Project Manager');
    const toggles = screen.getAllByRole('button', { name: /show hours/i });
    expect(toggles.length).toBe(2);
    toggles.forEach((t) => expect(t).toHaveAttribute('aria-expanded', 'false'));
  });

  it('expanding a row reveals its per-project hours grid (aria-expanded=true)', async () => {
    renderAs('Project Manager');
    const toggle = screen.getByRole('button', { name: /show hours for Anita Rao/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // The grid shows the per-project rows the engineer entered.
    const panelId = toggle.getAttribute('aria-controls')!;
    const panel = document.getElementById(panelId)!;
    expect(within(panel).getByText('Apollo')).toBeInTheDocument();
    expect(within(panel).getByText('Internal')).toBeInTheDocument();
  });

  it('rows expand independently (multiple open at once)', async () => {
    renderAs('Project Manager');
    const a = screen.getByRole('button', { name: /show hours for Anita Rao/i });
    const d = screen.getByRole('button', { name: /show hours for Dev Shah/i });
    await userEvent.click(a);
    await userEvent.click(d);
    expect(a).toHaveAttribute('aria-expanded', 'true');
    expect(d).toHaveAttribute('aria-expanded', 'true');
  });
});

// ── N12: bulk approve ───────────────────────────────────────────────────────
describe('AC-IXD-TS-W5-3: N12 evidence-based bulk approve', () => {
  it('a Select toggle enters selection mode and shows per-row checkboxes', async () => {
    renderAs('Project Manager');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Select$/i }));
    // one checkbox per approvable row + the select-all = 3
    expect(screen.getAllByRole('checkbox').length).toBe(3);
  });

  it('non-approver (Finance) gets NO selection affordance at all', () => {
    renderAs('Finance');
    expect(screen.queryByRole('button', { name: /^Select$/i })).not.toBeInTheDocument();
  });

  it('selecting rows then Approve N fires the per-sheet approve N times after confirm', async () => {
    // commitBulk uses mutateAsync — mock returns a resolved promise for each call.
    mutateAsyncMock.mockResolvedValue(undefined);
    renderAs('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: /^Select$/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /select Anita Rao's week/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /select Dev Shah's week/i }));
    // bulk cluster shows the count + Approve N
    const approveBtn = screen.getByRole('button', { name: /Approve 2/i });
    await userEvent.click(approveBtn);
    // ConfirmDialog → confirm (scope to the dialog to disambiguate from the cluster button)
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Approve 2$/i }));
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(2));
    expect(mutateAsyncMock.mock.calls[0][0]).toEqual({ id: 's1' });
    expect(mutateAsyncMock.mock.calls[1][0]).toEqual({ id: 's2' });
  });

  it('AC-IXD-TS-W5-3-bulk-fix: bulk-approving ≥2 rows closes the dialog and fires the aggregate toast (RQ v5 fix)', async () => {
    // FAILING TEST (RED): commitBulk must close dialog + toast after ≥2 mutateAsync calls.
    // With the OLD mutate-in-loop implementation, React Query v5 silently drops callbacks
    // for all but the last in-flight call, so settled never reaches total and the dialog
    // stays stuck. This test proves the mutateAsync/allSettled fix works correctly.
    mutateAsyncMock.mockResolvedValue(undefined);
    renderAs('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: /^Select$/i }));
    // Select all (2 approvable rows — Anita Rao + Dev Shah)
    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    await userEvent.click(screen.getByRole('button', { name: /Approve 2/i }));
    const dialog = await screen.findByRole('dialog');
    await expect(dialog).toBeInTheDocument();
    // Confirm the bulk dialog
    await userEvent.click(within(dialog).getByRole('button', { name: /^Approve 2$/i }));
    // Goal 1: the confirm dialog CLOSES (was stuck with the bug)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 3_000 });
    // Goal 2: aggregate success toast appears
    expect(await screen.findByText(/timesheets? approved/i)).toBeInTheDocument();
  });

  it('select-all selects only the approvable rows', async () => {
    renderAs('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: /^Select$/i }));
    const all = screen.getByRole('checkbox', { name: /select all/i });
    await userEvent.click(all);
    // 2 approvable rows selected → Approve 2
    expect(screen.getByRole('button', { name: /Approve 2/i })).toBeInTheDocument();
  });

  it('resilient: a partial failure still approves the rest and reports one aggregate toast', async () => {
    // s1 fails (SoD/stale), s2 succeeds — Promise.allSettled ensures s2 runs even if s1 rejects.
    mutateAsyncMock.mockImplementation((arg: { id: string }) => {
      if (arg.id === 's1') return Promise.reject(new Error('separation of duties'));
      return Promise.resolve(undefined);
    });
    renderAs('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: /^Select$/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    await userEvent.click(screen.getByRole('button', { name: /Approve 2/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Approve 2$/i }));
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(2));
    // aggregate toast reports the split, not two separate toasts
    expect(await screen.findByText(/1 approved/i)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/i)).toBeInTheDocument();
  });

  it('Clear exits selection mode', async () => {
    renderAs('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: /^Select$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Clear$/i }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
