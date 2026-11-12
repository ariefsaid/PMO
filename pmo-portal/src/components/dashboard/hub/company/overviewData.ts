import { formatTileMoney } from '@/src/lib/format';
import type { TopProject } from '@/src/lib/db/dashboard';
import type { BarRow, ChartTone } from '@/src/components/dashboard/charts';
import { planVsActualRows } from './planVsActual';

/** Budget against spending per project, worst first (largest share of budget used). Unknown spending has no second bar. */
export function budgetVsSpentRows(projects: TopProject[], currency: string): BarRow[] {
  const money = (amount: number) => formatTileMoney(amount, currency) ?? '';
  const candidates = planVsActualRows(projects, currency).filter((row) => row.budget !== null);
  const ratio = (row: (typeof candidates)[number]) => (row.actual === null ? -1 : row.actual / (row.budget as number));
  return [...candidates].sort((a, b) => ratio(b) - ratio(a)).slice(0, 6).map((row) => ({
    id: row.id,
    name: row.name,
    value: row.budget,
    label: money(row.budget as number),
    tone: 'neutral' as const,
    value2: row.actual,
    label2: row.actual === null ? undefined : money(row.actual),
    tone2: (row.actual !== null && row.actual > (row.budget as number) ? 'bad' : 'accent') as ChartTone,
  }));
}
