import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';
import type { TopProject } from '@/src/lib/db/dashboard';
import { projectRecordedSpent } from '@/src/lib/projectFinances';

/**
 * #2132: a dashboard project row states the same Spent as that project's Budget tab — the canonical budget
 * reading, in the project currency — never the dashboard read's own actual. A project the Budget tab cannot
 * state is unknown here too (the row then says spending is not linked), never a figure of its own.
 */
export function withRecordedSpend<Row extends TopProject>(rows: Row[], positions: Record<string, CanonicalBudgetReading> | undefined): Row[] {
  return rows.map((row) => {
    const spent = projectRecordedSpent(positions?.[row.id], row.currency);
    return { ...row, spent, actual_complete: spent !== null, actual_currency: row.currency };
  });
}
