import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, EntityFormModal, SelectField, TextArea } from '@/src/components/ui';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatExactCents } from '@/src/lib/exactDecimal';
import { formatCurrencyCents } from '@/src/lib/format';
import { Constants } from '@/src/lib/supabase/database.types';
import {
  parsePasteTsv,
  previewPasteRows,
  PasteRowsParseError,
  isAmbiguousCommaNumber,
  type PasteBudgetCategory,
  type PasteMode,
  type PasteRowError,
  type PasteTsvRow,
} from '@/src/lib/budget/pasteRows';
import { useBudgetPasteRows, type BudgetPasteRowResult } from '@/src/hooks/useBudgetPasteRows';

const CATEGORIES = Constants.public.Enums.budget_category;
const MAPPING_FIELDS = ['category', 'description', 'amount', 'quantity', 'rate'] as const;
type MappingField = (typeof MAPPING_FIELDS)[number];

export interface BudgetPasteRowsDialogProps {
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  projectId: string;
  /** The Draft this dialog was opened for; saving writes only here. */
  targetId: string;
  /** The version currently selected on the page; a mismatch with `targetId` blocks saving. */
  selectedId: string | null;
  isDraft: boolean;
  canCreate: boolean;
  canEdit: boolean;
  currency: string;
  versionLabel: string;
}

type Mapping = Record<MappingField, number | null>;
const DEFAULT_MAPPING: Mapping = { category: 0, description: 1, amount: 2, quantity: null, rate: null };

/** A safe-integer total shows with grouping; beyond 2^53 the exact string is shown instead of a rounded float. */
function formatTotal(cents: bigint, currency: string): string {
  const exact = formatExactCents(cents);
  return Number.isSafeInteger(Number(cents)) ? formatCurrencyCents(Number(exact), currency) : `${currency} ${exact}`;
}

const BudgetPasteRowsDialog: React.FC<BudgetPasteRowsDialogProps> = ({
  onClose, onDirtyChange, projectId, targetId, selectedId, isDraft, canCreate, canEdit, currency, versionLabel,
}) => {
  const { t } = useTranslation('finance');
  const headerId = useId();
  const ambiguousId = useId();
  const [text, setText] = useState('');
  const [header, setHeader] = useState(false);
  const [mapping, setMapping] = useState<Mapping>(DEFAULT_MAPPING);
  const [mode, setMode] = useState<PasteMode | null>(null);
  const [aliases, setAliases] = useState<Record<string, PasteBudgetCategory>>({});

  const paste = useBudgetPasteRows({ projectId, targetId, selectedId, isDraft, canCreate, canEdit });
  const { results } = paste;
  const hasResults = results.length > 0;
  const summaryRef = useRef<HTMLParagraphElement>(null);
  // The collapsed result summary is the safety signal (e.g. "not confirmed"); move focus to it when results first appear.
  useEffect(() => { if (hasResults) summaryRef.current?.focus(); }, [hasResults]);

  const parsed = useMemo<{ rows: PasteTsvRow[]; failed: boolean }>(() => {
    try { return { rows: parsePasteTsv(text), failed: false }; } catch (error) {
      if (error instanceof PasteRowsParseError) return { rows: [], failed: true };
      throw error;
    }
  }, [text]);
  const columnCount = parsed.rows.reduce((max, row) => Math.max(max, row.cells.length), 0);

  const preview = useMemo(() => previewPasteRows(parsed.rows, mapping, header, mode, aliases), [parsed.rows, mapping, header, mode, aliases]);
  const unknownCategories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of preview.rows) {
      if (row.errors.some((e) => e.field === 'category' && e.code === 'unknown-category')) {
        seen.set(row.raw.category.normalize('NFKC').trim().toLowerCase(), row.raw.category.trim());
      }
    }
    return [...seen.values()];
  }, [preview.rows]);

  const amountMapped = mapping.amount !== null;
  const pairMapped = mapping.quantity !== null && mapping.rate !== null;
  const shownMode: PasteMode | null = mode ?? (amountMapped && !pairMapped ? 'amount' : pairMapped && !amountMapped ? 'quantity-rate' : null);

  const hasInput = text.trim() !== '';
  const validRows = preview.rows.filter((row) => row.errors.length === 0 && row.category !== null && row.amount !== null);
  // `12,345` is a thousands group by the dot-decimal rule; an Indonesian comma decimal would mean 12.345. One confirmation covers the current set.
  const ambiguousRows = validRows.filter((row) => (shownMode === 'quantity-rate' ? [row.raw.quantity, row.raw.rate] : [row.raw.amount]).some(isAmbiguousCommaNumber));
  const ambiguousKey = ambiguousRows.map((row) => `${row.rowNumber}:${row.amount}`).join('|');
  const ambiguousRowNumbers = new Set(ambiguousRows.map((row) => row.rowNumber));
  const [confirmedKey, setConfirmedKey] = useState('');
  const ambiguityConfirmed = ambiguousRows.length === 0 || confirmedKey === ambiguousKey;
  const canSave = hasInput && validRows.length > 0 && ambiguityConfirmed && !hasResults && !paste.isSaving;
  const unresolved = results.some((r) => r.status !== 'created');
  const dirty = (hasInput && !hasResults) || unresolved;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  // AC-ERR-001: a rejected row is also shown inline and stays; a fresh object per results change re-announces it.
  const firstError = results.find((r) => r.error)?.error;
  const submitError = useMemo(() => (firstError ? { headline: firstError.headline, detail: firstError.detail } : null), [results]); // eslint-disable-line react-hooks/exhaustive-deps
  const failedRetryable = results.filter((r) => r.status === 'failed' && r.retryable);

  const headerText = t('budgetPaste.header', 'First row is a header');
  const ambiguousText = t('budgetPaste.ambiguousConfirm', '{{count}} amounts like 12,345 are read as thousands (12345), not decimals (12.345). I confirm this is right.', { count: ambiguousRows.length });

  const columnOptions = (field: MappingField) => [
    { value: '', label: t('budgetPaste.notUsed', 'Not used') },
    ...Array.from({ length: Math.max(columnCount, (mapping[field] ?? -1) + 1) }, (_, i) => ({
      value: String(i), label: t('budgetPaste.column', 'Col {{n}}', { n: i + 1 }),
    })),
  ];
  const fieldLabel: Record<MappingField, string> = {
    category: t('budgetPaste.field.category', 'Category'),
    description: t('budgetPaste.field.description', 'Description'),
    amount: t('budgetPaste.field.amount', 'Amount'),
    quantity: t('budgetPaste.field.quantity', 'Quantity'),
    rate: t('budgetPaste.field.rate', 'Rate'),
  };
  const errorText = (e: PasteRowError) => {
    const field = fieldLabel[e.field as MappingField] ?? t('budgetPaste.field.row', 'Row');
    return t(`budgetPaste.rowError.${e.code}`, { field, defaultValue: `${field}: ${e.code}` });
  };
  const blockText = preview.errors.map((e) => t(`budgetPaste.blockError.${e.code}`, { defaultValue: e.code })).join(' ');
  const statusText = (r: BudgetPasteRowResult) => {
    if (r.status === 'created') return t('budgetPaste.result.created', 'Saved');
    if (r.status === 'failed') return t('budgetPaste.result.failed', 'Not saved: {{reason}}', { reason: r.error?.headline ?? '' });
    if (r.status === 'uncertain') return t('budgetPaste.result.uncertain', 'Not confirmed. Check the budget lines before pasting this row again.');
    if (r.status === 'unsubmitted') return t('budgetPaste.result.unsubmitted', 'Not submitted');
    return t('budgetPaste.result.pending', 'Saving…');
  };

  const close = () => {
    paste.acknowledgeAndStartNewSession();
    onClose();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    void paste.save(validRows.map((row) => ({
      rowNumber: row.rowNumber,
      category: row.category as PasteBudgetCategory,
      description: row.description,
      amount: row.amount as string,
    })));
  };

  return (
    <EntityFormModal
      open
      width="lg"
      title={t('budgetPaste.title', 'Paste rows')}
      submitLabel={t('budgetPaste.save', 'Save {{count}} valid rows', { count: validRows.length })}
      cancelLabel={hasResults && !unresolved ? t('budgetPaste.done', 'Done') : undefined}
      onSubmit={submit}
      onClose={close}
      submitDisabled={!canSave}
      submitError={submitError}
      hideSubmit={hasResults}
      disabledReason={t('budgetPaste.disabledReason', 'Paste rows with a mapped category and amount, with at least one valid row.')}
      loading={paste.isSaving}
      dirty={dirty}
      discardCopy={{
        title: t('budgetPaste.discardTitle', 'Close without finishing?'),
        description: t('budgetPaste.discardBody', 'Pasted rows that are not saved, and rows not confirmed, will be dropped. Check the budget lines afterwards.'),
        confirmLabel: t('budgetPaste.discardConfirm', 'Close'),
        cancelLabel: t('budgetPaste.discardKeep', 'Keep editing'),
      }}
    >
      <div className="space-y-4">
        {hasResults && (
          <section aria-label={t('budgetPaste.resultsLabel', 'Save results')} className="space-y-2">
            <p ref={summaryRef} tabIndex={-1} role="status" aria-live="polite" data-testid="paste-result-summary" className="text-sm font-medium outline-none">
              {paste.isSaving
                ? t('budgetPaste.progress', 'Saving {{completed}} of {{total}}…', paste.progress)
                : t('budgetPaste.resultSummary', '{{created}} of {{total}} rows saved.', { created: results.filter((r) => r.status === 'created').length, total: results.length })}
            </p>
            {paste.refreshError && <p role="alert" className="text-sm text-destructive-text">{paste.refreshError}</p>}
            {failedRetryable.length > 0 && (
              <Button type="button" variant="outline" size="sm" disabled={paste.isSaving} onClick={() => { void paste.retryFailed(); }}>
                {t('budgetPaste.retry', 'Retry {{count}} failed rows', { count: failedRetryable.length })}
              </Button>
            )}
            <ul className="space-y-1 text-sm">
              {results.map((r) => (
                <li key={r.rowNumber}>
                  {t('budgetPaste.resultRow', 'Row {{row}} · {{category}} · {{amount}}', { row: r.rowNumber, category: budgetCategoryLabel(r.category, t), amount: r.amount })}
                  {': '}{statusText(r)}
                </li>
              ))}
            </ul>
          </section>
        )}
        {paste.validationError && <p role="alert" className="text-sm text-destructive-text">{paste.validationError}</p>}
        {!hasResults && (<>
        <TextArea
          label={t('budgetPaste.textLabel', 'Rows pasted from a spreadsheet')}
          helper={t('budgetPaste.textHelper', 'Copy cells from any spreadsheet and paste them here. Up to 500 rows. Numbers use a dot for decimals; commas may group thousands.')}
          value={text}
          onChange={(value) => { setText(value); setAliases({}); }}
          rows={5}
          fullWidth
        />
        {parsed.failed && <p role="alert" className="text-sm text-destructive-text">{t('budgetPaste.parseError', 'The pasted text has an unclosed quote. Check it and paste again.')}</p>}

        {hasInput && !parsed.failed && (
          <>
            <fieldset className="grid min-w-0 grid-cols-2 gap-3 border-0 p-0 sm:grid-cols-3">
              <legend className="sr-only">{t('budgetPaste.mappingLegend', 'Column mapping')}</legend>
              {MAPPING_FIELDS.map((field) => (
                <SelectField
                  key={field}
                  label={t('budgetPaste.mapField', '{{field}} column', { field: fieldLabel[field] })}
                  value={mapping[field] === null ? '' : String(mapping[field])}
                  options={columnOptions(field)}
                  onChange={(value) => setMapping((m) => ({ ...m, [field]: value === '' ? null : Number(value) }))}
                />
              ))}
            </fieldset>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="inline-flex items-center gap-2 text-sm">
                <Checkbox checked={header} onChange={setHeader} label={headerText} labelledBy={headerId} />
                <span id={headerId} onClick={() => setHeader(!header)}>{headerText}</span>
              </span>
              <fieldset className="flex flex-wrap items-center gap-4 border-0 p-0 text-sm">
                <legend className="sr-only">{t('budgetPaste.modeLegend', 'Amount mode')}</legend>
                {(['amount', 'quantity-rate'] as const).map((value) => (
                  <label key={value} className="inline-flex items-center gap-2">
                    <input type="radio" className="accent-primary" name="paste-mode" checked={shownMode === value} onChange={() => setMode(value)} />
                    {value === 'amount' ? t('budgetPaste.modeAmount', 'Use Amount') : t('budgetPaste.modeProduct', 'Use Quantity × Rate')}
                  </label>
                ))}
              </fieldset>
            </div>

            {unknownCategories.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {unknownCategories.map((raw) => (
                  <SelectField
                    key={raw}
                    label={t('budgetPaste.mapCategory', 'Map "{{raw}}" to', { raw })}
                    value={aliases[raw] ?? ''}
                    placeholder={t('budgetPaste.chooseCategory', 'Choose a category')}
                    options={CATEGORIES.map((c) => ({ value: c, label: budgetCategoryLabel(c, t) }))}
                    onChange={(value) => setAliases((a) => ({ ...a, [raw]: value as PasteBudgetCategory }))}
                  />
                ))}
              </div>
            )}

            {ambiguousRows.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                <Checkbox
                  checked={confirmedKey === ambiguousKey}
                  onChange={(checked) => setConfirmedKey(checked ? ambiguousKey : '')}
                  label={ambiguousText}
                  labelledBy={ambiguousId}
                />
                <span id={ambiguousId} onClick={() => setConfirmedKey(confirmedKey === ambiguousKey ? '' : ambiguousKey)}>{ambiguousText}</span>
              </div>
            )}

            {blockText && <p role="alert" className="text-sm text-destructive-text">{blockText}</p>}

            <p role="status" className="text-sm text-muted-foreground" data-testid="paste-summary">
              {t('budgetPaste.summary', '{{valid}} valid, {{invalid}} invalid. Valid total {{total}}. Invalid rows are not saved.', {
                valid: preview.validCount, invalid: preview.invalidCount, total: formatTotal(preview.totalCents, currency),
              })}
            </p>

            {preview.rows.length > 0 && preview.rows.length <= 500 && (
              <div tabIndex={0} role="region" aria-label={t('budgetPaste.previewLabel', 'Preview')} className="max-h-72 overflow-auto rounded-md border border-border">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr>
                      <th scope="col" className="px-2 py-1">{t('budgetPaste.col.row', 'Row')}</th>
                      <th scope="col" className="px-2 py-1">{fieldLabel.category}</th>
                      <th scope="col" className="px-2 py-1">{fieldLabel.description}</th>
                      <th scope="col" className="px-2 py-1 text-right tabular tabular-nums">{fieldLabel.amount}</th>
                      <th scope="col" className="px-2 py-1">{t('budgetPaste.col.status', 'Check')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.rowNumber} className="border-t border-border">
                        <td className="px-2 py-1">{row.rowNumber}</td>
                        <td className="px-2 py-1">{row.category ? budgetCategoryLabel(row.category, t) : row.raw.category}</td>
                        <td className="px-2 py-1">{row.description ?? ''}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{row.amount === null ? '' : formatCurrencyCents(Number(row.amount), currency)}</td>
                        <td className="px-2 py-1">
                          {row.errors.length === 0
                            ? t('budgetPaste.rowOk', 'OK')
                            : <span className="text-destructive-text">{row.errors.map(errorText).join(' ')}</span>}
                          {row.errors.length === 0 && ambiguousRowNumbers.has(row.rowNumber) && (
                            <span className="ml-2 font-medium text-warning-foreground" data-testid="paste-ambiguous-note">
                              {t('budgetPaste.ambiguousNote', 'Read as {{amount}}, not a decimal.', { amount: row.amount })}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        </>)}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{t('budgetPaste.target', 'Adding to {{version}} (Draft). Existing lines are kept.', { version: versionLabel })}</p>
    </EntityFormModal>
  );
};

export default BudgetPasteRowsDialog;
