import type { CellValue, ExportTable } from '@/src/lib/export';
import { fromCents, leftToBillAt, selectBilledWorkInPeriod, selectBilledWorkOpening, unpricedIn, type ManagementPack, type PackRow } from './managementPack';

/** Translated column titles and cell words — the page passes `t()` results; this module stays pure. */
export interface ManagementPackExportLabels {
  period: string;
  projectNumber: string;
  project: string;
  client: string;
  currency: string;
  taxBasis: string;
  planned: string;
  recognised: string;
  invoicedByMonth: string;
  selectedPeriod: string;
  opening: string;
  selectedPeriodRow: string;
  openingRow: string;
  recognisedToDate: string;
  invoicedToDate: string;
  unbilled: string;
  backlog: string;
  basis: string;
  /** Every figure is net of tax (DD-MMP-5); OD-TAX-1 §2 forbids a bare number. */
  taxBasisValue: string;
  unassigned: string;
  total: string;
  basisInvoiced: string;
  basisProgress: string;
  basisEarned: string;
}

const money = (cents: number | null): CellValue => (cents === null ? '' : fromCents(cents));
const rowName = (row: PackRow, l: ManagementPackExportLabels): string =>
  row.kind === 'unassigned' ? l.unassigned : row.projectName ?? '';

/** Long format monthly rows plus per-currency selected-period and opening summaries; periods are `YYYY-MM` text. */
export function buildManagementPackExport(pack: ManagementPack, l: ManagementPackExportLabels): ExportTable {
  const header = [
    l.period, l.projectNumber, l.project, l.client, l.currency, l.taxBasis, l.planned, l.recognised, l.invoicedByMonth,
    l.selectedPeriod, l.opening, l.recognisedToDate, l.invoicedToDate, l.unbilled, l.backlog, l.basis,
  ];
  const body: CellValue[][] = [];
  for (const row of pack.rows) {
    row.months.forEach((m) => {
      const leftToBill = row.kind === 'contract' ? leftToBillAt([row], row.currency, m.month) : null;
      body.push([
        m.month.slice(0, 7), row.projectNumber ?? '', rowName(row, l), row.clientName ?? '', row.currency,
        l.taxBasisValue, money(m.planned), money(m.recognised), money(m.invoiced), '', '', money(m.recognisedToDate),
        money(m.invoicedToDate), money(m.unbilled), money(leftToBill),
        m.basis === 'progress' ? l.basisProgress : m.basis === 'earned' ? l.basisEarned : l.basisInvoiced,
      ]);
    });
  }
  for (const totals of pack.totals) {
    for (const t of totals.months) {
      const leftToBill = leftToBillAt(pack.rows, totals.currency, t.month);
      const period = t.month.slice(0, 7);
      // An invoice with no amount yet makes the invoiced totals that include it unknown (blank), never a partial sum.
      const invoiced = unpricedIn(pack, totals.currency, period, period) ? null : t.invoiced;
      const invoicedToDate = unpricedIn(pack, totals.currency, null, period) ? null : t.invoicedToDate;
      body.push([
        period, '', l.total, '', totals.currency, l.taxBasisValue, money(t.planned), money(t.recognised),
        money(invoiced), '', '', money(t.recognisedToDate), money(invoicedToDate), money(t.unbilled), money(leftToBill), '',
      ]);
    }
  }
  for (const total of selectBilledWorkInPeriod(pack, pack.from, pack.to) ?? []) {
    body.push([
      l.selectedPeriodRow, '', l.total, '', total.currency, l.taxBasisValue, '', '', '', money(total.amount === null ? null : Math.round(total.amount * 100)),
      '', '', '', '', '', '',
    ]);
  }
  for (const opening of selectBilledWorkOpening(pack, pack.from) ?? []) {
    body.push([
      l.openingRow, '', l.total, '', opening.currency, l.taxBasisValue, '', '', '', '', money(opening.amount === null ? null : Math.round(opening.amount * 100)),
      '', '', '', '', '',
    ]);
  }
  return { header, body };
}

/** e.g. `Management-pack_2026-09` — the as-at month, so two months' files never collide. */
export function managementPackFileStem(pack: ManagementPack): string {
  return `Management-pack_${pack.to.slice(0, 7)}`;
}
