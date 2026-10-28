export type ProcurementMoneyKind = 'requested' | 'ordered' | 'invoiced' | 'paid' | 'unpaid';

export interface MoneyFigure {
  amount: number | null;
  unknown: boolean;
}

type AmountRow = { amount: number | string | null };
type ErpMoneyRow = {
  doctype: string;
  grand_total: number | string | null;
  outstanding_amount: number | string | null;
};

export interface ProcurementMoneyInput {
  total_value?: number | string | null;
  purchase_requests?: readonly AmountRow[] | null;
  purchase_orders?: readonly AmountRow[] | null;
  procurement_invoices?: readonly (AmountRow & { erp_outstanding_amount?: number | string | null })[] | null;
  payments?: readonly (AmountRow & { status: string })[] | null;
  erpDocuments?: readonly ErpMoneyRow[] | null;
}

export interface ProcurementMoneyResult {
  requested: MoneyFigure;
  ordered: MoneyFigure;
  invoiced: MoneyFigure;
  paid: MoneyFigure;
  unpaid: MoneyFigure;
  mostReal: { kind: Exclude<ProcurementMoneyKind, 'unpaid'>; amount: number } | null;
  unknown: Set<ProcurementMoneyKind>;
}

const numeric = (value: number | string | null | undefined): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function sumRows(rows: readonly AmountRow[]): MoneyFigure {
  let total = 0;
  for (const row of rows) {
    const amount = numeric(row.amount);
    if (amount === null) return { amount: null, unknown: true };
    total += amount;
  }
  return { amount: total, unknown: false };
}

function sumCombined(rows: readonly (AmountRow | { grand_total: number | string | null })[]): MoneyFigure {
  let total = 0;
  for (const row of rows) {
    const amount = numeric('amount' in row ? row.amount : row.grand_total);
    if (amount === null) return { amount: null, unknown: true };
    total += amount;
  }
  return { amount: total, unknown: false };
}

/** One honest money basis for the list and detail. ERP-linked documents never affect project actuals. */
export function procurementMoney(input: ProcurementMoneyInput): ProcurementMoneyResult {
  const requests = input.purchase_requests ?? [];
  const orders = input.purchase_orders ?? [];
  const invoices = input.procurement_invoices ?? [];
  const payments = input.payments ?? [];
  const erpDocs = input.erpDocuments ?? [];
  const erpOrders = erpDocs.filter((doc) => doc.doctype === 'Purchase Order');
  const erpInvoices = erpDocs.filter((doc) => doc.doctype === 'Purchase Invoice');
  const erpPayments = erpDocs.filter((doc) => doc.doctype === 'Payment Entry');

  const requested = requests.length > 0
    ? sumRows(requests)
    : (() => {
        const amount = numeric(input.total_value);
        return amount === null ? { amount: null, unknown: true } : { amount, unknown: false };
      })();
  const ordered = sumCombined([...orders, ...erpOrders]);
  const invoiced = sumCombined([...invoices, ...erpInvoices]);
  const paid = sumCombined([
    ...payments.filter((payment) => payment.status === 'Paid'),
    ...erpPayments,
  ]);

  const allInvoicesAreErp = invoices.length === 0 && erpInvoices.length > 0;
  const unpaid = allInvoicesAreErp
    ? (() => {
        let total = 0;
        for (const invoice of erpInvoices) {
          const outstanding = numeric(invoice.outstanding_amount);
          if (outstanding === null) return { amount: null, unknown: true };
          total += outstanding;
        }
        return { amount: Math.max(total, 0), unknown: false };
      })()
    : invoiced.unknown || paid.unknown
      ? { amount: null, unknown: true }
      : { amount: Math.max((invoiced.amount ?? 0) - (paid.amount ?? 0), 0), unknown: false };

  const unknown = new Set<ProcurementMoneyKind>();
  for (const [kind, figure] of Object.entries({ requested, ordered, invoiced, paid, unpaid }) as [ProcurementMoneyKind, MoneyFigure][]) {
    if (figure.unknown) unknown.add(kind);
  }

  const hasPaid = payments.some((payment) => payment.status === 'Paid') || erpPayments.length > 0;
  const candidates = [
    ...(hasPaid ? [['paid', paid] as const] : []),
    ...(invoices.length + erpInvoices.length > 0 ? [['invoiced', invoiced] as const] : []),
    ...(orders.length + erpOrders.length > 0 ? [['ordered', ordered] as const] : []),
    ['requested', requested] as const,
  ];
  const chosen = candidates.find(([, figure]) => !figure.unknown && figure.amount !== null);

  return {
    requested,
    ordered,
    invoiced,
    paid,
    unpaid,
    mostReal: chosen ? { kind: chosen[0], amount: chosen[1].amount as number } : null,
    unknown,
  };
}
