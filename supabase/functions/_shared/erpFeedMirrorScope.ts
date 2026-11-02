import { KIND_DOMAIN, KIND_MIRROR_TABLE, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { budgetVersionIdOf, fiscalYearOf } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';
import { parseBudgetIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';

/**
 * The mirror table's own lookup column keyed to `pmoRecordId`.
 *
 * Every P0/P1/P2/P3a mirror is minted with `table.id === pmoRecordId` (`mintMirrorRow`/`mintWithId`
 * pass the PMO id in as the row's OWN primary key), so `.eq('id', pmoRecordId)` is correct for them.
 *
 * ⚑ Both Posture-B SIDE mirrors (ADR-0059 §6) are the exception, and for the SAME reason: they are
 * keyed by their OWN generated `id` (`default gen_random_uuid()`) with the PMO record living in a
 * SEPARATE FK column, because the outbound push writer (`readModelWriters.ts`) upserts on that FK
 * column's own unique constraint, never sets `id` explicitly, and (for `budget`) the grain genuinely
 * isn't 1:1 with a single PMO id at all (`(budget_version_id × fiscal_year)` — forward-compat for
 * OQ-BUD-3(c), more than one row CAN exist per version):
 *   • `timesheet` → `timesheet_erp_mirror.timesheet_id` (migration 0136; unique 1:1 with `timesheets.id`,
 *     upserted `onConflict:'timesheet_id'` — `readModelWriters.ts`'s `timesheetsWriter`).
 *   • `budget` → `budget_version_erp_mirror.budget_version_id` (migration 0137; NOT unique alone —
 *     `unique(org_id, budget_version_id, fiscal_year)` — upserted on that composite).
 * Querying `.eq('id', pmoRecordId)` for either would match NO row — a Postgres 0-row match is not an
 * error, so `updateMirror`/`tombstoneMirror`/`readMirrorSourceMod`/`mirrorExists`/`stampAmended`
 * (the last one converted by audit-r3 L-1) would all silently
 * no-op: a Desk-cancelled Timesheet/Budget would never reach `failed`/`held` (the mirror stays
 * `pushed` forever, and `readMirrorSourceMod` always returns `null`, disabling the staleness guard
 * too). This is exactly the class of bug the FR-BUD-102 "never trusts itself" invariant exists to
 * catch downstream — but it must be caught HERE, at the query, not papered over by the caller.
 */
export function pmoRecordLookupColumn(kind: ErpDocKind): string {
  // #775 phase B — the expense side mirror (0270 §3) is keyed by `posting_identity` (`<subject>:<posting>`),
  // which is exactly the outbox / external_refs identity of every posting PMO lands.
  if (KIND_DOMAIN[kind] === 'expenses') return 'posting_identity';
  if (kind === 'timesheet') return 'timesheet_id';
  if (kind === 'budget') return 'budget_version_id';
  return 'id';
}

/**
 * ⚑ FR-BFY-038 (review finding 3) — the VALUE half of the same question the column above answers.
 *
 * `external_refs.pmo_record_id` for the budget domain is the YEAR-QUALIFIED identity
 * `<budget_version_id>:<encoded_fiscal_year>` (the outbox/refs grain is per fiscal year since the push
 * fans out), while `budget_version_erp_mirror.budget_version_id` is — and must stay — a `uuid` (it is
 * the FK, and the mirror's own grain is `(budget_version_id × fiscal_year)`). Handing the qualified
 * value straight to `.eq('budget_version_id', …)` is a non-UUID against a uuid column: an ERP-side
 * CANCEL then errors or matches nothing, the mirror row is never tombstoned, and PMO keeps reporting an
 * enforced ERP control that no longer exists.
 *
 * Only the budget domain is touched, and only when the identity actually carries a year component — a
 * pre-fan-out bare id passes through unchanged, and every other kind is byte-for-byte.
 */
function mirrorLookupValue(kind: ErpDocKind, pmoRecordId: string): string {
  if (kind !== 'budget' || !pmoRecordId.includes(':')) return pmoRecordId;
  return budgetVersionIdOf(pmoRecordId);
}

export function mirrorTable(kind: ErpDocKind, pmoRecordId: string): string {
  if (kind !== 'budget' || !pmoRecordId.includes(':')) return KIND_MIRROR_TABLE[kind];
  try {
    if (parseBudgetIdentity(pmoRecordId).erpAccount !== null) return 'budget_version_account_erp_mirror';
  } catch {
    // Legacy year-qualified identities are parsed below by their existing fiscal-year path.
  }
  return KIND_MIRROR_TABLE[kind];
}

/**
 * ⚑ FR-BFY-038 (FU-2 review, BLOCKER 1) — the OTHER half of the identity: the fiscal year.
 *
 * `mirrorLookupValue` recovers the bare FK, but the budget mirror grain is
 * `(budget_version_id × fiscal_year)` — more than one row CAN exist per version (the multi-FY fan-out).
 * Filtering a read/update/tombstone/amend on the bare FK ALONE therefore selects EVERY year's row: a
 * Desk cancel of FY2027 would tombstone the still-live FY2026 control (excluding it from the sweep), and
 * a `maybeSingle()` over two rows rejects. Once the identity is year-qualified the fiscal year must
 * travel with it through every query. This returns the exact `fiscal_year` predicate value for a
 * year-qualified budget identity, or `null` (no predicate) for a pre-fan-out bare id or any other kind.
 */
function mirrorFiscalYear(kind: ErpDocKind, pmoRecordId: string): string | null {
  if (kind !== 'budget' || !pmoRecordId.includes(':')) return null;
  try {
    const parsed = parseBudgetIdentity(pmoRecordId);
    if (parsed.erpAccount !== null) return parsed.fiscalYear;
  } catch {
    // Preserve the legacy fiscal-year identity parser behavior.
  }
  return fiscalYearOf(pmoRecordId);
}

/** A minimal chainable-`.eq` seam — every supabase-js select/update filter builder satisfies it. Kept
 *  NON-generic (self-referential) so `scopeMirrorQuery`'s internals never recurse into supabase-js's
 *  deep builder generics (TS2589). */
interface EqQuery { eq(column: string, value: unknown): EqQuery; }

/**
 * Apply the full mirror scope to a query: `org_id` + the kind's lookup column + (for a year-qualified
 * budget identity) the exact `fiscal_year`. The ONE place the grain is enforced, so no writer can drift.
 * `T` is the concrete builder type, passed through untouched so call sites keep `.maybeSingle()` / the
 * thenable-await ergonomics; the scoping runs against the erased `EqQuery` seam in between.
 */
export function scopeMirrorQuery<T>(query: T, kind: ErpDocKind, lookupColumn: string, orgId: string, pmoRecordId: string): T {
  let scoped = (query as unknown as EqQuery).eq('org_id', orgId).eq(lookupColumn, mirrorLookupValue(kind, pmoRecordId));
  const fiscalYear = mirrorFiscalYear(kind, pmoRecordId);
  if (fiscalYear !== null) scoped = scoped.eq('fiscal_year', fiscalYear);
  if (kind === 'budget' && mirrorTable(kind, pmoRecordId) === 'budget_version_account_erp_mirror') {
    scoped = scoped.eq('erp_account', parseBudgetIdentity(pmoRecordId).erpAccount);
  }
  return scoped as unknown as T;
}
