/**
 * LedgerFileCell — renders the File column cell for a single ledger row.
 *
 * Fetches the first non-archived file for the record via `listProcurementFiles`
 * on mount, then generates a signed URL on click (lazy, avoids generating signed
 * URLs for every row upfront). Falls back to "—" when no file is attached.
 *
 * Compact by design: this is a dense table cell. Reuses the existing file DAL
 * helpers; no new storage logic. No upload affordance here — upload lives in
 * ProcurementFilesSubsection (unchanged).
 *
 * RecordType → ProcPhase mapping mirrors the procurementFiles.ts ProcPhase enum.
 */
import React, { useEffect, useState } from 'react';
import { Icon } from '@/src/components/ui';
import { listProcurementFiles, getSignedDownloadUrl } from '@/src/lib/db/procurementFiles';
import type { ProcPhase } from '@/src/lib/db/procurementFiles';
import type { RecordType } from '@/src/lib/db/procurementLedger';

// ---------------------------------------------------------------------------
// RecordType → ProcPhase mapping
// ---------------------------------------------------------------------------

const PHASE_BY_TYPE: Record<RecordType, ProcPhase> = {
  PR: 'purchase_request',
  RFQ: 'rfq',
  Quote: 'quotation',
  PO: 'purchase_order',
  GR: 'receipt',
  Invoice: 'invoice',
  Payment: 'payment',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LedgerFileCellProps {
  type: RecordType;
  recordId: string;
  systemNumber: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const LedgerFileCell: React.FC<LedgerFileCellProps> = ({ type, recordId, systemNumber }) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch first file + its signed URL for this record on mount.
  useEffect(() => {
    let cancelled = false;
    const phase = PHASE_BY_TYPE[type];
    listProcurementFiles(phase, recordId)
      .then(async (files) => {
        if (cancelled) return;
        const first = files[0];
        if (first?.file_path) {
          try {
            const url = await getSignedDownloadUrl(first.file_path);
            if (!cancelled) setSignedUrl(url);
          } catch {
            // Best-effort: signed-URL failure silently omits the link
          }
        }
      })
      .catch(() => {
        // Best-effort: list failure silently omits the link
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [type, recordId]);

  if (loading) return null;

  if (!signedUrl) {
    return <span className="text-[12px] text-muted-foreground">—</span>;
  }

  return (
    <a
      href={signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open file for ${systemNumber ?? type}`}
      className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
    >
      <Icon name="file" className="size-3.5" />
      View
    </a>
  );
};

LedgerFileCell.displayName = 'LedgerFileCell';
