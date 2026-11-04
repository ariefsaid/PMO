export interface BudgetProjectFiscalYearSpan {
  name: string;
  start: string;
  end: string;
}

export interface BudgetProjectDateBasis {
  start: string | null;
  end: string | null;
}

export type BudgetProjectFiscalCalendar =
  | { status: 'resolved'; project: { start: string; end: string | null }; years: BudgetProjectFiscalYearSpan[] }
  | { status: 'bad-project-dates'; project: BudgetProjectDateBasis }
  | { status: 'binding-unavailable'; project: BudgetProjectDateBasis }
  | { status: 'unavailable'; project: BudgetProjectDateBasis }
  | { status: 'unresolved'; project: BudgetProjectDateBasis };
