import React from 'react';
import type { TFunction } from 'i18next';
import { CompanyNameLink, ProjectNameLink, type TabItem } from '@/src/components/ui';
import type { useLinkedErpDocuments } from '@/src/hooks/useErpPurchaseLinks';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { DetailRow } from './ProcurementOverviewTab';
import { erpDoctypeLabel } from './erpLinkReasons';
import { stageForStatus } from './blocks/stage';

// Tabbed record shell (mirrors ProjectDetail's `/projects/:id/:tab`). An absent/unknown :tab
// defaults to the timeline and is role-invariant (CW-7); an explicit :tab always wins.
export type ProcTab = 'timeline' | 'items' | 'quotes' | 'files' | 'details';
const PROC_TAB_VALUES: ProcTab[] = ['timeline', 'items', 'quotes', 'files', 'details'];
export function tabFromParam(param: string | undefined): ProcTab {
  if (param === 'documents') return 'files';
  if (param === 'overview' || param === 'history') return 'timeline';
  if (param && (PROC_TAB_VALUES as string[]).includes(param)) return param as ProcTab;
  return 'timeline';
}

/** The ledger row type -> the `procurement_documents.record_kind` it attaches as (0361). */
const LEDGER_KIND = {
  PR: 'purchase_request', RFQ: 'rfq', Quote: 'quotation', PO: 'purchase_order', GR: 'goods_receipt', Invoice: 'vendor_invoice', Payment: 'payment',
} as const;

type LinkedDocs = NonNullable<ReturnType<typeof useLinkedErpDocuments>['data']>;

/** Overview Detail <dl> rows (the Field grammar). Vendor / Approved-by read a muted
 *  "Not yet selected" / "Pending" while absent rather than a bare blank (G5 honesty). */
export function procurementDetailRows(p: ProcurementDetail, t: TFunction, linkedDocCount: number): DetailRow[] {
  return [
    {
      label: t('procurementDetail.detail.project', 'Project'),
      value: p.project?.name ? (
        <ProjectNameLink projectId={p.project_id} name={projectDisplayName(p.project)} legalName={p.project.name} />
      ) : (
        <span className="text-muted-foreground">{t('procurementDetail.detail.notLinked', 'Not linked')}</span>
      ),
    },
    {
      label: t('procurementRecord:details.supplier', 'Supplier'),
      value: p.vendor?.name ? (
        <CompanyNameLink companyId={p.vendor_id} name={p.vendor.name} />
      ) : (
        <span className="text-muted-foreground">
          {t('procurementDetail.detail.notYetSelected', 'Not yet selected')}
        </span>
      ),
    },
    {
      label: t('procurementDetail.detail.requestedBy', 'Requested by'),
      value: p.requested_by?.full_name ?? (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      label: t('procurementDetail.detail.approvedBy', 'Approved by'),
      value: p.approved_by?.full_name ?? (
        <span className="text-muted-foreground">{stageForStatus(p.status) === 'Request' ? t('procurementDetail.detail.pending', 'Pending') : '—'}</span>
      ),
    },
    { label: t('procurementRecord:details.budgetCategory', 'Budget category'), value: p.budget_category || '—' },
    {
      label: t('procurementRecord:details.accountingStatus', 'Accounting-system status'),
      value: t('procurementRecord:details.accountingStatusValue', { defaultValue: '{{orders}} · {{docs}}', orders: t('procurementRecord:details.purchaseOrders', { count: p.purchase_orders.length, defaultValue: '{{count}} purchase orders' }), docs: t('procurementRecord:details.documentsLinked', { count: linkedDocCount, defaultValue: '{{count}} documents linked' }) }),
    },
  ];
}

/** FR-PFE-038: a SharePoint link can be attached to any record of the purchase or a linked ERP document. */
export function procurementAttachTargets(ledgerRows: LedgerRow[], linkedDocs: LinkedDocs, t: TFunction) {
  // FR-PFE-038: a SharePoint link can be attached to any record of the purchase or a linked ERP document.
  const attachTypeName: Record<LedgerRow['type'], string> = {
    PR: t('procurement:documents.type.pr', 'Purchase request'), RFQ: t('procurement:documents.type.rfq', 'Quote request'),
    Quote: t('procurement:documents.type.quote', 'Quotation'), PO: t('procurement:documents.type.po', 'Purchase order'),
    GR: t('procurement:documents.type.gr', 'Goods receipt'), Invoice: t('procurement:documents.type.invoice', 'Supplier invoice'),
    Payment: t('procurement:documents.type.payment', 'Payment'),
  };
  // Labelled by type + number (never a raw id); a record with no number yet is just its type.
  const attachTargets = [
    ...ledgerRows.map((r) => ({
      value: `${LEDGER_KIND[r.type]}:${r.recordId}`,
      label: r.systemNumber ? `${attachTypeName[r.type]} ${r.systemNumber}` : attachTypeName[r.type],
      recordKind: LEDGER_KIND[r.type], recordId: r.recordId,
    })),
    ...(linkedDocs ?? []).map((d) => ({
      value: `erp_document:${d.id}`, label: `${erpDoctypeLabel(t, d.doctype)} ${d.name}`, recordKind: 'erp_document' as const, recordId: d.id,
    })),
  ];
  return attachTargets;
}

export function procurementTabs(p: ProcurementDetail, t: TFunction, documentsCount: number, ledgerRows: LedgerRow[]): TabItem<ProcTab>[] {
  return [
    { value: 'timeline', label: t('procurementRecord:tabs.timeline', 'Timeline'), count: documentsCount || null },
    {
      value: 'items',
      label: t('procurementRecord:tabs.items', 'Line items'),
      count: p.items.length || null,
    },
    {
      value: 'quotes',
      label: t('procurementRecord:tabs.quotes', 'Quotations'),
      count: p.quotations.length || null,
    },
    { value: 'files', label: t('procurementRecord:tabs.files', 'Files'), count: ledgerRows.reduce((sum, row) => sum + row.fileCount, 0) || null },
    { value: 'details', label: t('procurementRecord:tabs.details', 'Details') },
  ];
}
