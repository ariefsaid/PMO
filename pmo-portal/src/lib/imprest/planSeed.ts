import type { BudgetCategory, ImprestOpenRequestRow } from '@/src/lib/db/imprest';
import { sumDecimal } from '@/src/lib/exactDecimal';

/** One purpose with the amount the open requests add up to: what the plan editor starts from. */
export interface PlanSeedLine { category: BudgetCategory; amount: number }

export interface OpenRequest {
  id: string; prNumber: string | null; title: string; status: ImprestOpenRequestRow['status'];
  category: BudgetCategory | null; currency: string; total: number | null;
  workOrderId: string | null; workOrderLabel: string | null;
  lines: Array<{ id: string; name: string; quantity: number; amount: number | null }>;
}

/** The rows are one per request line (or one per request with no line): fold them to requests, in the order read. */
export function foldRequests(rows: ImprestOpenRequestRow[]): OpenRequest[] {
  const byId = new Map<string, OpenRequest>();
  for (const r of rows) {
    let req = byId.get(r.procurement_id);
    if (!req) {
      req = {
        id: r.procurement_id, prNumber: r.pr_number, title: r.title, status: r.status, category: r.budget_category, currency: r.currency,
        total: r.request_total ?? null, workOrderId: r.work_order_id,
        workOrderLabel: r.wo_number ? `${r.wo_number}${r.wo_title ? ` ${r.wo_title}` : ''}` : null, lines: [],
      };
      byId.set(r.procurement_id, req);
    }
    if (r.line_id) req.lines.push({ id: r.line_id, name: r.line_name, quantity: Number(r.line_quantity), amount: r.line_amount ?? null });
  }
  return [...byId.values()];
}

/**
 * The plan editor's starting lines: per purpose, the sum of the open requests in the float's own currency. A request with no
 * purpose, another currency or no visible price is left out and counted in `skipped` (the screen says so).
 */
export function seedFromRequests(requests: OpenRequest[], currency: string): { lines: PlanSeedLine[]; skipped: number } {
  const amounts = new Map<BudgetCategory, string[]>();
  let skipped = 0;
  for (const r of requests) {
    if (!r.category || r.currency !== currency || r.total === null) { skipped += 1; continue; }
    const group = amounts.get(r.category) ?? [];
    group.push(String(r.total));
    amounts.set(r.category, group);
  }
  const lines = [...amounts].map(([category, group]) => ({ category, amount: Number(sumDecimal(group, 2)) }))
    .filter(({ amount }) => amount > 0)
    .sort((a, b) => a.category.localeCompare(b.category));
  return { lines, skipped };
}
