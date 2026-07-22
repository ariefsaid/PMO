// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * AC-TSP-010 — THE OWNER'S RULING, adversarially: a NON-Approved sheet NEVER reaches ERP, whatever the
 * command claims (FR-TSP-010, FR-TSP-014, ADR-0059 §3.3).
 *
 * Given an org owning `timesheets`→`erpnext` and sheets in `Draft`, `Submitted` and `Rejected`,
 * When a hand-crafted command is POSTed DIRECTLY at the served `adapter-dispatch` for each — including
 * one whose payload asserts `status:'Approved'` and one carrying a forged `approved_by`/`approved_at`
 * (i.e. the FE is bypassed entirely and the payload lies about the precondition),
 * Then each is rejected `422` `commit-rejected`/`timesheet-not-approved`, NO `external_command_outbox`
 * row is created, NO `timesheet_erp_mirror` row is minted, and — the oracle that actually matters — the
 * BENCH's Timesheet count is unchanged: no ERP HTTP request was ever issued.
 *
 * ⚑ The point is NOT that a disabled button cannot be clicked. It is that the SERVER re-reads
 * `timesheets.status` from the database and refuses, even when the caller is a real, authorized Admin
 * whose payload asserts otherwise. A test that merely drove the UI would prove nothing here.
 *
 * Run: scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
 *        npx playwright test e2e/serial/AC-TSP-010
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  ORG_ID,
  MANAGER_ID,
  ADMIN_EMAIL,
  cleanupTsp,
  runWeek,
  countErpTimesheets,
  dispatchTimesheetPush,
  seedTimesheet,
  seedTsp,
  signInAs,
  timesheetPushKeyFor,
} from './_tspHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY);
if (!READY && process.env.CI) {
  throw new Error('AC-TSP-010: SUPABASE_FUNCTIONS_URL + SUPABASE_URL + VITE_SUPABASE_ANON_KEY are required in CI — this spec cannot silently skip');
}
if (READY && !SERVICE_KEY) {
  throw new Error('AC-TSP-010: SUPABASE_SERVICE_ROLE_KEY is required whenever the served lane is available.');
}
test.skip(!READY, 'AC-TSP-010: served-fn lane not configured — run via scripts/serve-functions.sh against the ERPNext bench');

test.setTimeout(180_000);

test.describe('AC-TSP-010: the Approved-only gate — a non-Approved sheet never reaches ERP, whatever the command claims', () => {
  test('AC-TSP-010 forged Draft/Submitted/Rejected push commands (payload asserting Approved + a forged approver) are each rejected 422 timesheet-not-approved with no outbox row, no mirror row, and ZERO ERP documents', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedTsp(admin, suffix);

    try {
      // Three sheets that a legitimate push must never touch. Each carries REAL entries, so the only
      // thing standing between them and the client's ERP is the status gate.
      const draftWeek = runWeek();
      const submittedWeek = runWeek();
      const rejectedWeek = runWeek();
      const draftId = await seedTimesheet(admin, seeded, {
        status: 'Draft',
        weekStartDate: draftWeek.weekStartDate,
        entries: [{ projectId: seeded.projectAId, entryDate: draftWeek.day1, hours: '8.00' }],
      });
      const submittedId = await seedTimesheet(admin, seeded, {
        status: 'Submitted',
        weekStartDate: submittedWeek.weekStartDate,
        entries: [{ projectId: seeded.projectAId, entryDate: submittedWeek.day1, hours: '7.50' }],
      });
      const rejectedId = await seedTimesheet(admin, seeded, {
        status: 'Rejected',
        weekStartDate: rejectedWeek.weekStartDate,
        entries: [{ projectId: seeded.projectBId, entryDate: rejectedWeek.day1, hours: '6.25' }],
      });

      // The ERP-side oracle: the bench's Timesheet count BEFORE any forged command is issued.
      const erpCountBefore = await countErpTimesheets();

      // A REAL, authorized Admin token — the gate must refuse on the sheet's STATE, not on the caller.
      const accessToken = await signInAs(AUTH_URL, ANON_KEY, ADMIN_EMAIL);
      const forgedApprovedAt = '2026-03-20T10:00:00.000000+00:00';

      const cases: Array<{ label: string; timesheetId: string; projectId: string; entryDate: string }> = [
        { label: 'Draft', timesheetId: draftId, projectId: seeded.projectAId, entryDate: draftWeek.day1 },
        { label: 'Submitted', timesheetId: submittedId, projectId: seeded.projectAId, entryDate: submittedWeek.day1 },
        { label: 'Rejected', timesheetId: rejectedId, projectId: seeded.projectBId, entryDate: rejectedWeek.day1 },
      ];

      for (const c of cases) {
        const res = await dispatchTimesheetPush(
          FUNCTIONS_URL,
          ANON_KEY,
          accessToken,
          {
            id: c.timesheetId,
            // ── THE FORGERY: every field the push is built from, asserted by the payload ──
            status: 'Approved',
            approved_by: MANAGER_ID,
            approved_at: forgedApprovedAt,
            user_id: MANAGER_ID, // also re-attributing whose cost this week becomes
            entries: [{ project_id: c.projectId, entry_date: c.entryDate, hours: '8.00', project_org_id: ORG_ID }],
          },
          timesheetPushKeyFor(c.timesheetId, forgedApprovedAt),
        );
        const body = (await res.json()) as { error?: string; message?: string };

        expect(res.status, `${c.label}: the forged push must be refused 422, got ${res.status} ${JSON.stringify(body)}`).toBe(422);
        expect(body.error, `${c.label}: classified as commit-rejected`).toBe('commit-rejected');
        expect(body.message, `${c.label}: the gate names the precondition it refused on`).toContain('timesheet-not-approved');

        // No outbox row was ever claimed — the refusal precedes the claim, not follows it.
        const { data: outboxRows, error: outboxErr } = await admin
          .from('external_command_outbox')
          .select('id, state')
          .eq('org_id', ORG_ID)
          .eq('domain', 'timesheets')
          .eq('pmo_record_id', c.timesheetId);
        expect(outboxErr).toBeNull();
        expect(outboxRows ?? [], `${c.label}: no external_command_outbox row`).toHaveLength(0);

        // No side-mirror row was minted — a refused push must not look like an attempted one.
        const { data: mirrorRows } = await admin
          .from('timesheet_erp_mirror')
          .select('id, push_state')
          .eq('org_id', ORG_ID)
          .eq('timesheet_id', c.timesheetId);
        expect(mirrorRows ?? [], `${c.label}: no timesheet_erp_mirror row`).toHaveLength(0);

        // The sheet's own state is untouched: the gate reads, it never writes.
        const { data: sheet } = await admin.from('timesheets').select('status, approved_by, approved_at, user_id').eq('id', c.timesheetId).maybeSingle();
        expect(sheet, `${c.label}: the sheet still exists`).not.toBeNull();
        expect((sheet as { status: string }).status, `${c.label}: the forged payload never moved the sheet's status`).toBe(c.label);
        expect((sheet as { approved_by: string | null }).approved_by, `${c.label}: the forged approver was not adopted`).toBeNull();
      }

      // ⚑ THE GOAL ORACLE — the ERP is the oracle, not PMO state. Not one of the three forged commands
      // put a document on the client's ledger.
      const erpCountAfter = await countErpTimesheets();
      expect(erpCountAfter, 'no ERP Timesheet was created by ANY forged command').toBe(erpCountBefore);
    } finally {
      await cleanupTsp(admin, seeded);
    }
  });
});
