import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkTemplateMarker } from '@/src/lib/import/templateVersion';
import {
  autoMap,
  parseWorkbook,
  parseSecondSheet,
  parsePastedRows,
  rowToCells,
  validateRows,
  applyMatches,
  ImportParseError,
  IMPORT_SKIPPED,
  type ImportDescriptor,
  type ImportField,
  type ImportResult,
  type Mapping,
  type ParsedSheet,
  type RowValidation,
} from '@/src/lib/import';
import { classifyMutationError, trackBatchSaveFailed } from '@/src/lib/classifyMutationError';
import type { AnalyticsModule, FrictionClass } from '@/src/lib/classifyMutationError';

export type WizardStep = 'upload' | 'mapping' | 'preview' | 'committing' | 'result';

/** Progress while committing: how many of the valid rows have been attempted. */
export interface CommitProgress {
  done: number;
  total: number;
}

export interface UseImportWizard {
  step: WizardStep;
  fileName: string | null;
  parsed: ParsedSheet | null;
  mapping: Mapping;
  /** Per-data-row validation (the dry-run oracle). */
  validation: RowValidation[];
  /** Whether every required field is mapped (gates Next on the mapping step). */
  allRequiredMapped: boolean;
  /** Counts for the preview summary. */
  counts: { valid: number; invalid: number; total: number };
  /** Rows otherwise valid whose key is already on the target (`existingKeys`); not in `valid`, not in `invalid`. */
  alreadyCount: number;
  /** With `matchExisting`: rows that add a record and rows that change one (the confirm's two verbs). */
  matchCounts: { added: number; updated: number };
  /** The `existingKeys` / `matchExisting` read: 'none' when the descriptor has neither; 'failed' leaves the backstop to decide for `existingKeys`, and refuses the confirm for `matchExisting`. */
  existingStatus: 'none' | 'loading' | 'ready' | 'failed';
  parseError: string | null;
  parsing: boolean;
  progress: CommitProgress;
  result: ImportResult | null;
  selectFile: (file: File) => Promise<void>;
  /** Rows pasted from a spreadsheet: the same parse → map → validate path as an upload. */
  selectPaste: (text: string) => void;
  setFieldMapping: (fieldKey: string, headerIndex: number | null) => void;
  goPreview: () => void;
  /** Read the existing records again after a failed read. */
  retryExisting: () => void;
  back: () => void;
  commit: () => Promise<void>;
  reset: () => void;
}

/**
 * The import wizard's finite state machine (ADR-0027). Holds the descriptor-driven parse →
 * auto-map → validate (dry-run, ZERO writes) → commit (one explicit action, per-row
 * best-effort) flow. The commit iterates the VALID rows sequentially (not Promise.all — a
 * gentle, honest progress), try/catching each so a per-row failure never aborts the run.
 */
/** True when the sheet is exactly the template: every field's header is the template's own column name (its label, not an old name
 *  or an alias) and no column is left over. Such a file has nothing to match, so the wizard goes straight to the preview (the
 *  person can still go Back to the matching). */

/** The fields a person's file supplies: `internal` ones are filled by the wizard (the folded second sheet). */
const userFields = <Input,>(fields: ImportField<Input>[]) => fields.filter((f) => !f.internal);

/**
 * Fold the file's second sheet onto its first-sheet rows (FR-WOI-002): each child row is matched to a parent row by the
 * descriptor's keys and stored, as JSON text of the child's cells, in the parent's internal column (appended after the
 * file's own columns). A child row naming no parent refuses the file with its sheet row, never dropped silently.
 */
export function foldExtraSheet<Input>(sheet: ParsedSheet, descriptor: ImportDescriptor<Input>, extra: { headers: string[]; rows: string[][] } | null): { sheet: ParsedSheet; scopeColumn: number } {
  const spec = descriptor.extraSheet;
  const scopeColumn = sheet.headers.length;
  if (!spec) return { sheet, scopeColumn };
  const parentMapping = autoMap(sheet.headers, userFields(descriptor.fields));
  const parentCol = parentMapping[spec.parentKey];
  const children = new Map<string, Record<string, string>[]>();
  if (extra) {
    const childMapping = autoMap(extra.headers, spec.fields as ImportField<unknown>[]);
    for (const f of spec.fields) {
      if (f.required && childMapping[f.key] == null) throw new ImportParseError('not_xlsx', spec.missingColumn(f.label));
    }
    const parents = new Set(parentCol == null ? [] : sheet.rows.map((r) => (r[parentCol] ?? '').trim().toLowerCase()).filter(Boolean));
    extra.rows.forEach((row, i) => {
      const cells = rowToCells(row, spec.fields as ImportField<unknown>[], childMapping);
      const key = (cells[spec.childKey] ?? '').trim().toLowerCase();
      if (!parents.has(key)) throw new ImportParseError('not_xlsx', spec.orphan(i + 2, (cells[spec.childKey] ?? '').trim()));
      children.set(key, [...(children.get(key) ?? []), { ...cells, __row: String(i + 2) }]);
    });
  }
  const rows = sheet.rows.map((r) => [...r, JSON.stringify(children.get((parentCol == null ? '' : (r[parentCol] ?? '')).trim().toLowerCase()) ?? [])]);
  return { sheet: { ...sheet, headers: [...sheet.headers, ''], rows }, scopeColumn };
}

export function isTemplateMatch<Input>(headers: string[], fields: ImportField<Input>[], mapping: Mapping): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();
  const used = fields.map((f) => mapping[f.key]);
  if (used.some((i) => i === null || i === undefined)) return false;
  if (new Set(used).size !== headers.length || headers.length !== fields.length) return false;
  return fields.every((f) => norm(headers[mapping[f.key] as number]) === norm(f.label));
}

export function useImportWizard<Input>(descriptor: ImportDescriptor<Input>): UseImportWizard {
  const [step, setStep] = useState<WizardStep>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const parseGeneration = useRef(0);
  // Its own counter: a parse starting or finishing never drops the existing-keys read, nor the read a parse.
  const existingGeneration = useRef(0);
  useEffect(() => () => { parseGeneration.current++; }, []);
  const [progress, setProgress] = useState<CommitProgress>({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);

  const existingKeys = descriptor.existingKeys;
  const matchExisting = descriptor.matchExisting;
  const [existing, setExisting] = useState<{ status: 'loading' | 'ready' | 'failed'; keys: ReadonlySet<string>; records: ReadonlyMap<string, unknown> } | null>(null);
  const existingStatus = existingKeys || matchExisting ? (existing?.status ?? 'loading') : 'none';

  const validation = useMemo<RowValidation[]>(() => {
    if (!parsed) return [];
    const rows = validateRows(parsed.rows, descriptor.fields, mapping, descriptor.validateRow, descriptor.validateSheet);
    if (matchExisting) {
      if (existing?.status !== 'ready') return rows;
      return applyMatches(rows, rows.map((v) => rowToCells(parsed.rows[v.index], descriptor.fields, mapping)), matchExisting, existing.records);
    }
    if (!existingKeys || !existing || existing.keys.size === 0) return rows;
    // A row that is otherwise valid but already on the target is not "valid": the import would skip it.
    return rows.map((v) =>
      v.valid && existing.keys.has(existingKeys.keyOf(rowToCells(parsed.rows[v.index], descriptor.fields, mapping)))
        ? { ...v, valid: false, already: true }
        : v,
    );
  }, [parsed, descriptor.fields, descriptor.validateRow, descriptor.validateSheet, mapping, existingKeys, matchExisting, existing]);

  const allRequiredMapped = useMemo(
    () => userFields(descriptor.fields).every((f) => !f.required || mapping[f.key] != null),
    [descriptor.fields, mapping],
  );

  const matchCounts = useMemo(() => ({
    added: validation.filter((v) => v.action === 'new').length,
    updated: validation.filter((v) => v.action === 'update').length,
  }), [validation]);
  const alreadyCount = useMemo(() => validation.filter((v) => v.already).length, [validation]);
  const counts = useMemo(() => {
    const valid = validation.filter((v) => v.valid).length;
    return { valid, invalid: validation.length - valid - alreadyCount, total: validation.length };
  }, [validation, alreadyCount]);

  const reset = useCallback(() => {
    parseGeneration.current++;
    setParsing(false);
    setStep('upload');
    setFileName(null);
    setParsed(null);
    setMapping({});
    setParseError(null);
    setProgress({ done: 0, total: 0 });
    setResult(null);
    existingGeneration.current++;
    setExisting(null);
  }, []);

  const loadExisting = useCallback(() => {
    if (!existingKeys && !matchExisting) return;
    // Read once per opening of the preview; a failed `existingKeys` read leaves the insert-time skip to decide, never blocks.
    // A failed `matchExisting` read refuses the confirm: an update cannot be previewed blind.
    const generation = ++existingGeneration.current;
    setExisting(null);
    const none: ReadonlyMap<string, unknown> = new Map();
    const read = matchExisting
      ? matchExisting.load().then((entries) => { const records = new Map(entries); return { keys: new Set(records.keys()), records }; })
      : existingKeys!.load().then((keys) => ({ keys: new Set(keys), records: none }));
    void read.then(
      (r) => { if (generation === existingGeneration.current) setExisting({ status: 'ready', ...r }); },
      () => { if (generation === existingGeneration.current) setExisting({ status: 'failed', keys: new Set(), records: none }); },
    );
  }, [existingKeys, matchExisting]);

  const openPreview = useCallback(() => {
    setStep('preview');
    loadExisting();
  }, [loadExisting]);

  /** One path for upload and paste: match columns on the file's own fields, fold the second sheet in, then preview or map. */
  const acceptSheet = useCallback((sheet: ParsedSheet, extra: { headers: string[]; rows: string[][] } | null) => {
    const own = userFields(descriptor.fields);
    const mapped = autoMap(sheet.headers, own);
    const exact = isTemplateMatch(sheet.headers, own, mapped);
    const folded = foldExtraSheet(sheet, descriptor, extra);
    if (descriptor.extraSheet) mapped[descriptor.extraSheet.target] = folded.scopeColumn;
    setParsed(folded.sheet);
    setMapping(mapped);
    if (exact) openPreview();
    else setStep('mapping');
  }, [descriptor, openPreview]);

  const selectFile = useCallback(
    async (file: File) => {
      const generation = ++parseGeneration.current;
      setParsing(true);
      setParseError(null);
      try {
        const buf = await file.arrayBuffer();
        if (generation !== parseGeneration.current) return;
        const sheet = await parseWorkbook(buf, descriptor.maxRows);
        if (generation !== parseGeneration.current) return;
        if (checkTemplateMarker(descriptor, sheet.templateMarker) === 'outOfDate') {
          throw new ImportParseError('not_xlsx', 'This template is out of date. Download a new template and copy your rows into it.');
        }
        const extra = descriptor.extraSheet ? await parseSecondSheet(buf) : null;
        if (generation !== parseGeneration.current) return;
        acceptSheet(sheet, extra);
        setFileName(file.name);
      } catch (err) {
        if (generation !== parseGeneration.current) return;
        // Typed parse rejections (bad/empty/oversized) surface their message; anything
        // else (unexpected) gets a generic note. NO writes happen on this path.
        setParsed(null);
        setFileName(null);
        setParseError(
          err instanceof ImportParseError ? err.message : 'Could not read that file. Use a valid .xlsx.',
        );
      } finally {
        if (generation === parseGeneration.current) setParsing(false);
      }
    },
    [descriptor, acceptSheet],
  );

  const selectPaste = useCallback(
    (text: string) => {
      parseGeneration.current++;
      setParseError(null);
      try {
        const sheet = parsePastedRows(text, descriptor.maxRows);
        acceptSheet(sheet, null);
        setFileName(null);
      } catch (err) {
        setParsed(null);
        setParseError(err instanceof ImportParseError ? err.message : 'Could not read the pasted rows.');
      }
    },
    [descriptor.maxRows, acceptSheet],
  );

  const setFieldMapping = useCallback((fieldKey: string, headerIndex: number | null) => {
    setMapping((prev) => ({ ...prev, [fieldKey]: headerIndex }));
  }, []);

  const goPreview = useCallback(() => {
    if (!allRequiredMapped) return;
    openPreview();
  }, [allRequiredMapped, openPreview]);

  const back = useCallback(() => {
    parseGeneration.current++;
    setParsing(false);
    setStep((s) => (s === 'preview' ? 'mapping' : 'upload'));
  }, []);

  const commit = useCallback(async () => {
    if (!parsed) return;
    // Only VALID rows are sent — invalid rows were excluded at validate (dry-run oracle).
    // An update cannot be previewed, so not confirmed, without the records it would change.
    if (matchExisting && existing?.status !== 'ready') return;
    const validRows = validation
      .filter((v) => v.valid)
      .map((v) => ({ index: v.index, action: v.action, cells: rowToCells(parsed.rows[v.index], descriptor.fields, mapping) }));

    const whole = descriptor.allOrNothing;
    // All or nothing: a single row that is not valid (or already there) refuses the whole file; nothing is sent.
    if (whole && (counts.invalid > 0 || alreadyCount > 0 || validRows.length === 0)) return;

    setStep('committing');
    setProgress({ done: 0, total: validRows.length });

    if (whole) {
      try {
        await whole.createAll(validRows.map((r) => descriptor.toInput(r.cells)));
        setProgress({ done: validRows.length, total: validRows.length });
        setResult({ created: validRows.length, updated: 0, skipped: 0, skippedIndexes: [], failed: [] });
      } catch (err) {
        const { headline, detail, classification } = classifyMutationError(err, undefined, { suppressCapture: true });
        trackBatchSaveFailed(descriptor.entity.toLowerCase() as AnalyticsModule, { [classification]: validRows.length });
        // The database names the row it refused ("IMPORT_ROW 3: …"); nothing was saved, so every row is reported as not created.
        const why = [classification === 'unclassified' ? '' : headline, detail && detail !== headline ? detail : ''].filter(Boolean).join(' ');
        setResult({ created: 0, updated: 0, skipped: 0, skippedIndexes: [], failed: validRows.map((r) => ({ index: r.index, reason: why })) });
      }
      setStep('result');
      return;
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const skippedIndexes: number[] = [];
    const failed: ImportResult['failed'] = [];
    // SECURITY (2026-07-27 review round 2 #2, revised per code-quality review #2):
    // `suppressCapture: true` on every per-row call — a 10k-row import failing wholesale must NOT
    // multiply one click into ~10k events (PostHog's free-allowance overage DISCARDS
    // PERMANENTLY). Tally PER CLASSIFICATION (not a single lump count) so `trackBatchSaveFailed`
    // below can preserve the reason distribution (RLS vs duplicates stays answerable) while still
    // firing at most 7 events for the whole run.
    const classificationCounts: Partial<Record<FrictionClass, number>> = {};
    // Sequential, best-effort: a per-row rejection (e.g. 23505 duplicate, 42501 RLS) is
    // captured and the run continues. Nothing rolls back.
    for (let i = 0; i < validRows.length; i += 1) {
      const { index, cells, action } = validRows[i];
      try {
        if (matchExisting && action === 'update') {
          await matchExisting.update(existing!.records.get(matchExisting.keyOf(cells)), cells);
          updated += 1;
        } else {
          // DD-BIMP-8: a descriptor signals "already imported, wrote nothing" with the sentinel.
          // Counting it as created would make an idempotent re-run report rows it did not write.
          const outcome = await descriptor.create(descriptor.toInput(cells));
          if (outcome === IMPORT_SKIPPED) {
            skipped += 1;
            skippedIndexes.push(index);
          } else created += 1;
        }
      } catch (err) {
        const { headline, detail, classification } = classifyMutationError(err, undefined, { suppressCapture: true });
        classificationCounts[classification] = (classificationCounts[classification] ?? 0) + 1;
        // The reason only: the result list puts its own "Not created" headline before it, in the reader's language.
        // The generic "Update failed" headline of an unclassified error says nothing an import needs, so it is dropped.
        const why = [classification === 'unclassified' ? '' : headline, detail && detail !== headline ? detail : ''].filter(Boolean).join(' ');
        failed.push({ index, reason: why });
      }
      setProgress({ done: i + 1, total: validRows.length });
    }
    trackBatchSaveFailed(descriptor.entity.toLowerCase() as AnalyticsModule, classificationCounts);

    setResult({ created, updated, skipped, skippedIndexes, failed });
    setStep('result');
  }, [parsed, validation, descriptor, mapping, matchExisting, existing, counts, alreadyCount]);

  return {
    step,
    fileName,
    parsed,
    mapping,
    validation,
    allRequiredMapped,
    counts,
    alreadyCount,
    matchCounts,
    existingStatus,
    parseError,
    parsing,
    progress,
    result,
    selectFile,
    selectPaste,
    setFieldMapping,
    goPreview,
    retryExisting: loadExisting,
    back,
    commit,
    reset,
  };
}
