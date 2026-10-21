// folderBudget.ts — the shared Graph deadline for one record-folder invocation (ADR-0089).
// One 15-second budget spans search, parent resolution and create (never a fresh 15s per call); each
// fetch is bounded by min(5s, remaining). No retries: a deadline is a failure, never an absence.

export const FOLDER_GRAPH_BUDGET_MS = 15_000;
export const FOLDER_GRAPH_FETCH_MS = 5_000;

export interface GraphBudget {
  /** Milliseconds left in the shared budget (never negative). */
  remaining(): number;
  /** Timeout for the NEXT Graph call, or null when the budget is spent (the call must not be made). */
  slice(): number | null;
}

export function createGraphBudget(
  totalMs: number = FOLDER_GRAPH_BUDGET_MS,
  clock: () => number = () => Date.now(),
): GraphBudget {
  const deadline = clock() + totalMs;
  const remaining = () => Math.max(0, deadline - clock());
  return {
    remaining,
    slice: () => {
      const left = remaining();
      return left <= 0 ? null : Math.min(FOLDER_GRAPH_FETCH_MS, left);
    },
  };
}
