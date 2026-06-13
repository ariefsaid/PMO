import { useCallback, useMemo, useState } from 'react';
import {
  autoMap,
  parseWorkbook,
  rowToCells,
  validateRows,
  ImportParseError,
  type ImportDescriptor,
  type ImportResult,
  type Mapping,
  type ParsedSheet,
  type RowValidation,
} from '@/src/lib/import';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

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
  parseError: string | null;
  progress: CommitProgress;
  result: ImportResult | null;
  selectFile: (file: File) => Promise<void>;
  setFieldMapping: (fieldKey: string, headerIndex: number | null) => void;
  goPreview: () => void;
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
export function useImportWizard<Input>(descriptor: ImportDescriptor<Input>): UseImportWizard {
  const [step, setStep] = useState<WizardStep>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CommitProgress>({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);

  const validation = useMemo<RowValidation[]>(
    () => (parsed ? validateRows(parsed.rows, descriptor.fields, mapping) : []),
    [parsed, descriptor.fields, mapping],
  );

  const allRequiredMapped = useMemo(
    () => descriptor.fields.every((f) => !f.required || mapping[f.key] != null),
    [descriptor.fields, mapping],
  );

  const counts = useMemo(() => {
    const valid = validation.filter((v) => v.valid).length;
    return { valid, invalid: validation.length - valid, total: validation.length };
  }, [validation]);

  const reset = useCallback(() => {
    setStep('upload');
    setFileName(null);
    setParsed(null);
    setMapping({});
    setParseError(null);
    setProgress({ done: 0, total: 0 });
    setResult(null);
  }, []);

  const selectFile = useCallback(
    async (file: File) => {
      setParseError(null);
      try {
        const buf = await file.arrayBuffer();
        const sheet = await parseWorkbook(buf);
        setParsed(sheet);
        setFileName(file.name);
        setMapping(autoMap(sheet.headers, descriptor.fields));
        setStep('mapping');
      } catch (err) {
        // Typed parse rejections (bad/empty/oversized) surface their message; anything
        // else (unexpected) gets a generic note. NO writes happen on this path.
        setParsed(null);
        setFileName(null);
        setParseError(
          err instanceof ImportParseError ? err.message : 'Could not read that file. Use a valid .xlsx.',
        );
      }
    },
    [descriptor.fields],
  );

  const setFieldMapping = useCallback((fieldKey: string, headerIndex: number | null) => {
    setMapping((prev) => ({ ...prev, [fieldKey]: headerIndex }));
  }, []);

  const goPreview = useCallback(() => {
    if (!allRequiredMapped) return;
    setStep('preview');
  }, [allRequiredMapped]);

  const back = useCallback(() => {
    setStep((s) => (s === 'preview' ? 'mapping' : 'upload'));
  }, []);

  const commit = useCallback(async () => {
    if (!parsed) return;
    // Only VALID rows are sent — invalid rows were excluded at validate (dry-run oracle).
    const validRows = validation
      .filter((v) => v.valid)
      .map((v) => ({ index: v.index, cells: rowToCells(parsed.rows[v.index], descriptor.fields, mapping) }));

    setStep('committing');
    setProgress({ done: 0, total: validRows.length });

    let created = 0;
    const failed: ImportResult['failed'] = [];
    // Sequential, best-effort: a per-row rejection (e.g. 23505 duplicate, 42501 RLS) is
    // captured and the run continues. Nothing rolls back.
    for (let i = 0; i < validRows.length; i += 1) {
      const { index, cells } = validRows[i];
      try {
        await descriptor.create(descriptor.toInput(cells));
        created += 1;
      } catch (err) {
        const { headline } = classifyMutationError(err);
        failed.push({ index, reason: headline });
      }
      setProgress({ done: i + 1, total: validRows.length });
    }

    setResult({ created, failed });
    setStep('result');
  }, [parsed, validation, descriptor, mapping]);

  return {
    step,
    fileName,
    parsed,
    mapping,
    validation,
    allRequiredMapped,
    counts,
    parseError,
    progress,
    result,
    selectFile,
    setFieldMapping,
    goPreview,
    back,
    commit,
    reset,
  };
}
