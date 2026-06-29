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
import { useCallback, useMemo, useState } from 'react';
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
import type {
  CycleRow,
  ValidatedGroup,
  CommitResult,
} from '@/src/lib/import/procurementCycle/types';

export type CycleWizardStep = 'upload' | 'mapping' | 'preview' | 'committing' | 'result';

/** The fixed 10-column contract for the procurement-cycle sheet. */
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
  validatedGroups: ValidatedGroup[];
  counts: CycleCounts;
  result: CommitResult | null;
  /** Committing step progress. null outside of the committing step. */
  progress: CycleProgress | null;
  /**
   * Global expand/collapse override: true = all expanded, false = all collapsed,
   * null = respect individual card state (default before any global toggle).
   */
  globalExpand: boolean | null;
  /** Expand all case cards. */
  expandAll: () => void;
  /** Collapse all case cards. */
  collapseAll: () => void;
  selectFile: (file: File) => Promise<void>;
  setFieldMapping: (fieldKey: keyof CycleRow, headerIndex: number | null) => void;
  goPreview: () => void;
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
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMappingState] = useState<CycleMapping>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [progress, setProgress] = useState<CycleProgress | null>(null);
  /** Controls whether all CaseCard accordions are open (true) or closed (false).
   *  null = per-card state (individual toggles), true/false = global override. */
  const [globalExpand, setGlobalExpand] = useState<boolean | null>(null);

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

  const counts = useMemo<CycleCounts>(() => {
    if (validatedGroups.length === 0) return EMPTY_COUNTS;
    let totalRecords = 0;
    let validRecords = 0;
    let validCases = 0;
    for (const vg of validatedGroups) {
      if (vg.valid) validCases++;
      for (const row of vg.rows) {
        totalRecords++;
        if (row.valid) validRecords++;
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
    setStep('upload');
    setFileName(null);
    setParsed(null);
    setMappingState({});
    setParseError(null);
    setResult(null);
    setProgress(null);
    setGlobalExpand(null);
  }, []);

  const expandAll = useCallback(() => setGlobalExpand(true), []);
  const collapseAll = useCallback(() => setGlobalExpand(false), []);

  const selectFile = useCallback(async (file: File) => {
    setParseError(null);
    try {
      const buf = await file.arrayBuffer();
      const sheet = await parseWorkbook(buf);
      setParsed(sheet);
      setFileName(file.name);
      setMappingState(autoMapCycle(sheet.headers));
      setStep('mapping');
    } catch (err) {
      setParsed(null);
      setFileName(null);
      setParseError(
        err instanceof ImportParseError
          ? err.message
          : 'Could not read that file. Use a valid .xlsx.',
      );
    }
  }, []);

  const setFieldMapping = useCallback(
    (fieldKey: keyof CycleRow, headerIndex: number | null) => {
      setMappingState((prev) => ({ ...prev, [fieldKey]: headerIndex }));
    },
    [],
  );

  const goPreview = useCallback(() => {
    if (!allRequiredMapped) return;
    setStep('preview');
  }, [allRequiredMapped]);

  const back = useCallback(() => {
    setStep((s) => (s === 'preview' ? 'mapping' : 'upload'));
  }, []);

  const commit = useCallback(async () => {
    const validGroups = validatedGroups.filter((g) => g.valid);
    if (validGroups.length === 0) return;

    setStep('committing');
    setProgress({ done: 0, total: validGroups.length });

    const commitResult = await commitGroups(validGroups, {
      requestedById,
      projectLookup,
      vendorLookup,
    });

    setProgress(null);
    setResult(commitResult);
    setStep('result');
  }, [validatedGroups, requestedById, projectLookup, vendorLookup]);

  return {
    step,
    fileName,
    parsed,
    mapping,
    allRequiredMapped,
    parseError,
    validatedGroups,
    counts,
    result,
    progress,
    globalExpand,
    expandAll,
    collapseAll,
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
