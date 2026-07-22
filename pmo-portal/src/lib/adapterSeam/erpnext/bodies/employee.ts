/**
 * Employee `fromDoc` — FROZEN by docs/spikes/2026-07-20-erpnext-timesheet-fields.md §8b/§9 (P3b,
 * FR-TSP-090..095). READ-ONLY (FR-TSP-093): there is NO real `toBody` — PMO never creates/updates an
 * ERP Employee. The kind exists solely for the inbound adopt (ADR-0059 §5's master-data exception:
 * the never-adopt rule governs this domain's PROCESS documents — Timesheet — not the masters they
 * reference). `employeeToBody` throws unconditionally, so a mis-registration (some future dispatch
 * path accidentally routing a write at this kind) is loud, never a silent write.
 *
 * ⛔ PII minimization (FR-TSP-095, NFR-TSP-SEC-002): mirror ONLY the fields below. The Employee
 *    doctype carries salary/bank/national-id fields — the adapter reads a WIDE doctype and must mirror
 *    a NARROW row. `employeeFromDoc`'s returned key set is asserted exactly in `employee.test.ts` for
 *    this reason — an accidental extra key is the leak class this guards against.
 *
 * `work_email` reads `doc.prefered_email` — ERPNext's OWN resolved "the" contact email (spike §8b),
 * NOT `company_email`/`personal_email` directly (two independently-editable free-text fields the
 * adapter must not have to choose between). It is the OQ-TSP-10(C) match CANDIDATE only — never
 * authoritative by itself (only a Human `confirm_erp_employee_link` authorizes a push, FR-TSP-051).
 * `erp_user_id` mirrors `doc.user_id`, which spike §8b proved is OFTEN absent (not an HR-provisioning
 * guarantee) — never assumed populated. `erp_amended_from`/`erp_cancelled_at` are always `null`:
 * Employee is NOT submittable (`is_submittable: 0`, no `amended_from` field, no cancel lifecycle,
 * spike §8b) — mirrored here only for column-shape uniformity with the other adopted kinds.
 */
import { AdapterError } from '../../contract.ts';
import type { PmoRecord } from '../../contract.ts';

/** PMO never writes an ERP Employee (FR-TSP-093) — always throws. No `ctx`/`rec` parameter: a caller
 *  that reaches this at all is a mis-registration, not a legitimate command with a shape to inspect. */
export function employeeToBody(): never {
  throw new AdapterError('commit-rejected', 'employee-is-read-only');
}

export function employeeFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    employee_number: String(d.name),
    employee_name: (d.employee_name as string | null | undefined) ?? null,
    work_email: (d.prefered_email as string | null | undefined) ?? null,
    erp_user_id: (d.user_id as string | null | undefined) ?? null,
    erp_status: (d.status as string | null | undefined) ?? null,
    erp_docstatus: (d.docstatus as number | null | undefined) ?? null,
    erp_modified: (d.modified as string | null | undefined) ?? null,
    erp_amended_from: null,
    erp_cancelled_at: null,
  };
}

/** The list-endpoint fields `employeeFromDoc` actually READS (the Luna BLOCK 6 discipline — the
 *  modified-poll sweep builds its `fields=[…]` request from this, so an adopted/updated row is never
 *  written with NULLs for data the ERP doc carries). Co-located with the mapper so the two cannot
 *  drift apart. `company` is deliberately absent: Employee is not company-scoped in the sweep
 *  (`companyScope.ts` — a global-ish master like Supplier/Customer, not a per-company transaction). */
export const EMPLOYEE_FROM_DOC_FIELDS = [
  'name',
  'modified',
  'employee_name',
  'prefered_email',
  'user_id',
  'status',
] as const;
