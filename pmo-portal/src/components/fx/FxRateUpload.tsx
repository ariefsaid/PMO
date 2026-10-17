import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ConfirmDialog,
  DataTable,
  EntityFormModal,
  type Column,
  type SubmitError,
} from '@/src/components/ui';
import type { FxRateInput } from '@/src/lib/repositories/types';
import { repositories } from '@/src/lib/repositories';
import { useFxRateMutations } from '@/src/hooks/useFxRates';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { buildFxPreview, type FxPreview } from '@/src/lib/import/fxRatePreview';
import { parseFxFile, type FxParsed } from '@/src/lib/import/fxRateParser';
import { ImportParseError } from '@/src/lib/import/types';
import { formatDateOnly, formatNumberExact } from '@/src/lib/format';

interface UploadError {
  kind: 'parse' | 'existing';
  code: string;
}

export interface FxRateUploadProps {
  today: string;
  onClose: () => void;
  onCommitted: (counts: { new: number; changed: number; unchanged: number }) => void;
  canUpload: boolean;
}

const reasonCopy = (reason: string, t: (key: string, fallback: string) => string): string => {
  switch (reason) {
    case 'invalidDate':
      return t('fx.invalidDate', 'Enter a valid publication date.');
    case 'futureDate':
      return t('fx.futureDate', 'Publication date cannot be in the future.');
    case 'invalidRate':
      return t(
        'fx.invalidRate',
        'Enter a rate from 1,000 to 100,000 with at most six decimal places; check separators.',
      );
    case 'formula':
      return t('fx.formula', 'Formula cells are not accepted.');
    case 'duplicateDate':
      return t('fx.duplicateDate', 'Different rates occur for this date; correct the file.');
    case 'ambiguousHeader':
      return t('fx.ambiguousHeader', 'Could not identify one date column and one rate column.');
    default:
      return t('fx.invalidCsv', 'CSV quoting or columns are invalid.');
  }
};

const fileErrorCopy = (code: string, t: (key: string, fallback: string) => string): string => {
  switch (code) {
    case 'fileTooLarge':
      return t('fx.fileTooLarge', 'File exceeds 5 MiB.');
    case 'emptyFile':
    case 'empty':
      return t('fx.emptyFile', 'The file contains no rate rows.');
    case 'too_many_rows':
      return t('fx.tooManyRows', 'Import at most 500 rows at a time.');
    case 'not_xlsx':
    case 'too_many_columns':
    case 'unsupportedFile':
      return t('fx.unsupportedFile', 'Choose a supported BI workbook or date,rate CSV.');
    case 'invalidCsv':
      return t('fx.invalidCsv', 'CSV quoting or columns are invalid.');
    default:
      return t('fx.invalidCsv', 'CSV quoting or columns are invalid.');
  }
};

const FxRateUpload: React.FC<FxRateUploadProps> = ({ today, onClose, onCommitted, canUpload }) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const commitLock = useRef(false);
  const mutation = useFxRateMutations();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [state, setState] = useState<
    'choose' | 'parsing' | 'preview' | 'error' | 'committing' | 'done'
  >('choose');
  const [parsed, setParsed] = useState<FxParsed | null>(null);
  const [preview, setPreview] = useState<FxPreview | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const [selected, setSelected] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const columns: Column<FxRateInput>[] = [
    {
      key: 'rate_date',
      header: t('fx.date', 'Publication date'),
      cell: (row) => formatDateOnly(row.rate_date),
      exportValue: (row) => row.rate_date,
    },
    {
      key: 'rate',
      header: t('fx.rate', 'IDR per USD'),
      align: 'num',
      cell: (row) => <span className="tabular-nums">{formatNumberExact(row.rate)}</span>,
      exportValue: (row) => row.rate,
    },
  ];

  const loadExisting = async (data: FxParsed, request: number) => {
    setState('parsing');
    setError(null);
    try {
      const existing = await repositories.fxRates.existing(data.rows.map((row) => row.rate_date));
      if (generation.current !== request) return;
      setPreview(buildFxPreview(data, existing));
      setState('preview');
    } catch {
      if (generation.current !== request) return;
      setPreview(null);
      setError({ kind: 'existing', code: 'existingError' });
      setState('error');
    }
  };

  const selectFile = async (file: File) => {
    const request = ++generation.current;
    setSelected(true);
    setSelectedFileName(file.name);
    setParsed(null);
    setPreview(null);
    setError(null);
    setSubmitError(null);
    setState('parsing');
    if (fileInputRef.current) fileInputRef.current.value = '';
    try {
      const result = await parseFxFile(file, today);
      if (generation.current !== request) return;
      setParsed(result);
      await loadExisting(result, request);
    } catch (cause) {
      if (generation.current !== request) return;
      const code = cause instanceof ImportParseError ? cause.code : 'unsupportedFile';
      setError({ kind: 'parse', code });
      setState('error');
    }
  };

  const close = () => {
    generation.current += 1;
    setParsed(null);
    setPreview(null);
    setError(null);
    setSubmitError(null);
    setConfirmOpen(false);
    setState('choose');
    setSelectedFileName(null);
    onClose();
  };

  const retryExisting = () => {
    if (parsed && error?.kind === 'existing') void loadExisting(parsed, generation.current);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canUpload || !preview || preview.rejected.length > 0 || preview.rows.length === 0) return;
    setSubmitError(null);
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (
      commitLock.current ||
      !canUpload ||
      !preview ||
      preview.rejected.length > 0 ||
      preview.rows.length === 0
    )
      return;
    commitLock.current = true;
    setState('committing');
    try {
      const counts = await mutation.upsert.mutateAsync(preview.rows);
      setConfirmOpen(false);
      setState('done');
      setParsed(null);
      setPreview(null);
      setSelected(false);
      setSelectedFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onCommitted(counts);
    } catch (cause) {
      const classified = classifyMutationError(cause, undefined, {
        module: 'administration',
        operation: 'import',
      });
      setSubmitError({
        headline: classified.headline,
        detail: t('fx.saveErrorDetail', 'Your rates were not saved. Please try again.'),
      });
      setState('preview');
      setConfirmOpen(false);
    } finally {
      commitLock.current = false;
    }
  };

  return (
    <>
      {!confirmOpen && (
        <EntityFormModal
          open
          title={t('fx.upload', 'Upload rates')}
          subtitle={t('fx.description', 'USD → IDR · JISDOR · display equivalents only')}
          submitLabel={t('common.continue', 'Continue')}
          cancelLabel={t('common.cancel', 'Cancel')}
          onSubmit={handleSubmit}
          onClose={close}
          submitDisabled={
            !canUpload ||
            state !== 'preview' ||
            !preview ||
            preview.rows.length === 0 ||
            preview.rejected.length > 0
          }
          dirty={selected}
          loading={state === 'committing'}
          submitError={submitError}
        >
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="fx-rate-file"
                className="text-[12px] font-semibold leading-[1.3] text-foreground"
              >
                {t('fx.chooseFile', 'Choose BI Excel or date,rate CSV')}
              </label>
              <input
                ref={fileInputRef}
                id="fx-rate-file"
                type="file"
                accept=".xlsx,.csv"
                disabled={!canUpload || state === 'parsing' || state === 'committing'}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void selectFile(file);
                }}
                className="block min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium"
              />
              {selectedFileName && (
                <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                  {selectedFileName}
                </p>
              )}
            </div>

            {state === 'parsing' && (
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                {t('fx.parsing', 'Reading rates…')}
              </p>
            )}

            {state === 'error' && error?.kind === 'parse' && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/[0.07] p-3 text-sm text-destructive-text"
              >
                {fileErrorCopy(error.code, t)}
              </div>
            )}
            {state === 'error' && error?.kind === 'existing' && (
              <div
                role="alert"
                className="space-y-2 rounded-md border border-destructive/30 bg-destructive/[0.07] p-3 text-sm text-destructive-text"
              >
                <p>
                  {t(
                    'fx.existingError',
                    'Could not check existing rates. No preview counts are available.',
                  )}
                </p>
                <Button variant="outline" size="sm" onClick={retryExisting}>
                  {t('fx.retry', 'Retry')}
                </Button>
              </div>
            )}

            {state === 'preview' && preview && (
              <div className="space-y-3">
                <div
                  aria-label={t('fx.previewSummary', 'Import preview summary')}
                  className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
                >
                  <span>{t('fx.newCount', '{{count}} new', { count: preview.new })}</span>
                  <span>
                    {t('fx.changedCount', '{{count}} changed', { count: preview.changed })}
                  </span>
                  <span>
                    {t('fx.unchangedCount', '{{count}} unchanged', { count: preview.unchanged })}
                  </span>
                  {preview.coverage.firstDate && preview.coverage.lastDate && (
                    <span className="text-muted-foreground">
                      {t('uxs38.previewCoverage', 'Dates from {{first}} to {{last}} — {{count}} with rates', {
                        first: formatDateOnly(preview.coverage.firstDate),
                        last: formatDateOnly(preview.coverage.lastDate),
                        count: preview.rows.length,
                      })}
                      {preview.coverage.missingDates.length > 0 && (
                        <> · {t('uxs38.previewGaps', 'No rate for {{dates}}', {
                          dates: preview.coverage.missingDates.map(formatDateOnly).join(', '),
                        })}</>
                      )}
                    </span>
                  )}
                  {preview.duplicates > 0 && (
                    <span>
                      {t('fx.duplicates', '{{count}} identical duplicates ignored', {
                        count: preview.duplicates,
                      })}
                    </span>
                  )}
                </div>
                {preview.rejected.length > 0 && (
                  <div role="alert" className="space-y-2">
                    <p className="text-sm text-destructive-text">
                      {t(
                        'fx.fixRejected',
                        'Correct rejected rows and upload again; nothing has been saved.',
                      )}
                    </p>
                    <div
                      role="group"
                      aria-label={t('fx.rejectedRows', 'Rejected rows')}
                      tabIndex={0}
                      className="max-h-40 overflow-y-auto rounded-md border border-border p-3"
                    >
                      <ul className="space-y-1 text-sm">
                        {preview.rejected.map((item) => (
                          <li key={`${item.row}:${item.reason}`}>
                            {t('fx.rejected', 'Row {{row}}: {{value}} — {{reason}}', {
                              row: item.row,
                              value: item.value ?? '',
                              reason: reasonCopy(item.reason, t),
                            })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                <div
                  className="max-h-72 overflow-auto rounded-md border border-border"
                  aria-label={t('fx.previewRows', 'Normalized rate preview')}
                >
                  <DataTable<FxRateInput>
                    rows={preview.rows}
                    columns={columns}
                    rowKey={(row) => row.rate_date}
                  />
                </div>
              </div>
            )}
          </div>
        </EntityFormModal>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={t('fx.confirmUpload', 'Save these JISDOR rates?')}
        description={
          <p>
            {t(
              'fx.confirmUploadDescription',
              'USD → IDR · JISDOR — {{new}} new, {{changed}} changed, {{unchanged}} unchanged.',
              {
                new: preview?.new ?? 0,
                changed: preview?.changed ?? 0,
                unchanged: preview?.unchanged ?? 0,
              },
            )}
          </p>
        }
        confirmLabel={t('fx.saveRates', 'Save rates')}
        cancelLabel={t('common.cancel', 'Cancel')}
        loading={state === 'committing' || mutation.upsert.isPending}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
};

export default FxRateUpload;
