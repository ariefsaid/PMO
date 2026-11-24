export interface ProjectPortfolioRow {
  id: string;
  name: string;
  spent: number | null;
  actualCurrency: string | null;
  budget: number | null;
  budgetCurrency: string | null;
  doneMilestones: number | null;
  totalMilestones: number | null;
  lateMilestones: number | null;
  plannedPct: number | null;
  actualPct: number | null;
}

export interface PortfolioSort {
  key: 'risk' | 'name' | 'spent' | 'budget' | 'doneMilestones' | 'lateMilestones' | 'plannedPct' | 'actualPct';
  dir: 'asc' | 'desc';
}

function risk(row: ProjectPortfolioRow): number | null {
  const signals: number[] = [];
  const comparableBudget = row.budget !== null && row.budget > 0
    && row.spent !== null && row.actualCurrency === row.budgetCurrency;
  if (comparableBudget) signals.push(Math.max(0, (row.spent! - row.budget!) / row.budget!));
  if (row.plannedPct !== null && row.actualPct !== null) signals.push(Math.max(0, row.plannedPct - row.actualPct) / 100);
  if (row.lateMilestones !== null && row.totalMilestones !== null && row.totalMilestones > 0) {
    signals.push(row.lateMilestones / row.totalMilestones);
  }
  return signals.length ? signals.reduce((sum, value) => sum + value, 0) / signals.length : null;
}

/** Unknown metrics sort last in either direction; the default combines only comparable budget and schedule signals. */
export function sortPortfolioRows(rows: ProjectPortfolioRow[], sort: PortfolioSort): ProjectPortfolioRow[] {
  const metric = (row: ProjectPortfolioRow): number | string | null => {
    if (sort.key === 'risk') return risk(row);
    if (sort.key === 'name') return row.name;
    return row[sort.key];
  };
  return [...rows].sort((a, b) => {
    const av = metric(a);
    const bv = metric(b);
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    if (av !== null && bv !== null) {
      const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : Number(av) - Number(bv);
      if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp;
    }
    return a.name.localeCompare(b.name);
  });
}
