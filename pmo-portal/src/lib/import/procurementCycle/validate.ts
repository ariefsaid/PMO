/**
 * M2 — Pure dry-run oracle for procurement-cycle groups (ADR-0035).
 *
 * validateGroups is synchronous and writes NOTHING. It returns a ValidatedGroup
 * per input group with per-row and group-level errors accumulated. No throwing —
 * all errors are collected and returned.
 *
 * Model-C: a case does NOT require a PR or PO — any combination of record types
 * (including VI+Payment-only) is valid as long as required per-type fields are present
 * and the group has at least a title OR a project.
 */
import type { RefLookup } from '@/src/lib/import/refLookup';
import { refValidate } from '@/src/lib/import/refLookup';
import type { CaseGroup, CycleRow, ValidatedGroup, ValidatedRow } from './types';

// ─── Lookups provided by caller ───────────────────────────────────────────────

export interface ValidateLookups {
  projectLookup: RefLookup;
  vendorLookup: RefLookup;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns null if the string is a valid ISO YYYY-MM-DD date, else an error message. */
function validateDate(raw: string | undefined, label: string): string | null {
  if (!raw?.trim()) return `${label} is required.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return `${label} must be a valid date (YYYY-MM-DD).`;
  }
  return null;
}

/** Returns null if blank/absent or a valid non-negative number; error message otherwise. */
function validateOptionalAmount(raw: string | undefined): string | null {
  if (!raw?.trim()) return null; // optional — absence is fine
  const n = Number(raw.trim());
  if (isNaN(n)) return 'Amount must be a number.';
  if (n < 0) return 'Amount must be ≥ 0.';
  return null;
}

/** Returns null if blank/absent or a valid non-negative number; error if required and absent. */
function validateRequiredAmount(raw: string | undefined): string | null {
  if (!raw?.trim()) return 'Amount is required.';
  const n = Number(raw.trim());
  if (isNaN(n)) return 'Amount must be a number.';
  if (n < 0) return 'Amount must be ≥ 0.';
  return null;
}

function validateEnum(raw: string | undefined, allowed: string[], label: string): string | null {
  if (!raw?.trim()) return `${label} is required. Must be one of: ${allowed.join(', ')}.`;
  if (!allowed.includes(raw.trim())) {
    return `${label} must be one of: ${allowed.join(', ')}.`;
  }
  return null;
}

// ─── Per-type row validation ──────────────────────────────────────────────────

const GR_STATUS = ['Partial', 'Complete'];
const VI_STATUS = ['Received', 'Scheduled', 'Paid'];

/**
 * Validates a single CycleRow's type-specific fields. Returns list of error strings
 * (empty = valid). Does NOT validate group-level attrs (project/title) — those are
 * handled at the group level.
 */
function validateRowFields(
  row: CycleRow,
  projectLookup: RefLookup,
  vendorLookup: RefLookup,
): string[] {
  const errors: string[] = [];

  // Project: optional per-row (only needed if set), but if set must resolve
  if (row.project?.trim()) {
    const err = refValidate(projectLookup, false)(row.project);
    if (err) errors.push(err);
  }

  switch (row.type as string) {
    case 'PR':
    case 'RFQ':
    case 'PO': {
      // Optional fields: status (any string), date (YYYY-MM-DD if present), amount (≥ 0 if present)
      if (row.date?.trim()) {
        const err = validateDate(row.date, 'Date');
        if (err && !err.includes('required')) errors.push(err);
      }
      const amtErr = validateOptionalAmount(row.amount);
      if (amtErr) errors.push(amtErr);
      break;
    }

    case 'Quotation': {
      // Required: vendor (must resolve), amount (≥ 0), date (YYYY-MM-DD)
      const vendorRaw = row.vendor?.trim() ?? '';
      const vendorErr = vendorRaw
        ? refValidate(vendorLookup, true)(vendorRaw)
        : 'Vendor is required.';
      if (vendorErr) errors.push(vendorErr);
      const amtErr = validateRequiredAmount(row.amount);
      if (amtErr) errors.push(amtErr);
      const dateErr = validateDate(row.date, 'Date');
      if (dateErr) errors.push(dateErr);
      break;
    }

    case 'GR': {
      // Required: status (Partial|Complete), date
      const statusErr = validateEnum(row.status, GR_STATUS, 'Status');
      if (statusErr) errors.push(statusErr);
      const dateErr = validateDate(row.date, 'Date');
      if (dateErr) errors.push(dateErr);
      break;
    }

    case 'VI': {
      // Required: status (Received|Scheduled|Paid), date; optional: amount
      const statusErr = validateEnum(row.status, VI_STATUS, 'Status');
      if (statusErr) errors.push(statusErr);
      const dateErr = validateDate(row.date, 'Date');
      if (dateErr) errors.push(dateErr);
      const amtErr = validateOptionalAmount(row.amount);
      if (amtErr) errors.push(amtErr);
      break;
    }

    case 'Payment': {
      // Optional: status (any string), date, amount
      if (row.date?.trim()) {
        const err = validateDate(row.date, 'Date');
        if (err && !err.includes('required')) errors.push(err);
      }
      const amtErr = validateOptionalAmount(row.amount);
      if (amtErr) errors.push(amtErr);
      break;
    }

    default: {
      errors.push(`Unknown record type: "${row.type}".`);
    }
  }

  return errors;
}

// ─── Group-level validation ───────────────────────────────────────────────────

/**
 * Pure dry-run oracle. Validates each group's rows against their type-specific
 * required-field rules and the group-level invariant (must have title OR project).
 *
 * @param groups - Groups produced by groupRows.
 * @param lookups - projectLookup + vendorLookup for ref resolution.
 * @returns ValidatedGroup[] with per-row and group errors accumulated.
 */
export function validateGroups(
  groups: CaseGroup[],
  { projectLookup, vendorLookup }: ValidateLookups,
): ValidatedGroup[] {
  return groups.map((group) => {
    const groupErrors: string[] = [];

    // Group-level invariant: must have at least title OR project attr
    const hasTitle = !!group.attrs.title?.trim();
    const hasProject = !!group.attrs.project?.trim();
    if (!hasTitle && !hasProject) {
      groupErrors.push('Case must have at least a title or a project set.');
    }

    // Per-row validation
    const rows: ValidatedRow[] = group.rows.map((row) => {
      const errors = validateRowFields(row, projectLookup, vendorLookup);
      return {
        rowNumber: row.rowNumber,
        valid: errors.length === 0,
        errors,
      };
    });

    const anyRowValid = rows.some((r) => r.valid);
    const valid = groupErrors.length === 0 && anyRowValid;

    return { group, groupErrors, rows, valid };
  });
}
