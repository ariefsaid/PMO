import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import type { ExternalRefsLookupClient } from '../../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { parseBudgetIdentity } from '../../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import type { ReadModelWriter } from './types.ts';

/**
 * P3c ERPNext `budget` writer (ADR-0059 §6 side mirror).
 *
 * ⚑ POSTURE B. This writer records EXTERNAL-SIDE STATE ONLY, into `budget_version_erp_mirror` (0137).
 * It deliberately has NO route to `budget_versions`/`budget_line_items`: PMO is the SoT for the budget
 * figure (OD-BUDGET-1), the push is one-way, and this code runs as SERVICE ROLE — RLS would not stop it
 * if it tried. The mirror's whole value is that `drop table` reverses P3c with zero PMO data loss.
 *
 * `activated_at_witness` (ADR-0059 §6) IS written here (#479). It must be resolved from DB truth by
 * the push gate, never authored by a caller — and it is: `runBudgetGate` server-reads
 * `budget_versions.activated_at`, the idempotency key is derived from that same value, and it rides
 * the command as a NON-body field exactly like the FR-BFY-080 span witness. ⚑ The comment here
 * previously said it "stays null until that gate lands"; the gate landed with `0139` and this stayed
 * unwritten for three migrations, which is what issue #479 was filed about.
 */
export const budgetWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const kind = (command.record as { erp_doc_kind?: string }).erp_doc_kind;
    if (kind !== 'budget') {
      throw new AppError(`erpnext budget read-model writer for erp_doc_kind '${String(kind)}' is not wired`, 'UNSUPPORTED_DOMAIN');
    }
    const record = command.record as { outbox_identity?: unknown; fiscal_year?: unknown; erp_account?: unknown; budget_intent?: unknown };
    const identity = typeof record.outbox_identity === 'string' ? parseBudgetIdentity(record.outbox_identity) : null;
    // The account-framed outbox identity and server unit record remain authoritative if a replayed
    // canonical was persisted by an older/partial finalizer with only its bare PMO id.
    const fiscalYear = typeof canonical.fiscal_year === 'string'
      ? canonical.fiscal_year
      : identity?.erpAccount !== null && identity?.erpAccount !== undefined
        ? identity.fiscalYear
        : undefined;
    // The mirror's grain is (budget_version_id x fiscal_year) — a row written without the fiscal year
    // would be a wrong-grain row that the next push could not find, so this fails loudly instead.
    if (typeof fiscalYear !== 'string' || fiscalYear === '') {
      throw new AppError('budget mirror: the pushed budget carries no fiscal year', 'commit-rejected');
    }
    // ⚑ FR-BFY-080 — THE PUSH-TIME SPAN WITNESS. `get_budget_projection` attributes un-phased (NULL
    // `fiscal_year`) lines to this year ONLY while the project's CURRENT dates still match the dates
    // the GATE read when it resolved the year (0153 §3a/§4). Those dates ride on the command as a
    // NON-body field, stamped from `runBudgetGate`'s own re-read of `projects` — never from a payload
    // the caller could author. A `pushed` row with a NULL witness is a DEFECT, not a backward-compat
    // case: the drift check could then never fire and an extended project would keep attributing its
    // whole un-phased budget to the old year forever.
    const witnessStart = (command.record as { project_start_date?: unknown }).project_start_date;
    if (typeof witnessStart !== 'string' || witnessStart === '') {
      throw new AppError('budget mirror: the pushed budget carries no push-time project span witness', 'commit-rejected');
    }
    const witnessEnd = (command.record as { project_end_date?: unknown }).project_end_date;
    // ⚑ #479 — THE ADR-0059 §6 STATE-STAMP WITNESS (docs/adr/0059…:192-193 requires "a server-resolved
    // witness of the state stamp the push was keyed on"). Without it there was no record of WHICH
    // activation the ERP `Budget` corresponds to: a version rolled back and re-activated pushes under
    // a new key, but the mirror could not say which of the two the live ERP document came from.
    //
    // Same NON-body provenance as the span witness above, and the same failure posture: a `pushed` row
    // with no witness is a DEFECT, not a backward-compat case, so this fails loudly rather than
    // writing NULL. `0139`'s H-3 rows (Active before `0139`, `activated_at` NULL forever) never reach
    // here — `runBudgetGate` refuses them at `budgetGate.ts:290` with `unstamped-activation`, which is
    // deliberate: `0139` rejects backfilling a fabricated stamp, and forging one would forge the key.
    const witnessActivatedAt = (command.record as { activated_at?: unknown }).activated_at;
    if (typeof witnessActivatedAt !== 'string' || witnessActivatedAt === '') {
      throw new AppError('budget mirror: the pushed budget carries no activation witness', 'commit-rejected');
    }
    if (identity?.erpAccount !== null && identity?.erpAccount !== undefined) {
      const account = identity.erpAccount;
      if (identity.fiscalYear !== fiscalYear || record.erp_account !== account ||
          (canonical.erp_account !== undefined && canonical.erp_account !== account)) {
        throw new AppError('budget mirror: account identity does not match canonical lifecycle', 'commit-rejected');
      }
      if (record.budget_intent !== 'ensure' && record.budget_intent !== 'remove') {
        throw new AppError('budget mirror: account intent is invalid', 'commit-rejected');
      }
      if (ctx.isReplay) {
        const { data: existing, error: readError } = await (ctx.serviceClient as unknown as ExternalRefsLookupClient)
          .from('budget_version_account_erp_mirror').select('erp_cancelled_at')
          .eq('org_id', ctx.orgId).eq('budget_version_id', String(canonical.id))
          .eq('fiscal_year', fiscalYear).eq('erp_account', account).maybeSingle();
        if (readError) throw new AppError(readError.message, readError.code);
        if ((existing as { erp_cancelled_at?: string | null } | null)?.erp_cancelled_at != null) return;
      }
      const { error } = await ctx.serviceClient.from('budget_version_account_erp_mirror').upsert({
        org_id: ctx.orgId, budget_version_id: canonical.id, fiscal_year: fiscalYear,
        erp_account: account, budget_intent: record.budget_intent,
        push_state: 'pushed', push_error: null,
        pushed_project_start_date: witnessStart,
        pushed_project_end_date: typeof witnessEnd === 'string' && witnessEnd !== '' ? witnessEnd : null,
        activated_at_witness: witnessActivatedAt,
        erp_budget_name: (canonical.erp_budget_name as string | null | undefined) ?? null,
        erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null,
        erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
        erp_cancelled_at: record.budget_intent === 'remove' ? new Date().toISOString() : null,
        pushed_at: new Date().toISOString(),
      }, { onConflict: 'org_id,budget_version_id,fiscal_year,erp_account' });
      if (error) throw new AppError(error.message, error.code);
      return;
    }
    // ⚑ BLOCKER 2 (FU-2) — a REPLAY must never resurrect a Desk-cancelled Budget. A retry of an already-
    // `confirmed` outbox row converges the STORED canonical (no fresh ERP write). If the accountant
    // cancelled the ERP Budget after this push confirmed, the inbound feed tombstoned the mirror
    // (`erp_cancelled_at` set, push_state 'failed'). Overwriting that with 'pushed' + clearing the
    // tombstone would make PMO report ERPNext enforcing a Budget the operator cancelled (FR-BUD-142).
    // Only a FRESH push (`isReplay` false — a real ERP commit in THIS dispatch) may supersede a cancel;
    // a replay leaves the honest Desk-cancel state alone.
    if (ctx.isReplay) {
      const { data: existing, error: readError } = await (ctx.serviceClient as unknown as ExternalRefsLookupClient)
        .from('budget_version_erp_mirror')
        .select('erp_cancelled_at')
        .eq('org_id', ctx.orgId)
        .eq('budget_version_id', String(canonical.id))
        .eq('fiscal_year', fiscalYear)
        .maybeSingle();
      if (readError) throw new AppError(readError.message, readError.code);
      if ((existing as { erp_cancelled_at?: string | null } | null)?.erp_cancelled_at != null) {
        return; // the Desk cancel stands — a stored-canonical replay carries no fresh ERP success to override it
      }
    }
    const { error } = await ctx.serviceClient.from('budget_version_erp_mirror').upsert(
      {
        org_id: ctx.orgId,
        budget_version_id: canonical.id,
        fiscal_year: fiscalYear,
        push_state: 'pushed',
        push_error: null,
        pushed_project_start_date: witnessStart,
        pushed_project_end_date: typeof witnessEnd === 'string' && witnessEnd !== '' ? witnessEnd : null,
        // ⚑ Stamped UNCONDITIONALLY, and the timesheet twin's monotonicity fence
        // (`0164:231-236`, `excluded.approved_at_pushed >= existing`) is deliberately NOT copied.
        // That fence exists because `record_timesheet_command_held` is reachable from several
        // outcome paths that can interleave. This branch is a FRESH push only — `ctx.isReplay` has
        // already returned above for a stored-canonical replay — and a fresh push carries the
        // activation the gate read moments earlier under the key it derived from it. The residual
        // is a genuine one and worth naming: two dispatches for two activations of the same version
        // could still complete out of order, leaving the older witness last. Closing it needs the
        // upsert to become a definer RPC with a conditional `where`, which is the twin's shape and
        // a bigger change than this issue; the span witness beside it has carried the identical
        // exposure since FR-BFY-080 shipped.
        activated_at_witness: witnessActivatedAt,
        erp_budget_name: (canonical.erp_budget_name as string | null | undefined) ?? null,
        erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null,
        erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
        pushed_at: new Date().toISOString(),
        // ⚑ M-1 (Luna audit round 3) — THE clearing writer MEDIUM-G's sticky tombstone depends on.
        // `erp_cancelled_at` on the two PMO-SoT kinds is deliberately NOT cleared by the inbound feed
        // (it is the sweep backstop's candidate-query exclusion, `listPendingBudgetPushes`), which is
        // only safe because a FRESH PMO PUSH supersedes the cancelled ERP document — and that writer
        // did not exist. An `upsert` updates ONLY the columns it names, so a tombstone set by a Desk
        // cancel survived a successful re-push and excluded that version from the backstop FOREVER:
        // the next failed push was silently stranded, with nothing on screen to say so (FR-BUD-123).
        // This row now mirrors a live ERP document, so the cancellation belongs to its predecessor.
        erp_cancelled_at: null,
      },
      { onConflict: 'org_id,budget_version_id,fiscal_year' },
    );
    if (error) throw new AppError(error.message, error.code);
  },
};

// Both P2 ERPNext domains are wired: `companies` (task 3.6, supplier/customer parties) and
// `procurement` (task 4.5/5.4, the per-erp_doc_kind money-doc switch above) — one registry entry per
// domain, never a per-slice edit to another domain's entry (confinement, FR-ENA-013/090).
// P3a adds `revenue` (task 2.4) additively.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// P3b — the `timesheets` writer (ADR-0059 Posture B: PMO-SoT + an external SIDE mirror)
// ════════════════════════════════════════════════════════════════════════════════════════════════
