import { stageAgeDays, stageDaysPastTargetDate } from '@/src/lib/billingStages';

/**
 * #2681 — the billing board: a pure view over the rows of `billing_board()` (migration 1370). No board data is stored. Columns are the
 * distinct current-step NAMES across the claims (each claim's list can differ), ordered by the median position of that name, then one
 * final "all steps done" column (docs/specs/billing-board.spec.md OD-BBD-1). Age and overdue come from the existing stage rules with the
 * server's calendar day, so every device shows the same figures.
 */

export interface BoardRow {
  claimId: string;
  projectId: string;
  projectName: string;
  workOrderId: string | null;
  woNumber: string | null;
  claimCreatedAt: string;
  stepCount: number;
  stepsDone: number;
  currentPosition: number | null;
  currentName: string | null;
  ownerRole: string | null;
  startedOn: string | null;
  lastCompletedOn: string | null;
  dueOn: string | null;
  allDone: boolean;
  today: string;
}

export interface BoardCard {
  claimId: string;
  projectId: string;
  projectName: string;
  woNumber: string | null;
  claimCreatedAt: string;
  stepsDone: number;
  stepCount: number;
  ownerRole: string | null;
  /** Days on the current step (all-done card: days since the last step completed); null before the step starts. */
  ageDays: number | null;
  /** Days past the current step's due date; null when not past it. */
  overdueDays: number | null;
}

export interface BoardColumn {
  /** Normalised step name; the all-done column uses the empty key. */
  key: string;
  /** The first-seen spelling; null for the all-done column. */
  name: string | null;
  allDone: boolean;
  cards: BoardCard[];
}

const normalise = (name: string) => name.trim().toLowerCase();

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function toCard(row: BoardRow): BoardCard {
  const ageDays = row.allDone
    ? stageAgeDays({ startedOn: row.lastCompletedOn, completedOn: null }, row.today)
    : stageAgeDays({ startedOn: row.startedOn, completedOn: null }, row.today);
  return {
    claimId: row.claimId,
    projectId: row.projectId,
    projectName: row.projectName,
    woNumber: row.woNumber,
    claimCreatedAt: row.claimCreatedAt,
    stepsDone: row.stepsDone,
    stepCount: row.stepCount,
    ownerRole: row.allDone ? null : row.ownerRole,
    ageDays,
    overdueDays: row.allDone ? null : stageDaysPastTargetDate({ completedOn: null, targetOn: row.dueOn }, row.today),
  };
}

/** Oldest first (a card with no start date last), then by project name. */
function byAge(a: BoardCard, b: BoardCard): number {
  if (a.ageDays !== b.ageDays) {
    if (a.ageDays === null) return 1;
    if (b.ageDays === null) return -1;
    return b.ageDays - a.ageDays;
  }
  return a.projectName.localeCompare(b.projectName);
}

export function groupBoard(rows: ReadonlyArray<BoardRow>): BoardColumn[] {
  const stepRows = new Map<string, { name: string; positions: number[]; cards: BoardCard[] }>();
  const doneCards: BoardCard[] = [];
  for (const row of rows) {
    if (row.allDone || !row.currentName) {
      doneCards.push(toCard(row));
      continue;
    }
    const key = normalise(row.currentName);
    const entry = stepRows.get(key) ?? { name: row.currentName.trim(), positions: [], cards: [] };
    if (row.currentPosition !== null) entry.positions.push(row.currentPosition);
    entry.cards.push(toCard(row));
    stepRows.set(key, entry);
  }
  const columns: BoardColumn[] = [...stepRows.entries()]
    .map(([key, e]) => ({ key, name: e.name, allDone: false, cards: e.cards.sort(byAge), at: e.positions.length ? median(e.positions) : Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .map(({ at: _at, ...c }) => c);
  if (doneCards.length) columns.push({ key: '', name: null, allDone: true, cards: doneCards.sort(byAge) });
  return columns;
}
