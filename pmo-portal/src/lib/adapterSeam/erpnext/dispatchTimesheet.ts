/** Timesheet-domain dispatch preparation for the ERPNext adapter (T-31 / ADP-021 / XG04-004, P3b —
 *  FR-TSP-050..055): the confirmed-employee lookup and the fail-closed timesheet ref pre-flight.
 *  Moved verbatim from `dispatchFactory.ts`; the factory calls `resolveTimesheetRefs` at the SAME
 *  point in its ordered orchestration (after the procurement/revenue/payment resolution, before the
 *  budget config merge). */
import { AppError } from '../../appError.ts';
import { resolveExternalRef, type ExternalRefsLookupClient } from '../refs.ts';
import { packTimeLogs } from './timeLogPacking.ts';
import type { DispatchServiceClient, ErpDispatchFactoryDeps, ExternalOrgBindingRow } from './dispatchTypes.ts';

/** The PMO user's CONFIRMED ERP Employee (FR-TSP-051; reused by #775 phase B, FR-EXP-106). `proposed` is never
 *  authoritative; the org filter is in the query; the ERP name comes from `external_refs`, never a mirror column. */
export type ConfirmedEmployeeLookup =
  | { status: 'no-link' }
  | { status: 'no-ref'; employeeId: string }
  | { status: 'ok'; employee: string };

export async function lookupConfirmedErpEmployee(
  serviceClient: DispatchServiceClient,
  orgId: string,
  profileId: string,
): Promise<ConfirmedEmployeeLookup> {
  const { data, error } = await serviceClient
    .from('erp_employees')
    .select('id, employee_number, org_id')
    .eq('org_id', orgId)
    .eq('profile_id', profileId)
    .eq('link_state', 'confirmed')
    .maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const employeeId = (data as { id?: string } | null)?.id;
  if (!employeeId) return { status: 'no-link' };
  // The ERP target comes from `external_refs`, never from a mirrored display column.
  const external = await resolveExternalRef(serviceClient as unknown as ExternalRefsLookupClient, orgId, 'timesheets', employeeId);
  if (!external) return { status: 'no-ref', employeeId };
  return { status: 'ok', employee: external.startsWith('Employee:') ? external.slice('Employee:'.length) : external };
}

/**
 * Resolve `timesheets`-domain refs. EVERY resolution is FAIL-CLOSED and happens HERE — before the
 * adapter is constructed, therefore before the outbox claim and before the ERP POST (FR-TSP-050;
 * Luna BLOCK-6: P3a validated cross-org AFTER the external write, which can leave committed money
 * with no PMO row — the P3b twin is committed HOURS with no PMO push record). A miss THROWS a
 * classified `AppError`; it is NEVER silently omitted from the body (Luna SF9).
 *
 * ⚑ This is the ONLY backstop for two of these dimensions. ERPNext validates neither the `employee`
 * nor the `project` link (spike §8 — a Frappe `fetch_from` quirk): a garbage or stale value is
 * accepted through save AND submit with a clean 200 and no error, silently attributing a week of
 * hours to a phantom employee or posting it with no project dimension.
 *
 * The record's `user_id`/`entries` are SERVER TRUTH, re-read by `approved_timesheet_for_push`
 * (migration 0138) in the dispatch's approval gate and substituted onto the command — never a
 * caller-supplied payload (ADR-0059 §3.3).
 */
export async function resolveTimesheetRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ refs: Record<string, string | null> }> {
  const refs: Record<string, string | null> = {};
  const record = deps.command.record as {
    erp_doc_kind?: string;
    user_id?: string;
    entries?: Array<{ project_id: string; entry_date: string; hours: string; project_org_id?: string }>;
  };
  if (record.erp_doc_kind !== 'timesheet') return { refs };

  const config = binding.config ?? {};
  const entries = record.entries ?? [];

  // (1) employee — via the CONFIRMED adopt link ONLY (FR-TSP-051). NEVER auto-create an HR master;
  //     NEVER a shared default (it would mis-attribute cost). 'proposed' is NOT authoritative: an
  //     ERP-side email edit may PROPOSE a link but must never silently re-point whose cost a week
  //     becomes. The org filter is in the QUERY, so a cross-org row cannot even be read (FR-TSP-054).
  const lookup = await lookupConfirmedErpEmployee(deps.serviceClient, deps.orgId, record.user_id ?? '');
  if (lookup.status === 'no-link') {
    throw new AppError(
      `no confirmed erp_employees link for user '${record.user_id ?? ''}' — an Admin must confirm it`,
      'employee-unlinked',
    );
  }
  if (lookup.status === 'no-ref') {
    throw new AppError(`employee '${lookup.employeeId}' has no external_refs mapping`, 'employee-unlinked');
  }
  refs.employee = lookup.employee;

  // (2) activity type — mandatory at submit whenever `employee` is set (spike §1b), and P3b always
  //     sets it. Fail closed rather than let ERP reject the whole document after the claim.
  if (typeof config.default_activity_type !== 'string' || config.default_activity_type.length === 0) {
    throw new AppError('binding config has no default_activity_type', 'activity-type-unconfigured');
  }

  // (3) per-entry project — fail-closed. An unmapped project is a REJECT, never an omitted dimension.
  const projectMap = (config.project_map as Record<string, string> | undefined) ?? {};
  for (const entry of entries) {
    // (4) same-org pre-flight BEFORE the external write (FR-TSP-054). `project_org_id` comes from the
    //     gate RPC — server truth, never the payload.
    if (entry.project_org_id && entry.project_org_id !== deps.orgId) {
      throw new AppError(`project '${entry.project_id}' belongs to another org`, 'cross-org-link-rejected');
    }
    const erpProject = projectMap[entry.project_id];
    if (!erpProject) throw new AppError(`no project_map entry for project '${entry.project_id}'`, 'project-unmapped');
    refs[`project:${entry.project_id}`] = erpProject;
  }

  // (5) daily-hours pre-validation (FR-TSP-055): PMO caps a single entry at 24h but not a DAY's total
  //     across projects, and ERP caps neither (spike §7 — it accepts the spill 200-clean and quietly
  //     mis-dates the tail into the next ERP day). Run the real packing here so the rejection happens
  //     before the claim, not inside `toBody` after it.
  try {
    packTimeLogs(
      entries.map((e) => ({ project_id: e.project_id, entry_date: e.entry_date, hours: e.hours })),
      typeof config.timesheet_day_start === 'string' ? config.timesheet_day_start : '09:00:00',
    );
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : 'timesheet entries could not be packed', 'commit-rejected');
  }

  return { refs };
}
