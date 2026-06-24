/**
 * ProcurementCycleImportWizard (ADR-0035 M4).
 *
 * A SIBLING of ImportWizard — same portal/scrim/focus-trap/ESC/token shell,
 * same a11y contract (role="dialog" aria-modal, role="alert" on errors,
 * role="status" aria-live on committing). The KEY difference from ImportWizard:
 * the preview step renders a GROUPED TREE (case → its records) instead of a flat
 * per-row table, reflecting the procurement-cycle case/record model (ADR-0035).
 *
 * Tokens: strictly DESIGN.md — bg-popover, border-border, text-muted-foreground,
 * text-destructive, text-foreground. Controls 32px (h-8). Shadow + confirm-anim
 * copied verbatim from ImportWizard.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, StatusPill } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import type { RefLookup } from '@/src/lib/import';
import type { ValidatedGroup, ValidatedRow } from '@/src/lib/import/procurementCycle/types';
import {
  useProcurementCycleImport,
  CYCLE_FIELDS,
  MAX_IMPORT_ROWS,
  type CycleWizardStep,
  type CycleMapping,
} from './useProcurementCycleImport';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ProcurementCycleImportWizardProps {
  requestedById: string;
  projectLookup: RefLookup;
  vendorLookup: RefLookup;
  /** Close the wizard. `didImport` is true when at least one record was created. */
  onClose: (didImport: boolean) => void;
}

// ── Step titles / subtitles ───────────────────────────────────────────────────

const STEP_TITLE: Record<CycleWizardStep, string> = {
  upload: 'Import procurement cycle',
  mapping: 'Match columns',
  preview: 'Review before importing',
  committing: 'Importing…',
  result: 'Import complete',
};

const STEP_SUBTITLE: Record<CycleWizardStep, string> = {
  upload: `Upload an .xlsx file (up to ${MAX_IMPORT_ROWS} rows). One row per record — use a type column to mix PR, RFQ, Quotation, PO, GR, VI, and Payment.`,
  mapping: 'Confirm which column maps to each field.',
  preview: 'Cases and their records. Invalid records are skipped — only valid records are imported.',
  committing: 'Creating procurement cases and records…',
  result: 'Here is what happened.',
};

// ── Root wizard ───────────────────────────────────────────────────────────────

export function ProcurementCycleImportWizard({
  requestedById,
  projectLookup,
  vendorLookup,
  onClose,
}: ProcurementCycleImportWizardProps) {
  const wiz = useProcurementCycleImport(projectLookup, vendorLookup, requestedById);
  const titleId = useId();
  const subId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const requestClose = useCallback(() => {
    if (wiz.step === 'committing') return;
    const didImport = (wiz.result?.created ?? 0) > 0;
    onClose(didImport);
  }, [wiz.step, wiz.result, onClose]);

  // ESC to close (blocked while committing).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  // Focus-in on open; restore trigger on unmount.
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const firstField = root?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), button:not([disabled])',
    );
    (firstField ?? root)?.focus();
    return () => {
      triggerRef.current?.focus();
      triggerRef.current = null;
    };
  }, []);

  // Focus trap.
  const onTrapKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const f = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // How many valid records across all valid groups (for the Import button label).
  const validRecordCount = wiz.counts.validRecords;

  return createPortal(
    <div className="fixed inset-0 z-[800] flex items-center justify-center p-4">
      <div
        data-testid="cycle-import-scrim"
        aria-hidden
        onClick={requestClose}
        className="confirm-scrim-anim absolute inset-0 bg-foreground/40"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subId}
        tabIndex={-1}
        onKeyDown={onTrapKeyDown}
        className={cn(
          'confirm-anim relative z-[810] flex max-h-[85dvh] w-[calc(100%-32px)] max-w-[680px] flex-col rounded-lg border border-border bg-popover',
          'shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)]',
          'origin-center motion-reduce:animate-none',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-4">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-[16px] font-bold tracking-[-0.01em] text-popover-foreground"
            >
              {STEP_TITLE[wiz.step]}
            </h2>
            <p id={subId} className="mt-px text-[12.5px] text-muted-foreground">
              {STEP_SUBTITLE[wiz.step]}
            </p>
          </div>
          <Button
            variant="ghost"
            iconOnly
            aria-label="Close"
            onClick={requestClose}
            disabled={wiz.step === 'committing'}
          >
            <Icon name="x" />
          </Button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
          {wiz.step === 'upload' && <CycleUploadStep wiz={wiz} />}
          {wiz.step === 'mapping' && <CycleMappingStep wiz={wiz} />}
          {wiz.step === 'preview' && <CyclePreviewStep wiz={wiz} />}
          {wiz.step === 'committing' && <CycleCommittingStep />}
          {wiz.step === 'result' && <CycleResultStep wiz={wiz} />}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3.5">
          {(wiz.step === 'mapping' || wiz.step === 'preview') && (
            <Button variant="ghost" size="sm" onClick={wiz.back}>
              Back
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {wiz.step === 'upload' && (
              <Button variant="ghost" size="sm" onClick={requestClose}>
                Cancel
              </Button>
            )}
            {wiz.step === 'mapping' && (
              <Button
                variant="primary"
                size="sm"
                onClick={wiz.goPreview}
                disabled={!wiz.allRequiredMapped}
              >
                Next
              </Button>
            )}
            {wiz.step === 'preview' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void wiz.commit()}
                disabled={validRecordCount === 0}
              >
                Import {validRecordCount} record{validRecordCount !== 1 ? 's' : ''}
              </Button>
            )}
            {wiz.step === 'result' && (
              <Button variant="primary" size="sm" onClick={requestClose}>
                Done
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Step sub-components ───────────────────────────────────────────────────────

type Wiz = ReturnType<typeof useProcurementCycleImport>;

function CycleUploadStep({ wiz }: { wiz: Wiz }) {
  const inputId = useId();
  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center"
      >
        <Icon name="upload" className="size-6 text-muted-foreground" />
        <span className="text-[13.5px] font-semibold text-foreground">Choose an .xlsx file</span>
        <span className="text-[12px] text-muted-foreground">
          The first row must be column headers. Up to {MAX_IMPORT_ROWS} rows.
        </span>
        <input
          id={inputId}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="Choose an .xlsx file"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void wiz.selectFile(f);
            e.target.value = '';
          }}
        />
      </label>
      {wiz.parseError && (
        <p role="alert" className="flex items-start gap-1.5 text-[12.5px] text-destructive">
          <Icon name="alert" className="mt-px size-4 shrink-0" />
          {wiz.parseError}
        </p>
      )}
    </div>
  );
}

function CycleMappingStep({ wiz }: { wiz: Wiz }) {
  const headers = wiz.parsed?.headers ?? [];
  return (
    <div className="flex flex-col gap-3">
      {CYCLE_FIELDS.map((field) => (
        <CycleMappingRow
          key={field.key}
          label={field.label}
          required={field.required}
          headers={headers}
          value={wiz.mapping[field.key as keyof CycleMapping] ?? null}
          onChange={(idx) =>
            wiz.setFieldMapping(
              field.key as keyof import('@/src/lib/import/procurementCycle/types').CycleRow,
              idx,
            )
          }
        />
      ))}
      {!wiz.allRequiredMapped && (
        <p role="alert" className="text-[12.5px] text-destructive">
          Map the required fields (case_ref, type) to continue.
        </p>
      )}
    </div>
  );
}

function CycleMappingRow({
  label,
  required,
  headers,
  value,
  onChange,
}: {
  label: string;
  required: boolean;
  headers: string[];
  value: number | null;
  onChange: (idx: number | null) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[1fr_1fr] items-center gap-3">
      <label htmlFor={id} className="text-[13px] font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="h-8 w-full rounded-md border border-border bg-card px-2 text-[13px] text-foreground"
      >
        <option value="">— Not mapped —</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Preview: grouped case/record tree ─────────────────────────────────────────

function CyclePreviewStep({ wiz }: { wiz: Wiz }) {
  const { validatedGroups, counts } = wiz;

  return (
    <div className="flex flex-col gap-3">
      {/* Summary line */}
      <p className="text-[13px] text-foreground" data-testid="cycle-import-summary">
        <b className="font-semibold">{counts.totalCases} cases</b>,{' '}
        <b className="font-semibold">{counts.validRecords} records valid</b>,{' '}
        {counts.skippedRecords} skipped
      </p>

      {/* Case/record tree */}
      <div className="flex flex-col gap-2">
        {validatedGroups.map((vg) => (
          <CaseCard key={vg.group.caseRef} vg={vg} />
        ))}
      </div>

      {counts.totalCases === 0 && (
        <p className="text-[13px] text-muted-foreground">No cases found in the sheet.</p>
      )}
    </div>
  );
}

/** A single case with its records (expandable). */
function CaseCard({ vg }: { vg: ValidatedGroup }) {
  const [expanded, setExpanded] = useState(true);
  const { group, groupErrors, rows, valid } = vg;

  const validRowCount = rows.filter((r) => r.valid).length;
  const caseRef = group.caseRef;
  const caseTitle = group.attrs.title ?? group.attrs.project ?? caseRef;

  return (
    <div className="rounded-md border border-border bg-card">
      {/* Case header row */}
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        <Icon
          name="chev"
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', {
            '-rotate-90': !expanded,
          })}
        />
        <span className="min-w-0 flex-1">
          <span className="font-mono text-[12px] font-semibold text-foreground">{caseRef}</span>
          {caseTitle !== caseRef && (
            <span className="ml-2 truncate text-[12px] text-muted-foreground">{caseTitle}</span>
          )}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {validRowCount}/{rows.length} records
        </span>
        {valid ? (
          <StatusPill variant="won">Valid</StatusPill>
        ) : (
          <StatusPill variant="lost">Skipped</StatusPill>
        )}
      </button>

      {/* Group-level errors */}
      {groupErrors.length > 0 && (
        <div className="border-t border-border px-3 pb-2 pt-1.5">
          {groupErrors.map((e, i) => (
            <p key={i} className="flex items-start gap-1 text-[11.5px] text-destructive">
              <Icon name="alert" className="mt-px size-3.5 shrink-0" />
              {e}
            </p>
          ))}
        </div>
      )}

      {/* Record rows (collapsible) */}
      {expanded && rows.length > 0 && (
        <div className="border-t border-border">
          {rows.map((row) => (
            <RecordRow key={row.rowNumber} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single record row within a case card. */
function RecordRow({ row }: { row: ValidatedRow & { type?: string; externalRef?: string } }) {
  // The ValidatedRow carries rowNumber + valid + errors; the raw CycleRow type/externalRef
  // live on the parent group — we reconstruct them from the group's rows in the preview.
  // Here we receive the enriched ValidatedRow (we'll join from parent; see CaseCard usage below).
  return (
    <div
      className={cn('flex items-start gap-2 border-b border-border px-3 py-2 last:border-0', {
        'opacity-60': !row.valid,
      })}
    >
      <span className="w-5 shrink-0 text-[11px] text-muted-foreground">{row.rowNumber}</span>
      <div className="min-w-0 flex-1">
        {row.errors.length > 0 && (
          <ul className="mt-0.5 space-y-0.5">
            {row.errors.map((e, i) => (
              <li key={i} className="text-[11px] text-destructive">
                {e}
              </li>
            ))}
          </ul>
        )}
      </div>
      {row.valid ? (
        <StatusPill variant="won">Valid</StatusPill>
      ) : (
        <StatusPill variant="lost">Skipped</StatusPill>
      )}
    </div>
  );
}

// ── Committing step ───────────────────────────────────────────────────────────

function CycleCommittingStep() {
  return (
    <div
      className="flex flex-col items-center gap-2 py-6 text-center"
      role="status"
      aria-live="polite"
    >
      <Icon name="refresh" className="size-5 animate-spin text-muted-foreground" />
      <p className="text-[13px] text-foreground">Creating procurement cases and records…</p>
    </div>
  );
}

// ── Result step ───────────────────────────────────────────────────────────────

function CycleResultStep({ wiz }: { wiz: Wiz }) {
  const r = wiz.result;
  if (!r) return null;

  // Collect all failed records across all cases
  const failedRecords: Array<{
    caseRef: string;
    rowNumber: number;
    type: string;
    error: string;
  }> = [];
  for (const c of r.cases) {
    for (const rec of c.records) {
      if (rec.status === 'failed' && rec.error) {
        failedRecords.push({
          caseRef: c.caseRef,
          rowNumber: rec.rowNumber,
          type: rec.type,
          error: rec.error,
        });
      }
    }
    // Also surface header-failed cases
    if (c.headerStatus === 'failed' && c.headerError) {
      failedRecords.push({
        caseRef: c.caseRef,
        rowNumber: 0,
        type: 'Case header',
        error: c.headerError,
      });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-foreground" data-testid="cycle-result-summary">
        <b className="font-semibold">{r.created} created</b>
        {r.failed > 0 && <>, {r.failed} failed</>}.
      </p>

      {failedRecords.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 text-[12.5px]">
          {failedRecords.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <Icon name="alert" className="mt-px size-3.5 shrink-0 text-destructive" />
              <span className="text-foreground">
                <span className="font-mono text-[11px]">{f.caseRef}</span>
                {f.rowNumber > 0 ? ` row ${f.rowNumber} (${f.type})` : ` (${f.type})`}:{' '}
                <span className="text-muted-foreground">{f.error}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
