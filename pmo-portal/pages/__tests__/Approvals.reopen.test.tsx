/**
 * AC-TSC-R3 / FENCE 5 (surface honesty) — the Approvals "re-openable Approved" section.
 *
 * A report's APPROVED sheet may be re-opened for correction ONLY when ERP holds no document for it.
 * The surface must be HONEST about which is which (never a disabled button with no reason):
 *   • NO mirror (ts_number null) and NOT in-flight  → a "Re-open for correction" button.
 *   • a LIVE ERP doc (mirror.ts_number set)         → "Already pushed to ERP — correction path coming" (NO button).
 *   • a push in flight (mirror.push_state pending/pushing) → "Push in progress" (NO button).
 * Clicking re-open invokes the reopen mutation (wired to transition_timesheet(id,'Draft'), proven in
 * the DAL test) and toasts success; a P0001 refusal (reopen-erp-document-held / reopen-push-in-flight)
 * toasts the honest reason. The whole section is gated behind canApproveTimesheets (the policy).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

// ── Hoisted, controllable mocks ─────────────────────────────────────────────
const { reopenMutate, reopenableData, roleHolder } = vi.hoisted(() => ({
  reopenMutate: vi.fn(),
  reopenableData: [] as Array<Record<string, unknown>>,
  roleHolder: { role: 'Admin' as string },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  usePushesNeedingAttention: () => ({ data: [], isPending: false, isError: false, retry: { mutate: vi.fn(), isPending: false } }),
  useEmployeeLinkConfirm: () => ({ links: { data: [], isPending: false, isError: false }, confirm: { mutate: vi.fn(), isPending: false } }),
  useReopenableApprovedTimesheets: () => ({ data: reopenableData, isPending: false, isError: false }),
  useTimesheetMutations: () => ({
    submit: { mutate: vi.fn(), isPending: false },
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
    reopen: { mutate: vi.fn(), isPending: false },
    reopenApproved: { mutate: reopenMutate, isPending: false },
  }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }),
}));

vi.mock('@/src/auth/impersonation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/auth/impersonation')>();
  return { ...actual, useEffectiveRole: () => ({ realRole: roleHolder.role, effectiveRole: roleHolder.role }) };
});

import ApprovalsPage from '../Approvals';

const renderPage = (role: string = 'Admin') => {
  roleHolder.role = role;
  return render(
    <MemoryRouter initialEntries={['/approvals']}>
      <ImpersonationProvider realRole={role as 'Admin'}>
        <ToastProvider>
          <ApprovalsPage />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );
};

/** A reopenable Approved sheet (the ReopenableApprovedTimesheet shape). */
function sheet(id: string, owner: string, mirror: Record<string, unknown> | null): Record<string, unknown> {
  return {
    id,
    user_id: 'other-user',
    week_start_date: '2026-07-13',
    status: 'Approved',
    org_id: 'org-1',
    submitted_at: '2026-07-10T10:00:00Z',
    approved_by: 'me',
    approved_at: '2026-07-11T10:00:00Z',
    owner: { full_name: owner },
    entries: [{ id: `${id}-e1`, timesheet_id: id, project_id: 'p1', entry_date: '2026-07-13', hours: 8, notes: null, project: { name: 'Site Alpha', code: 'SA01' } }],
    mirror,
  };
}

beforeEach(() => {
  reopenMutate.mockReset();
  reopenableData.length = 0;
});

describe('AC-TSC-R3: Approvals re-open section — surface honesty + the canApproveTimesheets gate', () => {
  it('AC-TSC-R3: an un-pushed Approved sheet (no mirror) shows a "Re-open for correction" button; a pushed sheet shows the honest note (NOT a button); an in-flight sheet shows "Push in progress"', () => {
    reopenableData.push(
      sheet('ts-unpushed', 'Un-pushed Owner', null),
      sheet('ts-pushed', 'Pushed Owner', { ts_number: 'TS-0001', push_state: 'pushed', erp_cancelled_at: null }),
      sheet('ts-inflight', 'In-flight Owner', { ts_number: null, push_state: 'pending', erp_cancelled_at: null }),
    );
    renderPage('Admin');

    // (a) un-pushed → re-open button present
    expect(screen.getByRole('button', { name: /re-open for correction/i })).toBeInTheDocument();
    // (b) pushed → the HONEST note, and NO re-open button for that row (not a disabled button)
    expect(screen.getByText(/already pushed to erp/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /re-open for correction/i })).toHaveLength(1);
    // (c) in-flight → "Push in progress"
    expect(screen.getByText(/push in progress/i)).toBeInTheDocument();
  });

  it('AC-TSC-R3: clicking "Re-open for correction" invokes the reopen mutation (→ transition_timesheet Draft) and toasts success', async () => {
    const user = userEvent.setup();
    reopenableData.push(sheet('ts-reopen', 'Reopen Owner', null));
    reopenMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
    renderPage('Admin');

    await user.click(screen.getByRole('button', { name: /re-open for correction/i }));

    expect(reopenMutate).toHaveBeenCalledWith(
      { id: 'ts-reopen' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('status').some((el) => /reopen|re-open|draft|editing|correction/i.test(el.textContent ?? ''))).toBe(true),
    );
  });

  it('AC-TSC-R3: a refusal (reopen-erp-document-held) toasts the honest reason — not a generic failure', async () => {
    const user = userEvent.setup();
    reopenableData.push(sheet('ts-refuse', 'Refuse Owner', null));
    reopenMutate.mockImplementation((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.(new Error('reopen-erp-document-held'));
    });
    renderPage('Admin');

    await user.click(screen.getByRole('button', { name: /re-open for correction/i }));

    await waitFor(() => expect(screen.getByText(/already in erp|pushed to erp|cannot be re-opened/i)).toBeInTheDocument());
  });

  it('AC-TSC-R3: the section is gated behind canApproveTimesheets — absent for a role that cannot approve (Finance)', () => {
    reopenableData.push(sheet('ts-gated', 'Gated Owner', null));
    renderPage('Finance'); // Finance ∉ DELIVERY → may('transition','approval') is false
    expect(screen.queryByRole('button', { name: /re-open for correction/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/already pushed to erp/i)).not.toBeInTheDocument();
  });
});
