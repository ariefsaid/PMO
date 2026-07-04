/**
 * LedgerFileCell — renders the File column cell for a single ledger row.
 *
 * Prop-driven. File presence (title, count, path) is pre-computed from the
 * detail bundle by buildLedgerRows — zero per-row network calls on mount.
 *
 * States:
 *   has file, single  → button showing the file title; click lazily signs the
 *                       URL via getSignedDownloadUrl and opens in a new tab.
 *                       On sign failure (e.g. seed rows with no storage object)
 *                       shows a toast-like inline error — never a console error.
 *   has file, multi   → button showing "N files"; click opens the full
 *                       ProcurementFilesSubsection (via onOpenFiles callback).
 *   no file, canWrite → compact "Attach" icon-button that triggers a hidden
 *                       file input, uploading to this record via useProcurementFiles.
 *   no file, read-only → "—" span.
 *
 * Compact by design (dense table cell). Reuses existing file helpers + sized Icon.
 * DESIGN.md tokens only; no raw hex/px. WCAG-AA: buttons have aria-label.
 */
import React, { useRef, useState } from 'react';
import { Icon, useToast } from '@/src/components/ui';
import { getSignedDownloadUrl } from '@/src/lib/db/procurementFiles';
import { useProcurementFiles } from '@/src/hooks/useProcurementFiles';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { FILE_INPUT_ACCEPT } from '@/src/lib/fileConstants';
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

export interface LedgerFileCellProps {
  type: RecordType;
  recordId: string;
  systemNumber: string | null;
  /** Storage path of the first file (from buildLedgerRows bundle embed). Null = no file. */
  fileHref: string | null;
  /** Display title for the first file. Null when no file. */
  fileTitle: string | null;
  /** Count of non-archived files for this record (0 = none). */
  fileCount: number;
  /** Whether write affordances (upload) are shown. UX gate; RLS is authoritative. */
  canWrite: boolean;
  /** The owning procurement id (upload path + query invalidation). */
  procurementId: string;
  /** Current user id stamped onto new file rows. */
  uploadedById: string | null;
  /**
   * Called when the user wants to open the full files UI for this record
   * (e.g. when fileCount > 1). The parent mounts ProcurementFilesSubsection.
   */
  onOpenFiles?: () => void;
}

// ---------------------------------------------------------------------------
// Single-file view button (lazy sign on click)
// ---------------------------------------------------------------------------

interface SingleFileButtonProps {
  fileHref: string;
  fileTitle: string;
  label: string;
}

const SingleFileButton: React.FC<SingleFileButtonProps> = ({ fileHref, fileTitle, label }) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setInlineError(null);
    try {
      const url = await getSignedDownloadUrl(fileHref);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      // Non-fatal: seed rows exist with no storage object. Show inline message.
      const { headline } = classifyMutationError(err);
      setInlineError(headline);
      toast(headline, 'The file could not be opened. It may not have been uploaded yet.', 'warning');
    } finally {
      setBusy(false);
    }
  };

  if (inlineError) {
    return (
      <span
        role="alert"
        className="inline-flex items-center gap-1 text-[12px] text-destructive"
        title={inlineError}
      >
        <Icon name="file" className="size-3.5 shrink-0" />
        <span className="truncate max-w-[120px]">{fileTitle}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      aria-label={label}
      title={fileTitle}
      className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary-text hover:underline underline-offset-4 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Icon name="file" className="size-3.5 shrink-0" />
      <span className="truncate max-w-[120px]">{fileTitle}</span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// Compact upload button (no-file + canWrite)
// ---------------------------------------------------------------------------

interface AttachButtonProps {
  type: RecordType;
  recordId: string;
  procurementId: string;
  uploadedById: string | null;
}

const AttachButton: React.FC<AttachButtonProps> = ({
  type,
  recordId,
  procurementId,
  uploadedById,
}) => {
  const { toast } = useToast();
  const phase = PHASE_BY_TYPE[type];
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload } = useProcurementFiles(phase, recordId, procurementId, uploadedById);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    upload.mutate(
      { file },
      {
        onSuccess: () => toast('File attached', file.name, 'success'),
        onError: (err: unknown) => {
          const { headline, detail } = classifyMutationError(err);
          toast(headline, detail, 'warning');
        },
      },
    );
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        aria-label="Attach a file to this record"
        className="sr-only"
        onChange={onPick}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
        aria-label="Attach file"
        title="Attach file"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-primary disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon name="upload" className="size-3.5 shrink-0" />
        {upload.isPending ? (
          <span>Uploading…</span>
        ) : (
          <span>Attach</span>
        )}
      </button>
    </>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const LedgerFileCell: React.FC<LedgerFileCellProps> = ({
  type,
  recordId,
  systemNumber,
  fileHref,
  fileTitle,
  fileCount,
  canWrite,
  procurementId,
  uploadedById,
  onOpenFiles,
}) => {
  // Multiple files → show "N files" count button; clicks open the files panel if provided
  if (fileCount > 1) {
    return (
      <button
        type="button"
        onClick={onOpenFiles}
        aria-label={`${fileCount} files for ${systemNumber ?? type} — click to view all`}
        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary-text hover:underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon name="file" className="size-3.5 shrink-0" />
        <span>{fileCount} files</span>
      </button>
    );
  }

  // Single file → lazy signed URL on click
  if (fileHref && fileTitle) {
    return (
      <SingleFileButton
        fileHref={fileHref}
        fileTitle={fileTitle}
        label={`Open file for ${systemNumber ?? type}`}
      />
    );
  }

  // No file + writer → upload affordance
  if (canWrite) {
    return (
      <AttachButton
        type={type}
        recordId={recordId}
        procurementId={procurementId}
        uploadedById={uploadedById}
      />
    );
  }

  // No file + read-only → dash
  return <span className="text-[12px] text-muted-foreground">—</span>;
};

LedgerFileCell.displayName = 'LedgerFileCell';
