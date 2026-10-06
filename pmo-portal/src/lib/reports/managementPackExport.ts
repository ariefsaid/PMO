import type { CellValue, ExportTable } from '@/src/lib/export';
import { fromCents, type ManagementPack, type PackRow } from './managementPack';

/** Translated column titles and cell words — the page passes `t()` results; this module stays pure. */
export interface ManagementPackExportLabels {
  month: string;
  projectNumber: string;
  project: string;
  client: string;
  currency: string;
  taxBasis: string;
  planned: string;
  recognised: string;
  invoiced: string;
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
}

const money = (cents: number | null): CellValue => (cents === null ? '' : fromCents(cents));
const rowName = (row: PackRow, l: ManagementPackExportLabels): string =>
  row.kind === 'unassigned' ? l.unassigned : row.projectName ?? '';

/** Long format (one row per project row × month) so a pivot table can reshape it; months are `YYYY-MM` text. */
export function buildManagementPackExport(pack: ManagementPack, l: ManagementPackExportLabels): ExportTable {
  const header = [
    l.month, l.projectNumber, l.project, l.client, l.currency, l.taxBasis, l.planned, l.recognised, l.invoiced,
    l.recognisedToDate, l.invoicedToDate, l.unbilled, l.backlog, l.basis,
  ];
  const body: CellValue[][] = [];
  for (const row of pack.rows) {
    for (const m of row.months) {
      body.push([
        m.month.slice(0, 7), row.projectNumber ?? '', rowName(row, l), row.clientName ?? '', row.currency,
        l.taxBasisValue, money(m.planned), money(m.recognised), money(m.invoiced), money(m.recognisedToDate),
        money(m.invoicedToDate), money(m.unbilled), money(m.backlog),
        m.basis === 'progress' ? l.basisProgress : l.basisInvoiced,
      ]);
    }
  }
  for (const totals of pack.totals) {
    for (const t of totals.months) {
      body.push([
        t.month.slice(0, 7), '', l.total, '', totals.currency, l.taxBasisValue, money(t.planned), money(t.recognised),
        money(t.invoiced), money(t.recognisedToDate), money(t.invoicedToDate), money(t.unbilled), money(t.backlog), '',
      ]);
    }
  }
  return { header, body };
}

/** e.g. `Management-pack_2026-09` — the as-at month, so two months' files never collide. */
export function managementPackFileStem(pack: ManagementPack): string {
  return `Management-pack_${pack.to.slice(0, 7)}`;
}
