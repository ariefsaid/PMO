/**
 * RecordCard — Reusable dual-ID display card for a procurement ERP record.
 *
 * Renders the system-minted number (e.g. PO-2606190001) AND the external
 * reference (e.g. ACME-PO-77) as text with semantic "System #" / "Ref #" labels
 * (NFR-PR-A11Y-003: not color-only). Amount via formatCurrency; reference number
 * rendered via React escaping — no dangerouslySetInnerHTML (NFR-PR-SEC-003).
 * DESIGN.md tokens only; no raw hex/px.
 */
import React from 'react';
import { StatusPill } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';

export interface RecordCardProps {
  /** Minted system number (e.g. "PO-2606190001"). Always present. */
  systemNumber: string;
  /** Human-set external reference (e.g. "ACME-PO-77"). Optional. */
  referenceNumber?: string | null;
  /** Business date (ISO 8601 date string, e.g. "2026-06-10"). */
  date?: string | null;
  /** Numeric amount. */
  amount?: number | null;
  /** Status text (e.g. "Issued", "Draft"). */
  status?: string | null;
  /** Record type label shown in the card header (e.g. "Purchase Order"). */
  label?: string;
  /** Optional className for the outer element. */
  className?: string;
}

/**
 * Format a date string (YYYY-MM-DD) as a locale date string.
 * Uses split to stay UTC-safe (avoids the 1-day shift from `new Date('2026-06-10')`
 * in behind-UTC timezones — same pattern as the rest of the codebase).
 */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export const RecordCard: React.FC<RecordCardProps> = ({
  systemNumber,
  referenceNumber,
  date,
  amount,
  status,
  label,
  className,
}) => (
  <div
    className={[
      'rounded-md border border-border bg-card p-3 text-[13px]',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {/* Card label (record type heading, e.g. "Purchase Order") */}
    {label && (
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </p>
    )}

    {/* Dual-ID block — both labels present as text (NFR-PR-A11Y-003) */}
    <div className="flex flex-col gap-1">
      {/* System number */}
      <div className="flex items-baseline gap-2 overflow-hidden">
        <span className="w-14 shrink-0 text-[11px] font-semibold text-muted-foreground">
          System #
        </span>
        <span className="truncate font-mono font-semibold text-foreground">{systemNumber}</span>
      </div>

      {/* External reference — only when provided */}
      {referenceNumber != null && referenceNumber !== '' && (
        <div className="flex items-baseline gap-2 overflow-hidden">
          <span className="w-14 shrink-0 text-[11px] font-semibold text-muted-foreground">
            Ref #
          </span>
          {/* React renders this as a text node — safe, no dangerouslySetInnerHTML */}
          <span className="truncate font-mono text-muted-foreground">{referenceNumber}</span>
        </div>
      )}
    </div>

    {/* Metadata strip: date · amount · status */}
    {(date || amount != null || status) && (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2">
        {date && (
          <span className="text-[12px] text-muted-foreground">{formatDate(date)}</span>
        )}
        {amount != null && (
          <span className="font-mono text-[12px] tabular-nums text-foreground">
            {formatCurrency(amount)}
          </span>
        )}
        {status && (
          <StatusPill variant="neutral">{status}</StatusPill>
        )}
      </div>
    )}
  </div>
);

RecordCard.displayName = 'RecordCard';
