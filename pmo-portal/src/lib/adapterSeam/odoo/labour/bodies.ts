/**
 * The hours half of the Odoo labour seam: approved `timesheet_entries` → `account.analytic.line` bodies (FR-OLH-010,
 * AC-OLH-020), pure. Odoo field names live here and nowhere else in PMO.
 *
 * Bed claims this file is written to, all still assumptions behind the plan's fake until L0 records a verdict:
 * V-OLH-1 (`employee_id` must be sent explicitly: Odoo 422s "Timesheets must be created with an active employee"
 * without one), V-OLH-2 (`account_id` is derived from `project_id` on create, so only `project_id` travels),
 * V-OLH-4 (`amount` is writable at create and stored verbatim — the `payroll` basis sends `0`).
 *
 * Hours are decimal strings and are summed as integers (hundredths of an hour), never as floats: a week of 0.1 + 0.2
 * must not become 0.30000000000000004 in an analytic ledger.
 */
import { divRound, toNano } from '../ledger/cents.ts';

/** One approved timesheet entry, as the gate read it from the database. */
export interface LabourEntry {
  project_id: string;
  /** `YYYY-MM-DD`, the entry's own date. */
  entry_date: string;
  /** A decimal string, 2 dp in practice (V-OLH-2 `unit_amount`). */
  hours: string;
  /** The project's org, when the gate supplied it; a foreign project refuses the push (FR-OLH-011). */
  project_org_id?: string | null;
}

/** One Odoo line: a (project, day) pair with that day's hours summed (D2). */
export interface PackedLabourLine { projectId: string; date: string; hours: number }

export type PackedHours =
  | { outcome: 'ready'; lines: PackedLabourLine[] }
  | { outcome: 'refused'; code: 'daily-hours-exceed-24' | 'hours-invalid' | 'date-invalid' | 'project-foreign-org' };

const HUNDREDTH = 10_000_000n;   // `toNano` is 1e-9 of a unit, so 1e7 nano is one hundredth of an hour
const DAY_LIMIT = 2400n;         // 24.00 h

/** `YYYY-MM-DD` naming a day that exists (`2026-02-30` does not). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * One line per (project, entry date) with that day's hours summed; an entry that cannot be trusted refuses the whole
 * push before any Odoo call (FR-OLH-011), so a malformed week never lands half-posted. A day's hours over 24 is a data
 * fault, not a rounding question. Non-positive day totals are dropped (an analytic line of 0 h says nothing).
 */
export function packLabourLines(entries: readonly LabourEntry[], orgId?: string): PackedHours {
  const byDay = new Map<string, { projectId: string; date: string; hundredths: bigint }>();
  for (const entry of entries) {
    if (orgId !== undefined && entry.project_org_id != null && entry.project_org_id !== orgId) return { outcome: 'refused', code: 'project-foreign-org' };
    if (!isIsoDate(entry.entry_date)) return { outcome: 'refused', code: 'date-invalid' };
    const nano = toNano(entry.hours);
    if (nano === null || nano < 0n) return { outcome: 'refused', code: 'hours-invalid' };
    const hundredths = divRound(nano, HUNDREDTH);
    const key = `${entry.project_id}\u0000${entry.entry_date}`;
    const day = byDay.get(key) ?? { projectId: entry.project_id, date: entry.entry_date, hundredths: 0n };
    day.hundredths += hundredths;
    if (day.hundredths > DAY_LIMIT) return { outcome: 'refused', code: 'daily-hours-exceed-24' };
    byDay.set(key, day);
  }
  const lines = [...byDay.values()]
    .filter((day) => day.hundredths > 0n)
    .map((day) => ({ projectId: day.projectId, date: day.date, hours: Number(day.hundredths) / 100 }));
  return { outcome: 'ready', lines };
}

export type CostBasis = 'payroll' | 'odoo-rate';

export interface LineValueInput {
  /** The project's linked Odoo project id, as resolved by the adapter (`project_id`). */
  projectId: string;
  /** The sheet owner's confirmed Odoo employee id (V-OLH-1). */
  employeeId: string;
  date: string;
  hours: number;
  companyId: number;
  /** `labourLineName`'s output. */
  name: string;
  basis: CostBasis;
}

/**
 * The `account.analytic.line` values for one packed line. Under the `payroll` basis the line carries `amount: 0` and the
 * cost arrives only from the labour-cost journal (D3, V-OLH-4); under `odoo-rate` nothing is sent and Odoo's own
 * `hr.employee.hourly_cost` stands. Sending a zero under both basis would erase an Odoo rate; sending none under
 * payroll would let Odoo invent a cost PMO did not post.
 */
export function buildLineValue(input: LineValueInput): Record<string, unknown> {
  return {
    project_id: Number(input.projectId),
    employee_id: Number(input.employeeId),
    date: input.date,
    unit_amount: input.hours,
    name: input.name,
    company_id: input.companyId,
    ...(input.basis === 'payroll' ? { amount: 0 } : {}),
  };
}

/** The line's description: the PMO sheet and the day. Never a person's name, never a client's (NFR-OLH-001 spirit). */
export function labourLineName({ sheetRef, date }: { sheetRef: string; date: string }): string {
  return `${sheetRef} · ${date}`;
}
