import React, { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, StatusPill, type StatusVariant } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import type { ImportDescriptor, ImportField } from '@/src/lib/import';
import { MAX_IMPORT_ROWS } from '@/src/lib/import';
import { useImportWizard, type WizardStep } from './useImportWizard';

/**
 * ImportWizard (ADR-0027) — a dedicated multi-step dialog: upload → mapping → preview
 * (dry-run, ZERO writes) → committing → result. Built as its own portal + focus-trap shell
 * (NOT EntityFormModal): the wizard needs a per-step footer + a wide body, which fights
 * EntityFormModal's single-`<form>`-submit contract. It reuses the SAME token shell
 * (rounded-lg border bg-popover, the Overlay shadow, the desaturated scrim) + the same
 * focus-trap/ESC posture, so the app's dialog conventions hold (documented in the test).
 *
 * The dry-run preview performs ZERO network writes; the single explicit "Import N companies"
 * button on the preview step is the only write trigger. On a successful commit the parent's
 * `onClose(didImport=true)` refetches the list.
 */

const STEP_TITLE: Record<WizardStep, string> = {
  upload: 'Import companies',
  mapping: 'Match columns',
  preview: 'Review before importing',
  committing: 'Importing…',
  result: 'Import complete',
};

const STEP_SUBTITLE: Record<WizardStep, string> = {
  upload: `Upload an .xlsx file (up to ${MAX_IMPORT_ROWS} rows).`,
  mapping: 'Confirm which column maps to each field.',
  preview: 'Invalid rows are skipped. Only valid rows are imported.',
  committing: 'Creating one record per valid row.',
  result: 'Here is what happened.',
};

export interface ImportWizardProps<Input> {
  descriptor: ImportDescriptor<Input>;
  /** Close the wizard. `didImport` is true when at least one row was created (drives refetch). */
  onClose: (didImport: boolean) => void;
}

export function ImportWizard<Input>({ descriptor, onClose }: ImportWizardProps<Input>) {
  const wiz = useImportWizard(descriptor);
  const titleId = useId();
  const subId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // A close from result after a successful import refetches the parent list.
  const requestClose = useCallback(() => {
    if (wiz.step === 'committing') return; // never abandon mid-write
    onClose((wiz.result?.created ?? 0) > 0);
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

  // Focus in on open, restore to the trigger on unmount (mirrors EntityFormModal).
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

  return createPortal(
    <div className="fixed inset-0 z-[800] flex items-center justify-center p-4">
      <div
        data-testid="import-scrim"
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
          'confirm-anim relative z-[810] flex max-h-[85dvh] w-[calc(100%-32px)] max-w-[640px] flex-col rounded-lg border border-border bg-popover',
          'shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)]',
          'origin-center motion-reduce:animate-none',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[16px] font-bold tracking-[-0.01em] text-popover-foreground">
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
          {wiz.step === 'upload' && <UploadStep wiz={wiz} />}
          {wiz.step === 'mapping' && <MappingStep wiz={wiz} descriptor={descriptor} />}
          {wiz.step === 'preview' && <PreviewStep wiz={wiz} descriptor={descriptor} />}
          {wiz.step === 'committing' && <CommittingStep wiz={wiz} />}
          {wiz.step === 'result' && <ResultStep wiz={wiz} descriptor={descriptor} />}
        </div>

        {/* Footer — per-step actions. */}
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
                disabled={wiz.counts.valid === 0}
              >
                Import {wiz.counts.valid} {descriptor.entity.toLowerCase()}
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

// ── Steps ────────────────────────────────────────────────────────────────────

type Wiz<Input> = ReturnType<typeof useImportWizard<Input>>;

function UploadStep<Input>({ wiz }: { wiz: Wiz<Input> }) {
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
            // Reset so re-choosing the same file fires change again.
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

function MappingStep<Input>({ wiz, descriptor }: { wiz: Wiz<Input>; descriptor: ImportDescriptor<Input> }) {
  const headers = wiz.parsed?.headers ?? [];
  return (
    <div className="flex flex-col gap-3">
      {descriptor.fields.map((field) => (
        <MappingRow
          key={field.key}
          field={field}
          headers={headers}
          value={wiz.mapping[field.key] ?? null}
          onChange={(idx) => wiz.setFieldMapping(field.key, idx)}
        />
      ))}
      {!wiz.allRequiredMapped && (
        <p role="alert" className="text-[12.5px] text-destructive">
          Map every required field to continue.
        </p>
      )}
    </div>
  );
}

function MappingRow<Input>({
  field,
  headers,
  value,
  onChange,
}: {
  field: ImportField<Input>;
  headers: string[];
  value: number | null;
  onChange: (idx: number | null) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[1fr_1fr] items-center gap-3">
      <label htmlFor={id} className="text-[13px] font-medium text-foreground">
        {field.label}
        {field.required && <span className="ml-0.5 text-destructive">*</span>}
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

const CHIP_VARIANT: StatusVariant = 'open';

function PreviewStep<Input>({ wiz, descriptor }: { wiz: Wiz<Input>; descriptor: ImportDescriptor<Input> }) {
  const rows = wiz.parsed?.rows ?? [];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-foreground" data-testid="import-summary">
        <b className="font-semibold">{wiz.counts.valid} valid</b>, {wiz.counts.invalid} invalid, {wiz.counts.total} total
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-card text-left text-muted-foreground">
              <th className="px-2.5 py-1.5 font-semibold">Row</th>
              {descriptor.fields.map((f) => (
                <th key={f.key} className="px-2.5 py-1.5 font-semibold">
                  {f.label}
                </th>
              ))}
              <th className="px-2.5 py-1.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {wiz.validation.map((v) => (
              <tr key={v.index} className="border-b border-border last:border-0">
                <td className="px-2.5 py-1.5 text-muted-foreground">{v.index + 1}</td>
                {descriptor.fields.map((f) => {
                  const col = wiz.mapping[f.key];
                  const raw = col == null ? '' : (rows[v.index]?.[col] ?? '');
                  return (
                    <td key={f.key} className="px-2.5 py-1.5">
                      <span className="text-foreground">{raw || <span className="text-muted-foreground">—</span>}</span>
                      {v.errors[f.key] && (
                        <span className="mt-0.5 block text-[11px] text-destructive">{v.errors[f.key]}</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2.5 py-1.5">
                  {v.valid ? (
                    <StatusPill variant={CHIP_VARIANT}>Valid</StatusPill>
                  ) : (
                    <StatusPill variant="lost">Skipped</StatusPill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CommittingStep<Input>({ wiz }: { wiz: Wiz<Input> }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center" role="status" aria-live="polite">
      <Icon name="refresh" className="size-5 animate-spin text-muted-foreground" />
      <p className="text-[13px] text-foreground">
        Importing {wiz.progress.done} / {wiz.progress.total}…
      </p>
    </div>
  );
}

function ResultStep<Input>({ wiz, descriptor }: { wiz: Wiz<Input>; descriptor: ImportDescriptor<Input> }) {
  const r = wiz.result;
  if (!r) return null;
  const rows = wiz.parsed?.rows ?? [];
  const nameKey = descriptor.fields[0]?.key;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-foreground" data-testid="import-result-summary">
        <b className="font-semibold">{r.created} created</b>
        {r.failed.length > 0 && <>, {r.failed.length} failed</>}.
      </p>
      {r.failed.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 text-[12.5px]">
          {r.failed.map((f) => {
            const col = nameKey ? wiz.mapping[nameKey] : null;
            const label = col == null ? '' : (rows[f.index]?.[col] ?? '');
            return (
              <li key={f.index} className="flex items-start gap-1.5">
                <Icon name="alert" className="mt-px size-3.5 shrink-0 text-destructive" />
                <span className="text-foreground">
                  Row {f.index + 1}
                  {label ? ` (${label})` : ''}: <span className="text-muted-foreground">{f.reason}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
