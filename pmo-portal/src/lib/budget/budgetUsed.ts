import { idrPosition } from '@/src/lib/budget/idrPosition';
import { projectBudgetUsedPercent } from '@/src/lib/projectFinances';

export interface BudgetUsed {
  /** Whole percent, or null when it is unknown. */
  percent: number | null;
  /** True when budget and spending sit in different currencies and the figure went through the rupiah rate. */
  approximate: boolean;
  /** The text the header and the Budget tab card both show: "50%", "≈ 50%", or null when unknown. */
  value: string | null;
}

type Position = Parameters<typeof projectBudgetUsedPercent>[0];

/** Budget used from the project's position: exact in the project currency, approximate (rupiah at one rate) across currencies. */
export function budgetUsedFigure(position: Position, projectCurrency: string, idrRate: number | null): BudgetUsed {
  const unknown = { percent: null, approximate: false, value: null };
  if (!position) return unknown;
  const sameBasis = position.budgetCurrency === position.currency && position.currency === projectCurrency;
  if (sameBasis) {
    const percent = projectBudgetUsedPercent(position, projectCurrency);
    return { percent, approximate: false, value: percent === null ? null : `${percent}%` };
  }
  if (position.activeBudgetAmount == null || position.spent == null || !position.budgetCurrency || !position.currency) return unknown;
  const idr = idrPosition({
    budget: { amount: Number(position.activeBudgetAmount), currency: position.budgetCurrency },
    spent: { amount: Number(position.spent), currency: position.currency },
    committed: { amount: null, currency: projectCurrency },
  }, idrRate);
  const percent = idr.usedPercent;
  const approximate = idr.usedApproximate && percent !== null;
  return { percent, approximate, value: percent === null ? null : `${approximate ? '≈ ' : ''}${percent}%` };
}
