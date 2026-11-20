import type { StatusVariant } from '@/src/components/ui';
import type { CertificateStatus, ExcludedReason } from '@/src/lib/db/subcontractCertificates';

/** Pill colour per certificate state: colour plus the label carry the state (screen rule). */
export const STATUS_VARIANT: Record<CertificateStatus, StatusVariant> = {
  draft: 'draft', submitted: 'progress', returned: 'warn', approved: 'open', billed: 'won', cancelled: 'superseded',
};

export const STATUSES: CertificateStatus[] = ['draft', 'submitted', 'returned', 'approved', 'billed', 'cancelled'];

export const REASON_CODES = ['rework', 'damaged', 'safety', 'materials_supplied', 'other'] as const;

/** Every excluded-source reason the derive can name (FR-SPC-006). */
export const EXCLUDED_REASONS: ExcludedReason[] = [
  'unrated_no_rate', 'unrated_currency', 'unrated_unit', 'unrated_above_po_rate', 'not_vendor_crew', 'report_not_validated',
  'report_superseded', 'item_not_on_po', 'already_certified', 'deselected',
];

/** First day of a month as `YYYY-MM-01` from an `<input type="month">` value (`YYYY-MM`). */
export function monthStart(value: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? `${value}-01` : null;
}

/** English defaults for the dynamic keys (the catalogue holds the translations). */
export const STATUS_DEFAULT: Record<CertificateStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', returned: 'Returned', approved: 'Approved', billed: 'Billed', cancelled: 'Cancelled',
};
export const BACKCHARGE_REASON_DEFAULT: Record<string, string> = {
  rework: 'Rework', damaged: 'Damage', safety: 'Safety', materials_supplied: 'Materials supplied', other: 'Other',
};
