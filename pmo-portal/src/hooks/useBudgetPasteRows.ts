import { useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { refreshBudgetQueries } from './useBudget';
import { parsePasteAmount, type PasteBudgetCategory } from '@/src/lib/budget/pasteRows';
import { Constants } from '@/src/lib/supabase/database.types';
import { repositories } from '@/src/lib/repositories';

export type BudgetPasteRowInput = Readonly<{
  rowNumber: number;
  category: PasteBudgetCategory;
  description: string | null;
  /** Canonical, exact-cent amount produced by the paste preview. */
  amount: string;
}>;

export type BudgetPasteRowStatus = 'pending' | 'created' | 'failed' | 'uncertain' | 'unsubmitted';

type SafeMutationError = Readonly<{
  headline: string;
  detail: string;
  classification: ReturnType<typeof classifyMutationError>['classification'];
}>;

export type BudgetPasteRowResult = BudgetPasteRowInput & Readonly<{
  projectId: string;
  targetId: string;
  status: BudgetPasteRowStatus;
  retryable: boolean;
  error?: SafeMutationError;
}>;

export type BudgetPasteBatchReceipt = Readonly<{
  projectId: string;
  targetId: string;
  results: readonly BudgetPasteRowResult[];
  /** A cache-read issue is separate from every row's write outcome. */
  refreshError: string | null;
}>;

type BudgetPasteRowsOptions = Readonly<{
  projectId: string;
  targetId: string;
  selectedId: string | null;
  isDraft: boolean;
  canCreate: boolean;
  canEdit: boolean;
}>;

type LiveContext = BudgetPasteRowsOptions & Readonly<{
  userId: string | null;
  orgId: string | undefined;
}>;

type BatchCapture = Readonly<{
  projectId: string;
  targetId: string;
  userId: string;
  orgId: string;
}>;

type SnapshotRow = BudgetPasteRowInput & Readonly<{ budgetedAmount: number }>;

type Progress = Readonly<{ completed: number; total: number }>;

const supportedCategories = new Set<string>(Constants.public.Enums.budget_category);

function freezeResults(results: readonly BudgetPasteRowResult[]): readonly BudgetPasteRowResult[] {
  return Object.freeze(results.map((result) => Object.freeze({
    ...result,
    ...(result.error ? { error: Object.freeze({ ...result.error }) } : {}),
  })));
}

function snapshotRows(rows: readonly BudgetPasteRowInput[]): Readonly<{
  rows: readonly SnapshotRow[] | null;
  error: string | null;
}> {
  if (rows.length === 0) return { rows: null, error: 'Add at least one valid row before saving.' };

  const rowNumbers = new Set<number>();
  const snapshot: SnapshotRow[] = [];
  for (const row of rows) {
    if (!Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1 || rowNumbers.has(row.rowNumber)) {
      return { rows: null, error: 'Source row numbers must be unique positive integers.' };
    }
    rowNumbers.add(row.rowNumber);
    if (!supportedCategories.has(row.category)) {
      return { rows: null, error: 'One or more rows have an unsupported budget category.' };
    }
    if (row.description !== null && typeof row.description !== 'string') {
      return { rows: null, error: 'One or more row descriptions are invalid.' };
    }

    const canonicalAmount = parsePasteAmount(row.amount);
    if (canonicalAmount === null || canonicalAmount !== row.amount) {
      return { rows: null, error: 'One or more rows have an invalid or non-canonical amount.' };
    }
    const budgetedAmount = Number(row.amount);
    if (!Number.isFinite(budgetedAmount) || parsePasteAmount(String(budgetedAmount)) !== row.amount) {
      return { rows: null, error: 'One or more amounts cannot be represented safely for saving.' };
    }

    snapshot.push(Object.freeze({
      rowNumber: row.rowNumber,
      category: row.category,
      description: row.description,
      amount: row.amount,
      budgetedAmount,
    }));
  }
  return { rows: Object.freeze(snapshot), error: null };
}

function isWritableTarget(context: LiveContext, capture: BatchCapture): boolean {
  return Boolean(
    context.projectId === capture.projectId
    && context.targetId === capture.targetId
    && context.selectedId === capture.targetId
    && context.userId === capture.userId
    && context.orgId === capture.orgId
    && context.isDraft
    && context.canCreate
    && context.canEdit,
  );
}

function readErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Build classifier input from stable codes only so backend messages cannot log pasted cell data. */
function classifySafeError(error: unknown): SafeMutationError {
  const code = readErrorCode(error);
  const message = code === '42501'
    ? 'permission denied for budget line'
    : code === 'P0001'
      ? 'The selected budget is no longer available for editing.'
      : code === '22003'
        ? 'The amount is outside the supported budget range.'
        : code === 'REQUEST_TIMEOUT'
          ? 'The save timed out before its result was confirmed.'
          : 'The save outcome could not be confirmed.';
  const safeError = Object.assign(new Error(message), code ? { code } : {});
  const classified = classifyMutationError(safeError, undefined, { suppressCapture: true });
  return Object.freeze({
    headline: classified.headline,
    detail: classified.detail,
    classification: classified.classification,
  });
}

function makePendingResult(row: SnapshotRow, capture: BatchCapture): BudgetPasteRowResult {
  return Object.freeze({
    rowNumber: row.rowNumber,
    category: row.category,
    description: row.description,
    amount: row.amount,
    projectId: capture.projectId,
    targetId: capture.targetId,
    status: 'pending',
    retryable: false,
  });
}

function makeReceipt(
  capture: BatchCapture,
  results: readonly BudgetPasteRowResult[],
  refreshError: string | null,
): BudgetPasteBatchReceipt {
  return Object.freeze({
    projectId: capture.projectId,
    targetId: capture.targetId,
    results: freezeResults(results),
    refreshError,
  });
}

/**
 * Sequential ordinary line inserts for an immutable, reviewed preview snapshot. The caller owns
 * the real-role permission booleans; they are checked from the latest render before every row.
 */
export function useBudgetPasteRows(options: BudgetPasteRowsOptions) {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const liveContext: LiveContext = {
    ...options,
    userId: currentUser?.id ?? null,
    orgId: currentUser?.org_id,
  };
  const latestContextRef = useRef(liveContext);
  latestContextRef.current = liveContext;

  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const batchCaptureRef = useRef<BatchCapture | null>(null);
  const savingRef = useRef(false);
  const [results, setResults] = useState<readonly BudgetPasteRowResult[]>([]);
  const resultsRef = useRef<readonly BudgetPasteRowResult[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState<Progress>({ completed: 0, total: 0 });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshErrorRef = useRef<string | null>(null);

  function publishResults(next: readonly BudgetPasteRowResult[]) {
    const frozen = freezeResults(next);
    resultsRef.current = frozen;
    if (mountedRef.current) setResults(frozen);
  }

  function publishRefreshError(next: string | null) {
    refreshErrorRef.current = next;
    if (mountedRef.current) setRefreshError(next);
  }

  function updateRow(rowNumber: number, update: Partial<BudgetPasteRowResult>) {
    publishResults(resultsRef.current.map((result) => result.rowNumber === rowNumber
      ? { ...result, ...update }
      : result));
  }

  function markUnsubmitted(rows: readonly SnapshotRow[]) {
    const sourceRows = new Set(rows.map((row) => row.rowNumber));
    publishResults(resultsRef.current.map((result) =>
      sourceRows.has(result.rowNumber) && result.status === 'pending'
        ? { ...result, status: 'unsubmitted', retryable: false }
        : result));
  }

  async function runRows(
    rows: readonly SnapshotRow[],
    capture: BatchCapture,
    replaceResults: boolean,
  ): Promise<BudgetPasteBatchReceipt | null> {
    if (savingRef.current || !mountedRef.current) return null;
    savingRef.current = true;
    if (mountedRef.current) {
      setIsSaving(true);
      setValidationError(null);
      setProgress({ completed: 0, total: rows.length });
    }
    publishRefreshError(null);
    if (replaceResults) publishResults(rows.map((row) => makePendingResult(row, capture)));
    else {
      const retryRows = new Set(rows.map((row) => row.rowNumber));
      publishResults(resultsRef.current.map((result) => retryRows.has(result.rowNumber)
        ? { ...result, status: 'pending', retryable: false, error: undefined }
        : result));
    }

    let completed = 0;
    let needsRefresh = false;
    let attemptedRows = 0;
    try {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (!mountedRef.current || !isWritableTarget(latestContextRef.current, capture)) {
          markUnsubmitted(rows.slice(index));
          needsRefresh ||= attemptedRows > 0;
          break;
        }

        attemptedRows += 1;
        try {
          const saved = await repositories.budget.createLineItem(capture.targetId, {
            category: row.category,
            description: row.description,
            budgeted_amount: row.budgetedAmount,
          });
          if (!saved || typeof saved.id !== 'string' || saved.id.length === 0) {
            const error = classifySafeError(new Error('Repository response did not confirm a saved row.'));
            updateRow(row.rowNumber, { status: 'uncertain', retryable: false, error });
            completed += 1;
            if (mountedRef.current) setProgress({ completed, total: rows.length });
            needsRefresh = true;
            markUnsubmitted(rows.slice(index + 1));
            break;
          }

          updateRow(row.rowNumber, { status: 'created', retryable: false, error: undefined });
          completed += 1;
          if (mountedRef.current) setProgress({ completed, total: rows.length });
          needsRefresh = true;
        } catch (error) {
          const code = readErrorCode(error);
          const displayError = classifySafeError(error);
          completed += 1;
          if (mountedRef.current) setProgress({ completed, total: rows.length });
          if (code === '22003') {
            updateRow(row.rowNumber, { status: 'failed', retryable: true, error: displayError });
            continue;
          }

          if (code === '42501' || code === 'P0001') {
            updateRow(row.rowNumber, { status: 'failed', retryable: false, error: displayError });
          } else {
            updateRow(row.rowNumber, { status: 'uncertain', retryable: false, error: displayError });
          }
          needsRefresh = true;
          markUnsubmitted(rows.slice(index + 1));
          break;
        }
      }

      if (needsRefresh) {
        try {
          await refreshBudgetQueries(queryClient, capture.orgId, capture.projectId);
        } catch {
          // A cache read failure cannot undo a server-confirmed write or turn it into a retry.
          publishRefreshError('The budget refresh did not finish. Reload the budget before relying on totals.');
        }
      }
      return makeReceipt(capture, resultsRef.current, refreshErrorRef.current);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }

  async function save(rows: readonly BudgetPasteRowInput[]): Promise<BudgetPasteBatchReceipt | null> {
    if (savingRef.current || !mountedRef.current) return null;
    if (resultsRef.current.some((result) => result.status !== 'created') || refreshErrorRef.current !== null) {
      setValidationError('Reconcile the current results or start a new paste session before saving again.');
      return null;
    }

    const snapshot = snapshotRows(rows);
    if (!snapshot.rows) {
      setValidationError(snapshot.error);
      return null;
    }

    const current = latestContextRef.current;
    if (!current.userId || !current.orgId || !current.targetId || !isWritableTarget(current, {
      projectId: current.projectId,
      targetId: current.targetId,
      userId: current.userId,
      orgId: current.orgId,
    })) {
      setValidationError('The selected budget is not an editable Draft. Review it before saving.');
      return null;
    }
    const capture = Object.freeze({
      projectId: current.projectId,
      targetId: current.targetId,
      userId: current.userId,
      orgId: current.orgId,
    });
    batchCaptureRef.current = capture;
    return runRows(snapshot.rows, capture, true);
  }

  async function retryFailed(): Promise<BudgetPasteBatchReceipt | null> {
    if (savingRef.current || !mountedRef.current) return null;
    const capture = batchCaptureRef.current;
    if (!capture) return null;
    if (!isWritableTarget(latestContextRef.current, capture)) {
      setValidationError('The original budget Draft is no longer selected or writable. Review it before retrying.');
      return null;
    }
    const retryRows = resultsRef.current
      .filter((result) => result.status === 'failed' && result.retryable)
      .map((result) => Object.freeze({
        rowNumber: result.rowNumber,
        category: result.category,
        description: result.description,
        amount: result.amount,
        budgetedAmount: Number(result.amount),
      }));
    if (retryRows.length === 0) return null;
    return runRows(Object.freeze(retryRows), capture, false);
  }

  function acknowledgeAndStartNewSession(): BudgetPasteBatchReceipt | null {
    if (savingRef.current || !mountedRef.current) return null;
    const capture = batchCaptureRef.current;
    if (!capture || resultsRef.current.length === 0) return null;

    const previousReceipt = makeReceipt(capture, resultsRef.current, refreshErrorRef.current);
    batchCaptureRef.current = null;
    publishResults([]);
    publishRefreshError(null);
    setProgress({ completed: 0, total: 0 });
    setValidationError(null);
    return previousReceipt;
  }

  return {
    save,
    retryFailed,
    acknowledgeAndStartNewSession,
    results,
    isSaving,
    progress,
    validationError,
    refreshError,
  } as const;
}
