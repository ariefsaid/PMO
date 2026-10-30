/**
 * useProcurementCycleImport — FSM hook for the procurement-cycle bulk-import wizard (ADR-0035 M4).
 *
 * States: upload → mapping → preview → committing → result
 *
 * Seams kept isolated for testing:
 *   - parseWorkbook (exceljs boundary) — injectable / mockable
 *   - commitGroups (DB boundary) — injectable / mockable
 *
 * Zero writes on upload/mapping/preview. The single explicit write is `commit()`.
 */
import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  parseWorkbook,
  ImportParseError,
  MAX_IMPORT_ROWS,
  type ParsedSheet,
  type RefLookup,
} from '@/src/lib/import';
import { groupRows } from '@/src/lib/import/procurementCycle/group';
import { validateGroups } from '@/src/lib/import/procurementCycle/validate';
import { commitGroups } from '@/src/lib/import/procurementCycle/commit';
import { buildDryRunConflictReport, type DryRunConflictReport } from '@/src/lib/import/procurementCycle/dryRunConflictReport';
import { supabaseImportSkipLookup, startProcurementImportRun } from '@/src/lib/db/procurementImportSkip';
import type {
  CycleRow,
  ValidatedGroup,
  CommitResult,
  ImportRunIdentity,
} from '@/src/lib/import/procurementCycle/types';

export type CycleWizardStep = 'upload' | 'mapping' | 'preview' | 'committing' | 'result';

/** The fixed 12-column contract for the procurement-cycle sheet. */
export interface CycleField {
  key: keyof CycleRow & string;
  label: string;
  required: boolean;
}

export const CYCLE_FIELDS: CycleField[] = [
  { key: 'caseRef', label: 'case_ref', required: true },
  { key: 'type', label: 'type', required: true },
  { key: 'project', label: 'project', required: false },
  { key: 'title', label: 'title', required: false },
  { key: 'caseStatus', label: 'case_status', required: false },
  { key: 'vendor', label: 'vendor', required: false },
  { key: 'externalRef', label: 'external_ref', required: false },
  { key: 'status', label: 'status', required: false },
  { key: 'date', label: 'date', required: false },
  { key: 'amount', label: 'amount', required: false },
  // #505: VI-row columns. `required: false` is about the MAPPING step (a sheet with no VI rows
  // needs neither column); a VI ROW missing either is INVALID at preview — validate.ts owns that.
  { key: 'taxTreatment', label: 'tax_treatment', required: false },
  { key: 'taxAmount', label: 'tax_amount', required: false },
];

/** field.key → header column index (null = unmapped). */
export type CycleMapping = Partial<Record<keyof CycleRow, number | null>>;

/** Summary counts for the preview step. */
export interface CycleCounts {
  totalCases: number;
  validCases: number;
  totalRecords: number;
  validRecords: number;
  skippedRecords: number;
}

/** Committing progress — how many cases have been created so far. */
export interface CycleProgress {
  done: number;
  total: number;
}

export interface UseProcurementCycleImport {
  step: CycleWizardStep;
  fileName: string | null;
  parsed: ParsedSheet | null;
  mapping: CycleMapping;
  /** Whether case_ref + type are both mapped (gates Next on mapping step). */
  allRequiredMapped: boolean;
  parseError: string | null;
  parsing: boolean;
  validatedGroups: ValidatedGroup[];
  counts: CycleCounts;
  result: CommitResult | null;
  /** Committing step progress. null outside of the committing step. */
  progress: CycleProgress | null;
  /** Provisional until the server registers the confirmed import. */
  runIdentity: ImportRunIdentity;
  /** Zero-write would-create/would-skip/would-collide tally (FR-IDEM-007). null until the
   *  preview step's async dry-run probe resolves. */
  conflictReport: DryRunConflictReport | null;
  selectFile: (file: File) => Promise<void>;
  setFieldMapping: (fieldKey: keyof CycleRow, headerIndex: number | null) => void;
  goPreview: () => Promise<void>;
  back: () => void;
  commit: () => Promise<void>;
  reset: () => void;
}

/** Auto-map column headers to the fixed cycle field labels (case/whitespace-insensitive). */
function autoMapCycle(headers: string[]): CycleMapping {
  const mapping: CycleMapping = {};
  for (const field of CYCLE_FIELDS) {
    const needle = field.label.toLowerCase().replace(/[\s_-]/g, '');
    const idx = headers.findIndex(
      (h) => h.toLowerCase().replace(/[\s_-]/g, '') === needle,
    );
    if (idx >= 0) {
      mapping[field.key as keyof CycleRow] = idx;
    }
  }
  return mapping;
}

/** Extract a CycleRow from a raw string[] using the current mapping. */
function rowToCycleRow(
  cells: string[],
  mapping: CycleMapping,
  rowNumber: number,
): CycleRow {
  function cell(key: keyof CycleRow): string | undefined {
    const idx = mapping[key];
    if (idx == null || idx < 0) return undefined;
    const val = cells[idx]?.trim();
    return val || undefined;
  }

  return {
    caseRef: cell('caseRef'),
    type: cell('type') ?? '',
    project: cell('project'),
    title: cell('title'),
    caseStatus: cell('caseStatus'),
    vendor: cell('vendor'),
    externalRef: cell('externalRef'),
    status: cell('status'),
    date: cell('date'),
    amount: cell('amount'),
    taxTreatment: cell('taxTreatment'),
    taxAmount: cell('taxAmount'),
    rowNumber,
  };
}

/** Build CycleRow[] from parsed rows + mapping (rowNumber is 1-based sheet row: data starts at row 2). */
function buildCycleRows(rows: string[][], mapping: CycleMapping): CycleRow[] {
  return rows.map((cells, i) => rowToCycleRow(cells, mapping, i + 2));
}

const EMPTY_COUNTS: CycleCounts = {
  totalCases: 0,
  validCases: 0,
  totalRecords: 0,
  validRecords: 0,
  skippedRecords: 0,
};

export function useProcurementCycleImport(
  projectLookup: RefLookup,
  vendorLookup: RefLookup,
  requestedById: string,
): UseProcurementCycleImport {
  const [step, setStep] = useState<CycleWizardStep>('upload');
  const stepRef = useRef(step);
  stepRef.current = step;
  const sessionGeneration = useRef(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMappingState] = useState<CycleMapping>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const parseGeneration = useRef(0);
  useEffect(() => () => { parseGeneration.current++; }, []);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [progress, setProgress] = useState<CycleProgress | null>(null);
  /** A server-issued run is retained for retries within this wizard session. */
  const [runId, setRunId] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const runIdentity = useMemo<ImportRunIdentity>(() => runId ? { kind: 'registered', id: runId } : { kind: 'provisional' }, [runId]);
  const [conflictReport, setConflictReport] = useState<DryRunConflictReport | null>(null);
  const previewGeneration = useRef(0);
  const approvedPreview = useRef<number | null>(null);
  const committing = useRef(false);
  const invalidatePreview = useCallback(() => {
    previewGeneration.current++;
    approvedPreview.current = null;
    setConflictReport(null);
  }, []);

  const allRequiredMapped = useMemo(
    () =>
      CYCLE_FIELDS.filter((f) => f.required).every(
        (f) => mapping[f.key as keyof CycleRow] != null,
      ),
    [mapping],
  );

  /** Build the validated groups (pure computation over parsed + mapping). */
  const validatedGroups = useMemo<ValidatedGroup[]>(() => {
    if (!parsed) return [];
    const cycleRows = buildCycleRows(parsed.rows, mapping);
    const { groups } = groupRows(cycleRows);
    return validateGroups(groups, { projectLookup, vendorLookup });
  }, [parsed, mapping, projectLookup, vendorLookup]);

  useEffect(() => {
    invalidatePreview();
    if (stepRef.current === 'preview') setParseError('References changed. Retry preview before importing.');
  }, [validatedGroups, invalidatePreview]);

  const counts = useMemo<CycleCounts>(() => {
    if (validatedGroups.length === 0) return EMPTY_COUNTS;
    let totalRecords = 0;
    let validRecords = 0;
    let validCases = 0;
    for (const vg of validatedGroups) {
      if (vg.valid) validCases++;
      for (const row of vg.rows) {
        totalRecords++;
        if (vg.valid && row.valid) validRecords++;
      }
    }
    return {
      totalCases: validatedGroups.length,
      validCases,
      totalRecords,
      validRecords,
      skippedRecords: totalRecords - validRecords,
    };
  }, [validatedGroups]);

  const reset = useCallback(() => {
    sessionGeneration.current++;
    committing.current = false;
    parseGeneration.current++;
    setParsing(false);
    invalidatePreview();
    runIdRef.current = null;
    setRunId(null);
    setStep('upload');
    setFileName(null);
    setParsed(null);
    setMappingState({});
    setParseError(null);
    setResult(null);
    setProgress(null);
    setConflictReport(null);
  }, [invalidatePreview]);

  const selectFile = useCallback(async (file: File) => {
    sessionGeneration.current++;
    committing.current = false;
    runIdRef.current = null;
    setRunId(null);
    invalidatePreview();
    const generation = ++parseGeneration.current;
    setParsing(true);
    setParseError(null);
    try {
      const buf = await file.arrayBuffer();
      if (generation !== parseGeneration.current) return;
      const sheet = await parseWorkbook(buf);
      if (generation !== parseGeneration.current) return;
      setParsed(sheet);
      setFileName(file.name);
      setMappingState(autoMapCycle(sheet.headers));
      setStep('mapping');
    } catch (err) {
      if (generation !== parseGeneration.current) return;
      setParsed(null);
      setFileName(null);
      setParseError(
        err instanceof ImportParseError
          ? err.message
          : 'Could not read that file. Use a valid .xlsx.',
      );
    } finally {
      if (generation === parseGeneration.current) setParsing(false);
    }
  }, [invalidatePreview]);

  const setFieldMapping = useCallback(
    (fieldKey: keyof CycleRow, headerIndex: number | null) => {
      invalidatePreview();
      setMappingState((prev) => ({ ...prev, [fieldKey]: headerIndex }));
    },
    [invalidatePreview],
  );

  // ⚑ The dry-run report is fetched ASYNCHRONOUSLY and the user can leave the step (or the whole
  // wizard) before it lands. Without this guard the late `setConflictReport` runs against an
  // unmounted tree — harmless in a browser, but in jsdom it surfaces as an unhandled
  // `ReferenceError: window is not defined` that makes the WHOLE vitest run exit non-zero while
  // every test passes. It only appears under full-suite timing, never in isolation, which is the
  // worst shape a flake can have: green when you go looking for it.
  // ⚑ The body MUST re-set `true`. StrictMode (index.tsx) runs effect → cleanup → effect, so a
  // cleanup-only guard leaves the ref FALSE while mounted and silently drops every late result in
  // dev. That is a worse bug than the one being fixed, and it is invisible in production.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    const session = sessionGeneration;
    return () => { aliveRef.current = false; session.current++; };
  }, []);

  const goPreview = useCallback(async () => {
    if (!allRequiredMapped) return;
    invalidatePreview();
    const generation = previewGeneration.current;
    setParseError(null);
    setStep('preview');
    const validGroups = validatedGroups.filter((g) => g.valid);
    try {
      const report = await buildDryRunConflictReport(validGroups, {
        identity: runIdentity, skipLookup: supabaseImportSkipLookup, vendorLookup,
      });
      if (!aliveRef.current || generation !== previewGeneration.current) return;
      approvedPreview.current = generation;
      setConflictReport(report);
    } catch {
      if (aliveRef.current && generation === previewGeneration.current) setParseError('Preview could not be completed. Retry before importing.');
    }
  }, [allRequiredMapped, validatedGroups, runIdentity, vendorLookup, invalidatePreview]);

  const back = useCallback(() => {
    parseGeneration.current++;
    setParsing(false);
    invalidatePreview();
    setStep((s) => (s === 'preview' ? 'mapping' : 'upload'));
  }, [invalidatePreview]);

  const commit = useCallback(async () => {
    const validGroups = validatedGroups.filter((g) => g.valid);
    if (!validGroups.some(group => group.rows.some(row => row.valid)) || approvedPreview.current !== previewGeneration.current || committing.current) return;
    const generation = previewGeneration.current;
    const session = sessionGeneration.current;
    committing.current = true;

    setStep('committing');
    setProgress({ done: 0, total: validGroups.length });

    try {
      const actualRunId = runIdRef.current ?? await startProcurementImportRun();
      if (!aliveRef.current || session !== sessionGeneration.current) return;
      runIdRef.current = actualRunId;
      setRunId(actualRunId);
      if (generation !== previewGeneration.current) {
        setProgress(null);
        setParseError('References changed. Retry preview before importing.');
        setStep('preview');
        return;
      }
      const commitResult = await commitGroups(validGroups, {
        requestedById,
        projectLookup,
        vendorLookup,
        importBatchId: actualRunId,
        skipLookup: supabaseImportSkipLookup,
      });

      if (!aliveRef.current || session !== sessionGeneration.current) return;
      setProgress(null);
      setResult(commitResult);
      setStep('result');
    } catch {
      if (!aliveRef.current || session !== sessionGeneration.current) return;
      setProgress(null);
      setParseError('Import could not start or finish. Retry after reviewing the preview.');
      invalidatePreview();
      setStep('preview');
    } finally {
      if (session === sessionGeneration.current) committing.current = false;
    }
  }, [invalidatePreview, validatedGroups, requestedById, projectLookup, vendorLookup]);

  return {
    step,
    fileName,
    parsed,
    mapping,
    allRequiredMapped,
    parseError,
    parsing,
    validatedGroups,
    counts,
    result,
    progress,
    runIdentity,
    conflictReport,
    selectFile,
    setFieldMapping,
    goPreview,
    back,
    commit,
    reset,
  };
}

// Re-export MAX_IMPORT_ROWS so the wizard UI can use it without a separate import
export { MAX_IMPORT_ROWS };
