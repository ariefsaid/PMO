import React from 'react';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { usePayablesPosition } from '@/src/lib/finance/payablesPosition';
import { supplierUnpaid } from '@/src/lib/procurement/procurementMoney';
import type { BudgetReviewRow } from '@/src/lib/db/dashboard';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

/**
 * L12(a): a supplier invoice's unpaid amount, read the way Payables and the procurement record read it — through the
 * accounting-system documents linked to the procurement (`usePayablesPosition`), falling back to the PMO-recorded
 * figure. `null` = unknown (never 0).
 */
export function useSupplierUnpaid(enabled: boolean): (row: ProcurementWithRefs) => number | null {
  const finance = useFinancePosition(enabled, { withRoutes: true });
  const payables = usePayablesPosition(finance.position, enabled);
  const byId = React.useMemo(() => new Map(payables.payables.map((p) => [p.procurement.id, p.amount])), [payables.payables]);
  return React.useCallback((row: ProcurementWithRefs) => {
    if (byId.has(row.id)) { const amount = byId.get(row.id); return amount == null ? null : amount / 100; }
    const unpaid = supplierUnpaid(row);
    return unpaid.unknown ? null : unpaid.amount;
  }, [byId]);
}

/** Spending is shown only when it is complete and in the budget's currency (C4: otherwise the cell is left out). */
export const budgetSpendKnown = (row: BudgetReviewRow) => row.spent !== null && row.actual_complete && row.actual_currency === row.currency;
