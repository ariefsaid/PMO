/**
 * Timesheet `toBody`/`fromDoc` — FROZEN by docs/spikes/2026-07-20-erpnext-timesheet-fields.md §9
 * (P3b, FR-TSP-060..064). `toBody` sends exactly §9's field list:
 * `{employee, time_logs:[{from_time, to_time, activity_type, project}]}`.
 *
 * Every dimension it carries (employee, per-row project, activity type) is resolved SERVER-SIDE and
 * FAIL-CLOSED by `resolveTimesheetRefs` (dispatchFactory) BEFORE the outbox claim. This builder
 * NEVER omits an unresolved dimension and NEVER falls back to a default (Luna SF9/BLOCK-5) — it
 * throws. That is load-bearing rather than defensive: ERPNext validates NEITHER `employee` NOR
 * `project` links (spike §8 — a Frappe `fetch_from` quirk), so a garbage or absent value is accepted
 * with a clean `200` and silently attributes a week of hours to a phantom employee/no project.
 *
 * ⛔ NO `hours` on a row: both timestamps are sent, and whenever both are present ERP RECOMPUTES
 *    `hours` from them (spike §1a) — sending it adds no control and invites an epsilon round-trip.
 * ⛔ NO billing fields (OWNER RULING 2026-07-16 — P3b is COSTING ONLY): no `is_billable`/
 *    `billing_hours`/`billing_rate`, no Timesheet→Sales-Invoice linkage. Adding one is a scope
 *    violation, not a favour.
 * ⛔ NO `note`: that is the recovery ANCHOR, stamped by the adapter's `stampAnchor` from the
 *    idempotency key (ADR-0058 §3). A builder that also wrote it would clobber the anchor.
 *
 * `fromDoc` mirrors ERP's server-computed totals as the ORACLE (ADR-0048) — PMO never recomputes
 * them from `timesheet_entries`; a divergence is a reportable signal, not a local correction.
 */
import { AdapterError } from '../../contract.ts';
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { packTimeLogs, type TimesheetEntryInput } from '../timeLogPacking.ts';
import { mirrorMoney } from '../moneyShape.ts';

const DEFAULT_DAY_START = '09:00:00';

function requireRef(ctx: ErpCtx, key: string, what: string): string {
  const value = ctx.refs[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AdapterError('commit-rejected', `unresolved ${what} — refusing to build a Timesheet body without it`);
  }
  return value;
}

export function tsToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const employee = requireRef(ctx, 'employee', 'employee link');
  const activityType = ctx.config.default_activity_type;
  if (typeof activityType !== 'string' || activityType.length === 0) {
    // Mandatory at submit whenever the header `employee` is set (spike §1b) — and P3b always sets it.
    throw new AdapterError('commit-rejected', 'binding config has no default_activity_type (activity_type is mandatory)');
  }
  const dayStart = typeof ctx.config.timesheet_day_start === 'string' ? ctx.config.timesheet_day_start : DEFAULT_DAY_START;
  const logs = packTimeLogs((rec.entries ?? []) as TimesheetEntryInput[], dayStart);
  return {
    employee,
    time_logs: logs.map((log) => ({
      from_time: log.from_time, // naive site-local (FR-TSP-063) — a Z/offset suffix is a raw ERP 500
      to_time: log.to_time,
      activity_type: activityType,
      project: requireRef(ctx, `project:${log.project_id}`, `project mapping for '${log.project_id}'`),
    })),
  };
}

export function tsFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    ts_number: String(d.name),
    // The ORACLE (ADR-0048): ERP's own computed totals, mirrored verbatim. `total_costing_amount` is an
    // informational document field — Timesheet submit posts NO GL entry (spike §5).
    erp_total_hours: mirrorMoney(d.total_hours),
    erp_total_costing_amount: mirrorMoney(d.total_costing_amount),
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}

/** The list-endpoint fields `tsFromDoc` actually READS. The modified-poll sweep builds its
 *  `fields=[…]` request from this, so a mirrored row is never written with NULLs for data the ERP doc
 *  carries. Co-located with the mapper so the two cannot drift apart. */
export const TS_FROM_DOC_FIELDS = [
  'name',
  'modified',
  'docstatus',
  'amended_from',
  'total_hours',
  'total_costing_amount',
] as const;
