/**
 * Display-only rupiah position for a budget whose figures sit in different currencies.
 * Every USD figure is converted at one rate; IDR figures stay as they are. The results are approximate and are
 * only ever shown; nothing stored, exported, approved or thresholded may read them.
 */
export interface PositionFigure {
  amount: number | null;
  currency: string;
}

export interface IdrPosition {
  budget: number | null;
  spent: number | null;
  committed: number | null;
  /** Whole percent, spent / budget. Null when either is unknown or the budget is not positive. */
  usedPercent: number | null;
  /** True when the percentage needed a conversion (budget and spending in different currencies). */
  usedApproximate: boolean;
  /** Budget minus spent minus open orders, whole rupiah. Null when any input is unknown. */
  left: number | null;
}

export function toIdr(figure: PositionFigure, rate: number | null): number | null {
  if (figure.amount === null || !Number.isFinite(figure.amount)) return null;
  if (figure.currency === 'IDR') return figure.amount;
  if (figure.currency === 'USD' && rate !== null && Number.isFinite(rate) && rate > 0) return figure.amount * rate;
  return null;
}

export function idrPosition(
  figures: { budget: PositionFigure; spent: PositionFigure; committed: PositionFigure },
  rate: number | null,
): IdrPosition {
  const budget = toIdr(figures.budget, rate);
  const spent = toIdr(figures.spent, rate);
  const committed = toIdr(figures.committed, rate);
  // Same currency on both sides: the ratio is exact and needs no rate.
  const sameCurrency = figures.budget.currency === figures.spent.currency;
  const [b, sp] = sameCurrency ? [figures.budget.amount, figures.spent.amount] : [budget, spent];
  const usedApproximate = !sameCurrency;
  const usedPercent = b !== null && sp !== null && Number.isFinite(b) && Number.isFinite(sp) && b > 0 ? Math.round((sp / b) * 100) : null;
  return {
    budget,
    spent,
    committed,
    usedPercent,
    usedApproximate,
    left: budget !== null && spent !== null && committed !== null ? Math.round(budget - spent - committed) : null,
  };
}
