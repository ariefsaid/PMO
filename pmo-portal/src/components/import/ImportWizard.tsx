import { withEnglishOrgTerms } from '@/src/lib/i18n/orgTerms';
import React, { useCallback, useEffect, useId, useRef } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button, DataTable, Icon, StatusPill, UnsavedChangesDialog, type Column, type StatusVariant } from '@/src/components/ui';
import { FileInput, SelectField, TextArea } from '@/src/components/ui/FormFields';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/components/ui/cn';
import { overlayBackdropClassName, overlayBackdropStyle } from '@/src/components/ui/OverlaySurface';
import { acquireBackgroundInert } from '@/src/components/ui/backgroundInert';
import type { ImportDescriptor, ImportField } from '@/src/lib/import';
import { MAX_IMPORT_ROWS, rowToCells } from '@/src/lib/import';
import { exportFilename } from '@/src/lib/export';
import { buildFailedRowsWorkbook } from '@/src/lib/import/failedRowsFile';
import { buildTemplateWorkbook } from '@/src/lib/import/templateFile';
import { triggerBlobDownload } from '@/src/lib/download';
import { useImportWizard, type WizardStep } from './useImportWizard';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import type { TFunction } from 'i18next';

type PendingImportExit = { kind: 'close' | 'leave'; run: () => void };

/**
 * ImportWizard (ADR-0027) — a dedicated multi-step dialog: upload → mapping → preview
 * (dry-run, ZERO writes) → committing → result. Built on Base UI Dialog (library owns portal, focus trap, Esc, scrim)
 * (NOT EntityFormModal): the wizard needs a per-step footer + a wide body, which fights
 * EntityFormModal's single-`<form>`-submit contract. Same token shell
 * (rounded-lg border bg-popover, the Overlay shadow, the desaturated scrim) + the same
 * focus-trap/ESC posture, so the app's dialog conventions hold (documented in the test).
 *
 * The dry-run preview performs ZERO network writes; the single explicit "Import N companies"
 * button on the preview step is the only write trigger. On a successful commit the parent's
 * `onClose(didImport=true)` refetches the list.
 */

// ⚑ The upload step's title is a FUNCTION of the descriptor, not a constant. It read
// 'Import companies' for every importer — wrong since the first fast-follow shipped, and invisible
// while each page had exactly one. #495 puts two on the Projects toolbar, where clicking
// "Import budgets" and being met with "Import companies" is unmissable.
// #1278 round A item 4: every string below reads its catalogue key (`import` namespace, fetched when
// the wizard mounts), so Bahasa Indonesia reads Bahasa. The defaults are the English catalogue text.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The failed-rows file (#2530): built in the browser from the file the person uploaded and the result on screen. */
async function downloadFailedRows(
  parsed: { headers: string[]; rows: string[][] },
  failed: { index: number; reason: string }[],
  skipped: number[],
  entity: string,
  t: TFunction,
): Promise<void> {
  const buf = await buildFailedRowsWorkbook({
    headers: parsed.headers, rows: parsed.rows, failed, skipped,
    labels: {
      sheet: t('import:result.failedSheet', 'Not imported'),
      alreadyThere: t('import:result.alreadyThereSheet', 'Already there'),
      rowInFile: t('import:result.rowInFile', 'Row in your file'),
      reason: t('import:result.reasonColumn', 'Why not imported'),
    },
  });
  triggerBlobDownload(new Blob([buf], { type: XLSX_MIME }), exportFilename(`${entity}-not-imported`));
}

const stepTitle = (step: Exclude<WizardStep, 'upload'>, t: TFunction, someNotImported: boolean): string => {
  // LITERAL keys per step — the i18n completeness gate scans for them.
  if (step === 'mapping') return t('import:wizard.step.mapping', 'Match columns');
  if (step === 'preview') return t('import:wizard.step.preview', 'Review before importing');
  if (step === 'committing') return t('import:wizard.step.committing', 'Importing…');
  if (someNotImported) return t('import:wizard.step.resultPartial', 'Some lines were not imported');
  return t('import:wizard.step.result', 'Import complete');
};

const stepSubtitle = (step: WizardStep, t: TFunction, maxRows: number): string => {
  if (step === 'upload') return t('import:wizard.subtitle.upload', 'Upload an .xlsx file (up to {{max}} rows).', { max: maxRows });
  if (step === 'mapping') return t('import:wizard.subtitle.mapping', 'Confirm which column maps to each field.');
  if (step === 'preview') return t('import:wizard.subtitle.preview', 'Invalid rows are skipped. Only valid rows are imported.');
  if (step === 'committing') return t('import:wizard.subtitle.committing', 'Creating one record per valid row.');
  return t('import:wizard.subtitle.result', 'Here is what happened.');
};

/** The entity word a title/button reads: the descriptor's localized display name, else the stable identifier. */
const entityWord = <Input,>(descriptor: ImportDescriptor<Input>, locale: string, singular = false): string => {
  const word = (singular ? descriptor.entityDisplayOne : undefined) ?? descriptor.entityDisplay ?? descriptor.entity.toLowerCase();
  return descriptor.entityIsAppCopy ? withEnglishOrgTerms(word, locale) : word;
};
const fieldLabel = <Input,>(field: ImportField<Input>, locale: string): string =>
  field.labelIsAppCopy ? withEnglishOrgTerms(field.label, locale) : field.label;

export interface ImportWizardProps<Input> {
  descriptor: ImportDescriptor<Input>;
  /** Close the wizard. `didImport` is true when at least one row was created (drives refetch). */
  onClose: (didImport: boolean) => void;
}

export function ImportWizard<Input>({ descriptor, onClose }: ImportWizardProps<Input>) {
  // The wizard's own chrome (titles, subtitles, buttons) reads the `import` catalogue; declaring the
  // namespace here fetches it on mount (CATALOGUES.md route 1) instead of relying on the
  // missing-key handler's on-demand fetch + re-render.
  const { t, i18n } = useTranslation('import');
  const wiz = useImportWizard(descriptor);
  // "Complete" only when every line became a record. A line already there is not a failure; a line the write refused,
  // or the preview refused for its errors, is a line not imported.
  const someNotImported = (wiz.result?.failed.length ?? 0) > 0 || wiz.validation.some((v) => !v.valid && !v.already);
  const subId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [pendingExit, setPendingExit] = React.useState<PendingImportExit | null>(null);
  const dirty = (wiz.step === 'mapping' || wiz.step === 'preview') && wiz.parsed != null;

  // A close from result after a successful import refetches the parent list.
  const closeWizard = useCallback(() => onClose((wiz.result?.created ?? 0) > 0), [wiz.result, onClose]);
  const requestClose = useCallback(() => {
    if (wiz.step === 'committing') return; // never abandon mid-write
    if (dirty) {
      setPendingExit({ kind: 'close', run: closeWizard });
      return;
    }
    closeWizard();
  }, [wiz.step, dirty, closeWizard]);

  useUnsavedChangesGuard({
    dirty,
    guardHistory: true,
    onBlocked: (leave) => setPendingExit({ kind: 'leave', run: leave }),
  });

  // AC-A11Y-MODAL-001 / CMP-009: background inert while open. Kept ALONGSIDE the library's
  // `modal="trap-focus"`: that mode traps Tab and Esc but does NOT inert the app shell behind
  // the dialog, so a pointer/screen-reader user could still reach it without this.
  useEffect(() => {
    return acquireBackgroundInert();
  }, []);

  // Initial focus: the step's first real CONTROL (the upload drop zone / a mapping select).
  // Form controls are preferred over buttons so focus lands on the work, not the header's
  // Close X (which is first in DOM order). Base UI restores focus to the opener on close.
  const initialFocus = useCallback(() => {
    const root = dialogRef.current;
    const firstField =
      root?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ??
      root?.querySelector<HTMLElement>('button:not([disabled])');
    return firstField ?? root ?? true;
  }, []);

  return (
    <>
    <Dialog.Root
      open
      modal="trap-focus"
      onOpenChange={(next, details) => {
        if (next) return;
        // The parent owns mount: Esc / scrim only ASK to close (blocked while committing).
        details.cancel();
        requestClose();
      }}
    >
      <Dialog.Portal>
        <div className="fixed inset-0 z-[800] flex items-center justify-center p-4">
          <Dialog.Backdrop data-testid="import-scrim" className={overlayBackdropClassName} style={overlayBackdropStyle} />
          <Dialog.Popup
            ref={dialogRef}
            initialFocus={initialFocus}
            aria-modal="true"
            aria-describedby={subId}
            className={cn(
              'confirm-anim relative z-[810] flex max-h-[85dvh] w-[calc(100%-32px)] flex-col rounded-lg border border-border bg-popover',
              descriptor.wide ? 'max-w-[1120px]' : 'max-w-[640px]',
              'shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)]',
              'origin-center motion-reduce:animate-none',
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-border px-[var(--space-content-inset)] py-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-[16px] font-bold tracking-[-0.01em] text-popover-foreground">
                  {wiz.step === 'upload'
                    ? t('import:wizard.title', 'Import {{entity}}', { entity: entityWord(descriptor, i18n.resolvedLanguage ?? i18n.language) })
                    : stepTitle(wiz.step, t, someNotImported)}
                </Dialog.Title>
                <Dialog.Description render={<p />} id={subId} className="mt-px text-control text-muted-foreground">
                  {stepSubtitle(wiz.step, t, descriptor.maxRows ?? MAX_IMPORT_ROWS)}
                </Dialog.Description>
              </div>
              <Button
                variant="ghost"
                iconOnly
                aria-label={t('import:wizard.close', 'Close')}
                onClick={requestClose}
                disabled={wiz.step === 'committing'}
              >
                <Icon name="x" />
              </Button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-[var(--space-content-inset)] py-4">
              {wiz.step === 'upload' && <UploadStep wiz={wiz} descriptor={descriptor} maxRows={descriptor.maxRows ?? MAX_IMPORT_ROWS} />}
              {wiz.step === 'mapping' && <MappingStep wiz={wiz} descriptor={descriptor} />}
              {wiz.step === 'preview' && <PreviewStep wiz={wiz} descriptor={descriptor} />}
              {wiz.step === 'committing' && <CommittingStep wiz={wiz} />}
              {wiz.step === 'result' && <ResultStep wiz={wiz} descriptor={descriptor} />}
            </div>

            {/* Footer — per-step actions. */}
            <div className="flex items-center gap-2 border-t border-border px-[var(--space-content-inset)] py-3">
              {(wiz.step === 'mapping' || wiz.step === 'preview') && (
                <Button variant="ghost" size="sm" onClick={wiz.back}>
                  {t('import:wizard.back', 'Back')}
                </Button>
              )}
              {wiz.step === 'preview' && wiz.counts.invalid > 0 && wiz.parsed && (
                <Button variant="outline" size="sm" onClick={() => {
                  const rejected = wiz.validation.filter((v) => !v.valid && !v.already).map((v) => ({
                    index: v.index,
                    reason: descriptor.fields.flatMap((field) => v.errors[field.key] ? [v.errors[field.key] as string] : []).join(' '),
                  }));
                  void downloadFailedRows(wiz.parsed!, rejected, wiz.validation.filter((v) => v.already).map((v) => v.index), descriptor.entity, t);
                }}>
                  {t('import:result.downloadFailed', 'Download rows not imported')}
                </Button>
              )}
              <div className="ml-auto flex items-center gap-2">
                {wiz.step === 'upload' && (
                  <Button variant="ghost" size="sm" onClick={requestClose}>
                    {t('import:wizard.cancel', 'Cancel')}
                  </Button>
                )}
                {wiz.step === 'mapping' && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={wiz.goPreview}
                    disabled={!wiz.allRequiredMapped}
                  >
                    {t('import:wizard.next', 'Next')}
                  </Button>
                )}
                {wiz.step === 'preview' && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void wiz.commit()}
                    disabled={wiz.counts.valid === 0 || (descriptor.allOrNothing != null && (wiz.counts.invalid > 0 || wiz.alreadyCount > 0)) || wiz.existingStatus === 'loading' || (matchOf(descriptor) != null && wiz.existingStatus === 'failed')}
                    aria-describedby={nothingNew(wiz) ? NOTHING_NEW_ID : undefined}
                  >
                    {matchOf(descriptor) && wiz.existingStatus === 'ready' ? matchButtonLabel(t, wiz.matchCounts) : t('import:wizard.importButton', {
                      count: wiz.counts.valid,
                      entity: entityWord(descriptor, i18n.resolvedLanguage ?? i18n.language, wiz.counts.valid === 1),
                      defaultValue_one: 'Import {{count}} {{entity}}',
                      defaultValue_other: 'Import {{count}} {{entity}}',
                    })}
                  </Button>
                )}
                {wiz.step === 'result' && (
                  <Button variant="primary" size="sm" onClick={requestClose}>
                    {t('import:wizard.done', 'Done')}
                  </Button>
                )}
              </div>
            </div>
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
    <UnsavedChangesDialog
      open={pendingExit !== null}
      onDiscard={() => {
        const exit = pendingExit;
        setPendingExit(null);
        exit?.run();
      }}
      onKeepEditing={() => setPendingExit(null)}
    />
    </>
  );
}

// ── Steps ────────────────────────────────────────────────────────────────────

type Wiz<Input> = ReturnType<typeof useImportWizard<Input>>;

const NOTHING_NEW_ID = 'import-nothing-new';

/** What the confirm will do, in words: "Add 3 and update 12". Only adds or only updates drop the empty half; nothing at all keeps both halves ("Add 0 and update 0"). */
function matchButtonLabel(t: TFunction, c: { added: number; updated: number }): string {
  if (c.added > 0 && c.updated === 0) return t('import:match.addOnly', { count: c.added, defaultValue_one: 'Add {{count}}', defaultValue_other: 'Add {{count}}' });
  if (c.updated > 0 && c.added === 0) return t('import:match.updateOnly', { count: c.updated, defaultValue_one: 'Update {{count}}', defaultValue_other: 'Update {{count}}' });
  return t('import:match.addAndUpdate', 'Add {{added}} and update {{updated}}', c);
}
/** Every row the sheet could import is already on the target: the button is disabled, and this says why. */
const matchOf = <Input,>(descriptor: ImportDescriptor<Input>) => descriptor.matchExisting;
const nothingNew = <Input,>(wiz: Wiz<Input>) => wiz.existingStatus === 'ready' && wiz.counts.valid === 0 && wiz.alreadyCount > 0;

function UploadStep<Input>({ wiz, descriptor, maxRows }: { wiz: Wiz<Input>; descriptor: ImportDescriptor<Input>; maxRows: number }) {
  const inputId = useId();
  const { t } = useTranslation('import');
  const [pasted, setPasted] = React.useState('');
  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center"
      >
        <Icon name="upload" className="size-6 text-muted-foreground" />
        <span className="text-control font-semibold text-foreground">{t('import:upload.chooseFile', 'Choose an .xlsx file')}</span>
        <span className="text-control text-muted-foreground">
          {t('import:upload.headersNote', 'The first row must be column headers. Up to {{max}} rows.', { max: maxRows })}
        </span>
        <FileInput
          id={inputId}
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label={t('import:upload.chooseFile', 'Choose an .xlsx file')}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void wiz.selectFile(f);
            // Reset so re-choosing the same file fires change again.
            e.target.value = '';
          }}
        />
      </label>
      {descriptor.template && (
        <div>
          <Button
            variant="outline"
            size="sm"
            data-testid="import-download-template"
            onClick={() => {
              void buildTemplateWorkbook(descriptor, {
                sheet: t('import:template.sheet', 'Template'),
                notes: t('import:template.notes', 'Notes'),
                field: t('import:template.field', 'Field'),
                required: t('import:template.required', 'Required'),
                optional: t('import:template.optional', 'Optional'),
                meaning: t('import:template.meaning', 'Meaning'),
                accepted: t('import:template.accepted', 'Accepted values'),
                rowCap: t('import:template.rowCap', 'Up to {{max}} rows per file.'),
              }).then((buf) => triggerBlobDownload(new Blob([buf], { type: XLSX_MIME }), exportFilename(`${descriptor.entity}-template`)));
            }}
          >
            {t('import:template.download', 'Download template')}
          </Button>
        </div>
      )}
      <TextArea
        label={t('import:paste.label', 'Or paste rows copied from a spreadsheet')}
        helper={t('import:paste.helper', 'Include the header row. Columns separated by tabs, as copied from a sheet.')}
        value={pasted}
        onChange={setPasted}
        rows={4}
        fullWidth
      />
      <div>
        <Button variant="outline" size="sm" onClick={() => wiz.selectPaste(pasted)} disabled={pasted.trim() === ''}>
          {t('import:paste.use', 'Use pasted rows')}
        </Button>
      </div>
      {wiz.parsing && <p role="status">{t('import:upload.reading', 'Reading file…')}</p>}
      {wiz.parseError && (
        <p role="alert" className="flex items-start gap-1.5 text-control text-destructive">
          <Icon name="alert" className="mt-px size-4 shrink-0" />
          {wiz.parseError}
        </p>
      )}
    </div>
  );
}

function MappingStep<Input>({ wiz, descriptor }: { wiz: Wiz<Input>; descriptor: ImportDescriptor<Input> }) {
  const { t } = useTranslation('import');
  const headers = wiz.parsed?.headers ?? [];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-control text-muted-foreground">
        {t('import:mapping.requiredLegend', '* Required. The import cannot continue until it is matched.')}
      </p>
      {descriptor.fields.filter((field) => !field.internal).map((field) => (
        <MappingRow
          key={field.key}
          field={field}
          wide={descriptor.wide === true}
          headers={headers}
          value={wiz.mapping[field.key] ?? null}
          onChange={(idx) => wiz.setFieldMapping(field.key, idx)}
        />
      ))}
      {!wiz.allRequiredMapped && (
        <p role="alert" className="text-control text-destructive">
          {t('import:mapping.requiredAlert', 'Map every required field to continue.')}
        </p>
      )}
    </div>
  );
}

function MappingRow<Input>({
  field,
  wide,
  headers,
  value,
  onChange,
}: {
  field: ImportField<Input>;
  wide: boolean;
  headers: string[];
  value: number | null;
  onChange: (idx: number | null) => void;
}) {
  const id = useId();
  const { t, i18n } = useTranslation('import');
  return (
    // A label and its select read as one pair: stacked on a phone, side by side from `md` with a column each
    // (in the wide dialog the columns are fixed, not stretched to 550px apart — layout rule 1/2).
    <div className={cn('grid grid-cols-1 gap-1.5 md:items-start md:gap-4', wide ? 'md:grid-cols-[minmax(0,18rem)_minmax(0,22rem)]' : 'md:grid-cols-[1fr_1fr]')}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} id={`${id}-label`} className="text-control font-medium text-foreground">
          {fieldLabel(field, i18n.resolvedLanguage ?? i18n.language)}
          {field.required && <span className="ml-0.5 text-destructive">*</span>}
        </label>
        {field.hint && <p id={`${id}-hint`} className="text-control text-muted-foreground">{field.hint}</p>}
      </div>
      <SelectField
        id={id}
        aria-labelledby={`${id}-label`}
        aria-describedby={field.hint ? `${id}-hint` : undefined}
        label=""
        required={field.required}
        hideLabel
        value={value === null ? '' : String(value)}
        onChange={(next) => onChange(next === '' ? null : Number(next))}
        options={[
          { value: '', label: t('import:mapping.notMapped', '— Not mapped —') },
          ...headers.map((header, index) => ({
            value: String(index),
            label: header || t('import:mapping.column', 'Column {{n}}', { n: index + 1 }),
          })),
        ]}
      />
    </div>
  );
}

// A "Valid" preview row is a positive/ready outcome → green `won` (its negative
// counterpart "Skipped" is `lost`). Per the Freed-Blue Status Rule, this chip never
// uses the action-blue `open` variant.
const CHIP_VARIANT: StatusVariant = 'won';

function PreviewStep<Input>({ wiz, descriptor }: { wiz: Wiz<Input>; descriptor: ImportDescriptor<Input> }) {
  const { t, i18n } = useTranslation('import');
  const rows = wiz.parsed?.rows ?? [];
  // `hideInPreview` fields stay mapped + validated but hold no column (round A item 6: the import key is
  // internal; the Row number identifies the row). An error on a hidden field still surfaces — under the
  // row's Status — so a refused row is never silent.
  const visibleFields = descriptor.fields.filter((field) => !field.hideInPreview);
  const hiddenFields = descriptor.fields.filter((field) => field.hideInPreview);
  const primaryField = visibleFields[0];
  const wide = descriptor.wide === true;
  const valueOf = (v: (typeof wiz.validation)[number], key: string) => {
    const col = wiz.mapping[key];
    return col == null ? '' : (rows[v.index]?.[col] ?? '');
  };
  // Wide preview (#1278 round B): one line per cell, figures right-aligned and never wrapped, and every error of
  // the row in plain words under its Status — the messages name their field, so the cells stay clean.
  const alreadyText = descriptor.matchExisting?.noChange ?? descriptor.existingKeys?.alreadyThere;
  // Status is words, never colour alone: New / Will update / No change / Valid / Skipped.
  const statusPill = (v: (typeof wiz.validation)[number]) => {
    if (v.valid && v.action === 'update') return <StatusPill variant={CHIP_VARIANT}>{t('import:preview.willUpdate', 'Will update')}</StatusPill>;
    if (v.valid && v.action === 'new') return <StatusPill variant={CHIP_VARIANT}>{t('import:preview.new', 'New')}</StatusPill>;
    if (v.valid) return <StatusPill variant={CHIP_VARIANT}>{t('import:preview.valid', 'Valid')}</StatusPill>;
    if (v.already && descriptor.matchExisting) return <StatusPill variant="neutral">{t('import:preview.noChange', 'No change')}</StatusPill>;
    return <StatusPill variant={v.already ? 'neutral' : 'lost'}>{t('import:preview.skipped', 'Skipped')}</StatusPill>;
  };
  // What an update would change, field by field: "Display name: Ana → Ana Putri".
  const changeLines = (v: (typeof wiz.validation)[number]) => v.changes?.map((c) => (
    <span key={c.field} className="break-words text-control text-muted-foreground">
      {t('import:match.change', '{{field}}: {{from}} → {{to}}', { field: c.field, from: c.from || '—', to: c.to, interpolation: { escapeValue: false } })}
    </span>
  ));
  const wideStatus = (v: (typeof wiz.validation)[number]) => {
    const messages = descriptor.fields.flatMap((field) => (v.errors[field.key] ? [v.errors[field.key] as string] : []));
    const pill = statusPill(v);
    return (
      <span className="flex min-w-0 flex-col items-start gap-1">
        {pill}
        {changeLines(v)}
        {v.already && <span className="break-words text-control text-muted-foreground">{alreadyText}</span>}
        {messages.map((message) => <span key={message} className="break-words text-control text-destructive">{message}</span>)}
      </span>
    );
  };
  const wideColumns: Column<(typeof wiz.validation)[number]>[] = [
    { key: 'row', header: t('import:preview.row', 'Row'), kind: 'number', align: 'num', size: 64, cell: (v) => v.index + 1, exportValue: (v) => v.index + 1 },
    ...visibleFields.map((field): Column<(typeof wiz.validation)[number]> => ({
      key: field.key,
      header: fieldLabel(field, i18n.resolvedLanguage ?? i18n.language),
      kind: 'text',
      size: field.previewSize ?? 100,
      ...(field.numeric ? { align: 'num' as const } : {}),
      cell: (v) => {
        const raw = valueOf(v, field.key);
        // A bare "—" (not wrapped in an element) lets the table drop an optional column left blank on every row.
        if (!raw) return '—';
        // The parsed value in the reader's language; the file's own text only for a cell that cannot be read.
        const shown = field.format?.(raw) ?? raw;
        // Not `.truncate`: the shared table turns that class back into wrapping. The preview's brief is one line per
        // cell on a desktop row, the full text in `title`; a phone card wraps as every card does.
        return field.numeric
          ? <span className="whitespace-nowrap tabular-nums">{shown}</span>
          : <span className="block md:overflow-hidden md:text-ellipsis md:whitespace-nowrap" title={raw}>{raw}</span>;
      },
    })),
    { key: 'status', header: t('import:preview.status', 'Status'), kind: 'text', size: 220, cell: wideStatus },
  ];
  // A phone card is headed by what the row IS (item code and description), "Row n" when both are empty.
  const cardTitle = descriptor.rowTitle
    ? (v: (typeof wiz.validation)[number]) =>
        descriptor.rowTitle?.(rowToCells(rows[v.index] ?? [], descriptor.fields, wiz.mapping))
        || t('import:preview.rowNumber', 'Row {{n}}', { n: v.index + 1 })
    : undefined;
  // The card's detail list leaves out what its heading already says (layout rule 9: no repeats).
  const cardDetails = descriptor.rowTitle
    ? (v: (typeof wiz.validation)[number]) => (
        <dl className="grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {wideColumns
            .filter((col) => col.key !== 'row' && !descriptor.fields.some((field) => field.key === col.key && field.inRowTitle))
            // A field the row leaves empty ("—") is not listed: a label with nothing to say is noise on a phone.
            .flatMap((col) => (col.cell(v) === '—' ? [] : [(
              <React.Fragment key={col.key}>
                <dt className="self-start text-control font-semibold text-muted-foreground">{col.header}</dt>
                <dd className="min-w-0 break-words text-control text-foreground">{col.cell(v)}</dd>
              </React.Fragment>
            )]))}
        </dl>
      )
    : undefined;
  const columns: Column<(typeof wiz.validation)[number]>[] = wide ? wideColumns : [
    { key: 'row', header: t('import:preview.row', 'Row'), kind: 'number', align: 'num', cell: (v) => v.index + 1, exportValue: (v) => v.index + 1 },
    ...visibleFields.map((field): Column<(typeof wiz.validation)[number]> => ({
      key: field.key,
      header: fieldLabel(field, i18n.resolvedLanguage ?? i18n.language),
      kind: field.key === primaryField?.key ? 'primary' : 'text',
      cell: (v) => {
        const col = wiz.mapping[field.key];
        const raw = col == null ? '' : (rows[v.index]?.[col] ?? '');
        if (field.key === primaryField?.key) return raw || <span className="text-muted-foreground">—</span>;
        return <>{raw || <span className="text-muted-foreground">—</span>}{v.errors[field.key] && <span className="mt-0.5 block text-control text-destructive">{v.errors[field.key]}</span>}</>;
      },
      ...(field.key === primaryField?.key ? {
        primaryTitle: (v: (typeof wiz.validation)[number]) => {
          const col = wiz.mapping[field.key];
          return col == null ? '' : (rows[v.index]?.[col] ?? '');
        },
        secondaryCell: (v: (typeof wiz.validation)[number]) => v.errors[field.key]
          ? <span className="mt-0.5 block text-control text-destructive">{v.errors[field.key]}</span>
          : null,
      } : {}),
    })),
    { key: 'status', header: t('import:preview.status', 'Status'), kind: 'status', cell: (v) => {
      const hiddenErrors = hiddenFields.flatMap((field) => (v.errors[field.key] ? [v.errors[field.key] as string] : []));
      const pill = statusPill(v);
      if (hiddenErrors.length === 0 && !v.already && !v.changes?.length) return pill;
      return (
        <span className="flex flex-col items-start gap-0.5">
          {pill}
          {changeLines(v)}
          {v.already && <span className="text-control text-muted-foreground">{alreadyText}</span>}
          {hiddenErrors.map((message) => <span key={message} className="text-control text-destructive">{message}</span>)}
        </span>
      );
    } },
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-control text-foreground" data-testid="import-summary">
        {descriptor.matchExisting
          ? <b className="font-semibold">{t('import:match.summary', '{{added}} to add, {{updated}} to update', wiz.matchCounts)}</b>
          : <b className="font-semibold">{t('import:preview.validCount', '{{n}} valid', { n: wiz.counts.valid })}</b>}, {t('import:preview.invalidCount', '{{n}} invalid', { n: wiz.counts.invalid })}, {wiz.alreadyCount > 0 && <>{descriptor.matchExisting ? t('import:match.noChangeCount', '{{n}} no change', { n: wiz.alreadyCount }) : t('import:preview.alreadyCount', '{{n}} already there', { n: wiz.alreadyCount })}, </>}{t('import:preview.totalCount', '{{n}} total', { n: wiz.counts.total })}
      </p>
      {wiz.existingStatus === 'failed' && (
        <p role={descriptor.matchExisting ? 'alert' : 'status'} className="flex flex-wrap items-center gap-2 text-control text-muted-foreground">
          {descriptor.matchExisting?.unavailable ?? descriptor.existingKeys?.unavailable}
          {descriptor.matchExisting && <Button variant="outline" size="sm" onClick={wiz.retryExisting}>{t('import:match.retry', 'Try again')}</Button>}
        </p>
      )}
      {descriptor.allOrNothing && (wiz.counts.invalid > 0 || wiz.alreadyCount > 0) && <p role="status" className="text-control text-foreground">{descriptor.allOrNothing.blocked}</p>}
      {nothingNew(wiz) && <p role="status" id={NOTHING_NEW_ID} className="text-control text-foreground">{descriptor.matchExisting?.nothingToDo ?? descriptor.existingKeys?.nothingNew}</p>}
      <DataTable
        rows={wiz.validation}
        columns={columns}
        rowKey={(v) => String(v.index)}
        mobileCardTitle={cardTitle}
        mobileCardDetails={cardDetails}
        accessibleName={t('import:preview.tableName', 'Import row preview')}
        tableId={`components-import-importwizard-preview-${descriptor.entity.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        // One left edge (screen rule 1): rows run to the panel edge so the cell text sits on the panel's own inset.
        embedded
        className="-mx-[var(--table-cell-inset)] text-control"
      />
    </div>
  );
}

function CommittingStep<Input>({ wiz }: { wiz: Wiz<Input> }) {
  const { t } = useTranslation('import');
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center" role="status" aria-live="polite">
      <Icon name="refresh" className="size-5 animate-spin text-muted-foreground" />
      <p className="text-control text-foreground">
        {t('import:committing.progress', 'Importing {{done}} / {{total}}…', { done: wiz.progress.done, total: wiz.progress.total })}
      </p>
    </div>
  );
}

function ResultStep<Input>({ wiz, descriptor }: { wiz: Wiz<Input>; descriptor: ImportDescriptor<Input> }) {
  const { t } = useTranslation('import');
  const r = wiz.result;
  if (!r) return null;
  // Every row that did not become a record, in sheet order, with its reason: the rows the preview refused, the rows
  // already on the record (skipped), and the rows the write refused (#1278 round C item 3). Nothing is silent.
  // The row label names the first VISIBLE field's value — the import key stays internal (round A item 6).
  const nameKey = descriptor.fields.find((field) => !field.hideInPreview)?.key;
  const rows = wiz.parsed?.rows ?? [];
  // A row the preview flagged as already there is reported with the ones the write skipped: one count, one reason.
  const refused = wiz.validation.filter((v) => !v.valid && !v.already);
  const alreadyThere = wiz.validation.filter((v) => v.already).map((v) => v.index);
  const skippedCount = r.skipped + alreadyThere.length;
  const notImported = [
    ...refused.map((v) => ({
      index: v.index, tone: 'refused' as const,
      reason: descriptor.fields.flatMap((field) => (v.errors[field.key] ? [v.errors[field.key] as string] : [])).join(' '),
    })),
    ...[...alreadyThere, ...r.skippedIndexes].map((index) => ({ index, tone: 'skipped' as const, reason: t('import:result.alreadyImported', 'Already imported.') })),
    ...r.failed.map((f) => ({ index: f.index, tone: 'failed' as const, reason: f.reason ? `${t('import:result.notCreated', 'Not created')}: ${f.reason}` : t('import:result.notCreated', 'Not created') })),
  ].sort((a, b) => a.index - b.index);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-control text-foreground" data-testid="import-result-summary">
        <b className="font-semibold">{t('import:result.created', '{{n}} created', { n: r.created })}</b>
        {descriptor.matchExisting && <>, {t('import:result.updated', '{{n}} updated', { n: r.updated ?? 0 })}</>}
        {refused.length > 0 && <>, {t('import:result.invalid', '{{n}} skipped for errors', { n: refused.length })}</>}
        {/* DD-BIMP-8: skipped rows are shown, never folded into `created` — a re-run that writes
            nothing must not claim it wrote something. */}
        {skippedCount > 0 && <>, {t('import:result.skipped', '{{n}} skipped because already imported', { n: skippedCount })}</>}
        {r.failed.length > 0 && <>, {t('import:result.failed', '{{n}} failed', { n: r.failed.length })}</>}.
      </p>
      {notImported.some((f) => f.tone !== 'skipped') && wiz.parsed && (
        <div>
          <Button
            type="button"
            variant="outline"
            data-testid="import-download-failed"
            onClick={() => {
              void downloadFailedRows(
                wiz.parsed!,
                notImported.filter((f) => f.tone !== 'skipped'),
                notImported.filter((f) => f.tone === 'skipped').map((f) => f.index),
                descriptor.entity,
                t,
              );
            }}
          >
            {t('import:result.downloadFailed', 'Download rows not imported')}
          </Button>
        </div>
      )}
      {notImported.length > 0 && (
        <ul aria-label={t('import:result.listName', 'Rows not imported')} className="flex flex-col gap-1.5 text-control">
          {notImported.map((f) => {
            const col = nameKey ? wiz.mapping[nameKey] : null;
            const label = col == null ? '' : (rows?.[f.index]?.[col] ?? '');
            const reason = <span className="text-muted-foreground">{f.reason}</span>;
            return (
              <li key={f.index} className="flex items-start gap-1.5">
                {/* Already there reads neutral, like its neutral pill; a refused or failed row keeps the red alert. */}
                {f.tone === 'skipped'
                  ? <Icon name="info" className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                  : <Icon name="alert" className="mt-px size-3.5 shrink-0 text-destructive" />}
                <span className="text-foreground">
                  {label
                    ? t('import:result.rowNamed', 'Row {{n}} ({{label}}): ', { n: f.index + 1, label })
                    : t('import:result.rowReason', 'Row {{n}}: ', { n: f.index + 1 })}
                  {reason}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
