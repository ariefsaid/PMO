/**
 * AC-TSC-R3 / FENCE 5 (surface honesty) — the Approvals "re-openable Approved" section.
 *
 * A report's APPROVED sheet may be re-opened for correction ONLY when ERP holds no document for it.
 * The surface must be HONEST about which is which (never a disabled button with no reason):
 *   • NO mirror (ts_number null) and NO in-flight push command → a "Re-open for correction" button.
 *   • a LIVE ERP doc (mirror.ts_number set)                    → "Already pushed to ERP — correction path coming" (NO button).
 *   • a NON-TERMINAL push command (external_command_outbox     → "Push in progress" (NO button).
 *     pending/committing/committed/quarantined/held)
 *
 * ⚑ SHOULD-FIX 4 (Luna code review): the in-flight case is classified from the OUTBOX, not the mirror.
 * The mirror row is written only AFTER the ERP call settles, and the shipped writers only ever write
 * `pushed`/`failed`/`held` — so the old `mirror.push_state === 'pending'|'pushing'` fixtures were states
 * NO writer produces, while every real in-flight push arrived here as `mirror: null` and was rendered
 * as an active button the server would refuse.
 * Clicking re-open invokes the reopen mutation (wired to transition_timesheet(id,'Draft'), proven in
 * the DAL test) and toasts success; a P0001 refusal (reopen-erp-document-held / reopen-push-in-flight)
 * toasts the honest reason. The whole section is gated behind canApproveTimesheets (the policy).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

// ── Hoisted, controllable mocks ─────────────────────────────────────────────
const { reopenMutate, attestMutate, reopenableData, roleHolder } = vi.hoisted(() => ({
  reopenMutate: vi.fn(),
  attestMutate: vi.fn(),
  reopenableData: [] as Array<Record<string, unknown>>,
  roleHolder: { role: 'Admin' as string },
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
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
    attestNoErpDocument: { mutate: attestMutate, isPending: false },
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

/** A reopenable Approved sheet (the ReopenableApprovedTimesheet shape). `pushCommandState` is the
 *  sheet's non-terminal `external_command_outbox` state, exactly as the DAL reports it. */
function sheet(
  id: string,
  owner: string,
  mirror: Record<string, unknown> | null,
  pushCommandState: string | null = null,
): Record<string, unknown> {
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
    pushCommandState,
  };
}

beforeEach(() => {
  reopenMutate.mockReset();
  attestMutate.mockReset();
  reopenableData.length = 0;
});

/** A fenced sheet whose ERP outcome is unknown (the witness is set) — the row the attestation targets. */
function unknownWitnessSheet(id: string, owner: string): Record<string, unknown> {
  return sheet(id, owner, {
    ts_number: null,
    push_state: 'failed',
    erp_cancelled_at: null,
    post_submit_unknown_at: '2026-07-14T09:00:00Z',
  });
}

describe('AC-TSC-R3: Approvals re-open section — surface honesty + the canApproveTimesheets gate', () => {
  it('AC-TSC-R3: an un-pushed Approved sheet (no mirror) shows a "Re-open for correction" button; a pushed sheet shows the honest note (NOT a button); an in-flight sheet shows "Push in progress"', () => {
    reopenableData.push(
      sheet('ts-unpushed', 'Un-pushed Owner', null),
      sheet('ts-pushed', 'Pushed Owner', { ts_number: 'TS-0001', push_state: 'pushed', erp_cancelled_at: null }),
      sheet('ts-inflight', 'In-flight Owner', null, 'pending'),
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

  it('AC-TSC-R5: an unknown-outcome refusal (reopen-push-outcome-unknown) says an administrator must CONFIRM what ERPNext holds — not a raw error code, and not "released"', async () => {
    // Migrations 0152 §B / 0157 §4: PMO does not know whether ERPNext holds a document for this week.
    // "Try again shortly" would be a lie (nothing retries it on its own), and — round-8 BLOCK — so would
    // "an administrator must release the held push": a release re-queues the command and learns NOTHING
    // about ERPNext, so it does not lift this refusal. The only instruction that is true is that someone
    // must establish what ERPNext actually holds.
    const user = userEvent.setup();
    reopenableData.push(sheet('ts-unknown', 'Unknown Owner', null));
    reopenMutate.mockImplementation((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.(new Error('reopen-push-outcome-unknown'));
    });
    renderPage('Admin');

    await user.click(screen.getByRole('button', { name: /re-open for correction/i }));

    await waitFor(() =>
      expect(screen.getByText(/administrator must confirm what ERPNext holds/i)).toBeInTheDocument(),
    );
  });

  // ⚑ Luna FU-1a round-8 BLOCK — a week whose ERP outcome is UNKNOWN must not be offered as an action.
  // `post_submit_unknown_at` is set when a submit reached ERPNext and its result could not be read back;
  // it survives an operator's hold release (which re-queues a command and learns nothing about ERP), so
  // the server refuses this row until an Admin attests what ERPNext holds. Rendering the button anyway
  // would be the dead-affordance this whole section exists to avoid — and the state is NOT visible from
  // push_state, which reads a perfectly ordinary `failed` here.
  it('AC-TSC-R8: a sheet with an UNKNOWN ERP outcome shows the honest reason and NO re-open button — even though its push_state is the ordinary `failed`', () => {
    reopenableData.push(
      sheet('ts-unknown-erp', 'Unknown Outcome Owner', {
        ts_number: null,
        push_state: 'failed',
        erp_cancelled_at: null,
        post_submit_unknown_at: '2026-07-14T09:00:00Z',
      }),
      sheet('ts-plain-failed', 'Rejected Push Owner', {
        ts_number: null,
        push_state: 'failed',
        erp_cancelled_at: null,
        post_submit_unknown_at: null,
      }),
    );
    renderPage('Admin');

    expect(screen.getByText(/erp result (is )?unknown|administrator must confirm/i)).toBeInTheDocument();
    // Only the genuinely-rejected push (no unknown on record) keeps its action.
    expect(screen.getAllByRole('button', { name: /re-open for correction/i })).toHaveLength(1);
  });

  // ⚑ Luna FU-1a round-10 S3 — the mirror's own `held` state is the SAME refusal, and the surface must
  // say so. The server refuses a `held` mirror independently of the witness (migration 0157 §4 keeps that
  // predicate for the pre-0157 residue: a row parked `held` before the witness column existed). Reading
  // only `post_submit_unknown_at` rendered an ACTIVE button on those rows that the server could only
  // refuse — this section exists precisely to not do that.
  it('AC-TSC-R10: a sheet whose MIRROR is `held` (no witness on the row — the pre-0157 residue) shows the honest reason and NO re-open button', () => {
    reopenableData.push(
      sheet('ts-held-mirror', 'Held Mirror Owner', {
        ts_number: null,
        push_state: 'held',
        erp_cancelled_at: null,
        post_submit_unknown_at: null,
      }),
      sheet('ts-plain-failed', 'Rejected Push Owner', {
        ts_number: null,
        push_state: 'failed',
        erp_cancelled_at: null,
        post_submit_unknown_at: null,
      }),
    );
    renderPage('Admin');

    expect(screen.getByText(/administrator must confirm what ERPNext holds/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /re-open for correction/i })).toHaveLength(1);
  });

  // ── SHOULD-FIX 4: the states the mirror CANNOT show ──────────────────────
  it.each([
    ['pending', 'a queued push another worker will claim'],
    ['committing', 'a POST that may be inside ERPNext right now'],
    ['committed', 'an ERP document whose mirror finalize has not run'],
    ['quarantined', 'an unresolved in-flight POST'],
    ['held', 'an operator-held command'],
  ])('SHOULD-FIX 4: a sheet with NO mirror but a `%s` push command shows "Push in progress" — never an active re-open button the server will refuse', (state) => {
    reopenableData.push(sheet(`ts-${state}`, 'In-flight Owner', null, state));
    renderPage('Admin');

    expect(screen.getByText(/push in progress/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /re-open for correction/i })).not.toBeInTheDocument();
  });

  it('SHOULD-FIX 4: a DESK-CANCELLED ERP document leaves the sheet re-openable — the RPC only refuses on a LIVE document', () => {
    // migration 0151 §A refuses on `ts_number is not null AND erp_cancelled_at is null`. Once the
    // accountant has cancelled the ERP Timesheet there is no live document, so the surface must offer
    // the action rather than a note the server does not agree with.
    reopenableData.push(sheet('ts-desk-cancelled', 'Cancelled Owner', { ts_number: 'TS-0009', push_state: 'failed', erp_cancelled_at: '2026-07-20T09:00:00Z' }, null));
    renderPage('Admin');

    expect(screen.getByRole('button', { name: /re-open for correction/i })).toBeInTheDocument();
    expect(screen.queryByText(/already pushed to erp/i)).not.toBeInTheDocument();
  });

  it('SHOULD-FIX 4: a `failed` push command still leaves the sheet re-openable — Slice A admits it (a rejected push minted no ERP document)', () => {
    // `failed` is terminal for the server's precondition, so the DAL reports pushCommandState null for
    // it; the surface must not invent an obstacle the RPC does not have.
    reopenableData.push(sheet('ts-failed-push', 'Failed Push Owner', { ts_number: null, push_state: 'failed', erp_cancelled_at: null }, null));
    renderPage('Admin');

    expect(screen.getByRole('button', { name: /re-open for correction/i })).toBeInTheDocument();
  });

  // ⚑ Luna FU-1a round-12 SHOULD-FIX 1 — the attestation is the ONLY documented route out of an ERP
  // unknown, and it had no surface anywhere in the app (a fence whose only key was undocumented `psql`).
  // The affordance lands beside the release/attention controls, Admin-only (the REAL role), reason-
  // required, and both outcomes are toasted (the I-13 lesson: a silent affordance reads as broken).
  describe('AC-TSC-R12: the attestation affordance on a fenced (unknown ERP outcome) row', () => {
    it('AC-TSC-R12: an ADMIN sees a "Confirm what ERPNext holds" control on a witnessed row; a non-Admin approver (Project Manager) sees only the note', () => {
      reopenableData.push(unknownWitnessSheet('ts-unknown-erp', 'Unknown Outcome Owner'));

      // Admin — the control is present.
      const { unmount } = renderPage('Admin');
      expect(screen.getByRole('button', { name: /confirm what erpnext holds/i })).toBeInTheDocument();
      unmount();

      // Project Manager can approve timesheets (the section renders) but is NOT Admin — note only.
      renderPage('Project Manager');
      expect(screen.getByText(/erp result unknown|administrator must confirm/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /confirm what erpnext holds/i })).not.toBeInTheDocument();
    });

    it('AC-TSC-R12: the confirm dialog requires a reason — confirm is disabled until one is typed, then the attest mutation is called with it', async () => {
      const user = userEvent.setup();
      reopenableData.push(unknownWitnessSheet('ts-unknown-erp', 'Unknown Outcome Owner'));
      attestMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
      renderPage('Admin');

      await user.click(screen.getByRole('button', { name: /confirm what erpnext holds/i }));

      // The dialog is open with a reason field; the confirm is gated until it is non-empty.
      const dialog = await screen.findByRole('dialog');
      const confirmBtn = within(dialog).getByRole('button', { name: /confirm|attest/i });
      expect(confirmBtn).toBeDisabled();

      await user.type(within(dialog).getByRole('textbox'), 'Checked ERPNext: no Timesheet for this week');
      expect(confirmBtn).toBeEnabled();
      await user.click(confirmBtn);

      expect(attestMutate).toHaveBeenCalledWith(
        { id: 'ts-unknown-erp', reason: 'Checked ERPNext: no Timesheet for this week' },
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
      );
      await waitFor(() =>
        expect(screen.getAllByRole('status').some((el) => /confirm|erpnext|re-open|correct/i.test(el.textContent ?? ''))).toBe(true),
      );
    });

    it('AC-TSC-R12: the refusal path states the reason — not a generic failure', async () => {
      const user = userEvent.setup();
      reopenableData.push(unknownWitnessSheet('ts-unknown-erp', 'Unknown Outcome Owner'));
      attestMutate.mockImplementation((_vars: unknown, opts?: { onError?: (e: unknown) => void }) =>
        opts?.onError?.(new Error('not authorized')),
      );
      renderPage('Admin');

      await user.click(screen.getByRole('button', { name: /confirm what erpnext holds/i }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByRole('textbox'), 'Checked ERPNext');
      await user.click(within(dialog).getByRole('button', { name: /confirm|attest/i }));

      await waitFor(() =>
        expect(screen.getAllByRole('status').some((el) => /not authorized/i.test(el.textContent ?? ''))).toBe(true),
      );
    });
  });

  it('AC-TSC-R3: the section is gated behind canApproveTimesheets — absent for a role that cannot approve (Finance)', () => {
    reopenableData.push(sheet('ts-gated', 'Gated Owner', null));
    renderPage('Finance'); // Finance ∉ DELIVERY → may('transition','approval') is false
    expect(screen.queryByRole('button', { name: /re-open for correction/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/already pushed to erp/i)).not.toBeInTheDocument();
  });
});
