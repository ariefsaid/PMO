/** Project money collection read contract. */
import type { CanonicalBudgetReading, ProjectMoneyRead } from '@/src/lib/db/projectMoney';

export interface ProjectMoneyRepository {
  /** Money facts for a set of visible projects, keyed by project id (one RPC; callers chunk). */
  collection(ids: string[]): Promise<Record<string, ProjectMoneyRead>>;
  /** Canonical all-project budget consumption facts, keyed by project id, from one set-based RPC. */
  budgetPositions(ids: string[]): Promise<Record<string, CanonicalBudgetReading>>;
}
