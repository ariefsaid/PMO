/** Names and scope metadata used by the agreement manifest; this module owns no calculations. */
export type FigureIdentityId =
  | 'budget-used'
  | 'spent'
  | 'budget-left-after-open-orders'
  | 'contract-invoiced'
  | 'billed-work-cumulative'
  | 'billed-work-period'
  | 'contract-value'
  | 'contract-left-to-invoice'
  | 'invoice-documents';

export interface FigureIdentity {
  id: FigureIdentityId;
  family: 'budget' | 'invoiced';
  label: string;
  basis: string;
  period: string;
}

export const figureIdentities = {
  budgetUsed: {
    id: 'budget-used', family: 'budget', label: 'Budget used',
    basis: 'PMO paid spend plus open purchase commitment against Active budget', period: 'to date',
  },
  spent: {
    id: 'spent', family: 'budget', label: 'Spent',
    basis: 'PMO paid spend', period: 'to date',
  },
  budgetLeftAfterOpenOrders: {
    id: 'budget-left-after-open-orders', family: 'budget', label: 'Left after open orders',
    basis: 'Active budget less PMO paid spend and open purchase commitment', period: 'to date',
  },
  contractInvoiced: {
    id: 'contract-invoiced', family: 'invoiced', label: 'Invoiced against contract',
    basis: 'Contract-kind invoices on the recorded contract tax basis and currency', period: 'all history through the selected date',
  },
  billedWorkCumulative: {
    id: 'billed-work-cumulative', family: 'invoiced', label: 'Billed-work revenue',
    basis: 'Dated invoice work, before tax; advances excluded', period: 'cumulative through the selected date',
  },
  billedWorkPeriod: {
    id: 'billed-work-period', family: 'invoiced', label: 'Billed-work revenue',
    basis: 'Dated invoice work, before tax; advances excluded', period: 'selected period',
  },
  contractValue: {
    id: 'contract-value', family: 'invoiced', label: 'Contract value',
    basis: 'Recorded signed contract value with its tax basis', period: 'as recorded',
  },
  contractLeftToInvoice: {
    id: 'contract-left-to-invoice', family: 'invoiced', label: 'Left to invoice',
    basis: 'Recorded contract value less comparable contract-kind invoices', period: 'all history through the selected date',
  },
  invoiceDocuments: {
    id: 'invoice-documents', family: 'invoiced', label: 'Invoice documents',
    basis: 'Distinct non-draft, non-cancelled invoice documents', period: 'all time',
  },
} as const satisfies Record<string, FigureIdentity>;
