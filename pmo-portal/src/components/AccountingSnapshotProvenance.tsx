import React from 'react';
import { cn } from '@/src/components/ui/cn';

/**
 * AccountingSnapshotProvenance (Slice 7 task 7.8, ADR-0048): a read-only provenance strip for the
 * actuals / AP-AR aging snapshot read surface. Shows the snapshot's `as_of` (the coherent instant
 * the figures were read), its `source_report` (which ERP report/ledger produced them — incl. the
 * mirrored-ledger fallback marker), and the optional `report_version` (the ERPNext/Frappe version the
 * report ran against). When no snapshot exists yet, shows an empty-state — never a stale or invented
 * figure. Strictly DESIGN.md tokens (muted-foreground at the 11px label scale, AppVersion's idiom).
 *
 * PMO-domain only (no ERP vocabulary crosses the component boundary) — the provenance strings are
 * passed in by the read repository/DAL consumers.
 */
export interface AccountingSnapshotProvenanceProps {
  /** The snapshot's `as_of` ISO timestamp; null/absent ⇒ empty-state. */
  asOf?: string | null;
  /** Which report/ledger produced the snapshot (e.g. 'Accounts Payable', 'GL Entry', or the
   *  '... (mirrored-ledger fallback)' marker from refreshAging's fallback path). */
  sourceReport?: string | null;
  /** The ERPNext/Frappe version the report ran against (absent for actuals — GL Entry has none). */
  reportVersion?: string | null;
  className?: string;
}

/** Formats an ISO timestamp as a readable local date (e.g. "Jul 12, 2026"). Falls back to the raw
 *  string when parsing fails so a non-ISO value is never silently dropped. */
function formatAsOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const AccountingSnapshotProvenance: React.FC<AccountingSnapshotProvenanceProps> = ({ asOf, sourceReport, reportVersion, className }) => {
  if (!asOf) {
    return (
      <div data-testid="snapshot-provenance-empty" className={cn('text-[11px] text-muted-foreground', className)}>
        No snapshot available yet
      </div>
    );
  }

  return (
    <div
      data-testid="snapshot-provenance"
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground', className)}
    >
      <span>
        As of <span className="font-medium">{formatAsOf(asOf)}</span>
      </span>
      {sourceReport ? (
        <>
          <span aria-hidden>·</span>
          <span>{sourceReport}</span>
        </>
      ) : null}
      {reportVersion ? (
        <>
          <span aria-hidden>·</span>
          <span className="font-medium">{reportVersion}</span>
        </>
      ) : null}
    </div>
  );
};

export default AccountingSnapshotProvenance;
