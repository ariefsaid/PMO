import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DataTable, type Column } from '@/src/components/ui';
import { formatCurrency, formatDate } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ErpLinkRow, ErpLinkResponse, ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { useLinkErpDocuments } from '@/src/hooks/useErpPurchaseLinks';
import { LinkErpDocumentsDialog } from './LinkErpDocumentsDialog';
import { erpDoctypeLabel, erpLinkReasonText } from './erpLinkReasons';

export interface ErpOrphansSectionProps {
  /** Orphans only (procurementId === null). */
  rows: ErpPurchaseRow[];
  /** Project scope: new purchases land on this project, and the link dialog offers its purchases. */
  projectId?: string;
  /** Who may link (Admin · Executive · PM · Finance); the link RPC is the authority. */
  canLink: boolean;
  /** Org-wide view: adds a Project column; ids not in the map read "No project". */
  projectNames?: ReadonlyMap<string, string>;
  /** Distinguishes the project-tab table from the org-wide one (saved column widths). */
  tableId?: string;
}

type Failure = { headline: string; lines: string[] };

/** FR-PFE-041 — ERPNext documents not yet in a purchase, with single and bulk "Link to purchase" / "New purchase". */
export const ErpOrphansSection: React.FC<ErpOrphansSectionProps> = ({ rows, projectId, canLink, projectNames, tableId = 'erp-orphans-table' }) => {
  const { t } = useTranslation('finance');
  const navigate = useNavigate();
  const link = useLinkErpDocuments();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialogDocs, setDialogDocs] = useState<ErpPurchaseRow[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  // A row that left the list (linked elsewhere, refreshed away) drops out of the selection on its own.
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allChosen ? new Set() : new Set(rows.map((r) => r.id)));

  const refusals = (res: ErpLinkResponse) => res.results
    .filter((r) => r.outcome === 'refused')
    .map((r) => `${r.erp_name ?? ''}: ${erpLinkReasonText(r.reason, t)}`);

  /** FR-PFE-026 — a new Draft purchase for the documents (one per project; a bulk call shares one group key). */
  const newPurchaseFrom = async (docs: ErpPurchaseRow[], key: string) => {
    setFailure(null);
    setBusyKey(key);
    const group = docs.length > 1 ? `bulk-${docs[0].name}` : undefined;
    const linkRows: ErpLinkRow[] = docs.map((d) => ({
      erp_doctype: d.doctype,
      erp_name: d.name,
      project_id: projectId ?? (d.projectIds.length === 1 ? d.projectIds[0] : null),
      ...(group ? { group } : {}),
    }));
    try {
      const res = await link.mutateAsync({ rows: linkRows });
      const refused = refusals(res);
      if (refused.length > 0) {
        setFailure({ headline: t('erpLinks.refusedHeadline', 'Some documents were not added to a purchase.'), lines: refused });
        return;
      }
      setSelected(new Set());
      const targets = [...new Set(res.results.map((r) => r.procurement_id).filter((id): id is string => Boolean(id)))];
      if (targets.length === 1) navigate(`/procurement/${targets[0]}`);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setFailure({ headline, lines: detail ? [detail] : [] });
    } finally {
      setBusyKey(null);
    }
  };

  const projectLabel = (r: ErpPurchaseRow) =>
    r.projectIds.map((id) => projectNames?.get(id)).filter(Boolean).join(', ') || t('erpPurchases.noProject', 'No project');

  const columns: Column<ErpPurchaseRow>[] = [
    {
      key: 'document',
      header: canLink ? (
        <span className="inline-flex items-center gap-2">
          <Checkbox
            checked={allChosen ? true : chosen.length > 0 ? 'mixed' : false}
            onChange={toggleAll}
            label={t('erpLinks.selectAll', 'Select all {{count}} documents', { count: rows.length })}
          />
          {t('erpPurchases.column.document', 'Document')}
        </span>
      ) : t('erpPurchases.column.document', 'Document'),
      kind: 'primary',
      size: 240,
      minSize: 220,
      primaryTitle: (r) => r.name,
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          {canLink && (
            <Checkbox
              checked={selected.has(r.id)}
              onChange={() => toggle(r.id)}
              label={t('erpLinks.selectOne', 'Select {{name}}', { name: r.name })}
            />
          )}
          <span className="font-mono">{r.name}</span>
        </span>
      ),
      secondaryCell: (r) => <span className={canLink ? 'pl-6' : undefined}>{erpDoctypeLabel(t, r.doctype)}</span>,
      exportValue: (r) => r.name,
    },
    { key: 'supplier', header: t('erpPurchases.column.supplier', 'Supplier'), cell: (r) => r.supplier ?? '—', exportValue: (r) => r.supplier ?? '' },
    ...(projectNames ? [{
      key: 'project', header: t('erpPurchases.column.project', 'Project'),
      cell: (r: ErpPurchaseRow) => projectLabel(r), exportValue: (r: ErpPurchaseRow) => projectLabel(r),
    }] : []),
    { key: 'date', header: t('erpPurchases.column.date', 'Date'), kind: 'date', cell: (r) => formatDate(r.docDate), exportValue: (r) => r.docDate ?? '' },
    {
      key: 'amount', header: t('erpPurchases.column.amount', 'Amount'), kind: 'money', align: 'num',
      cell: (r) => (r.grandTotal === null || !r.currency ? '—' : formatCurrency(r.grandTotal, r.currency)),
      exportValue: (r) => r.grandTotal ?? '',
    },
    ...(canLink ? [{
      key: 'actions',
      header: <span className="sr-only">{t('erpLinks.actions', 'Actions')}</span>,
      kind: 'actions' as const,
      size: 310,
      minSize: 310,
      cell: (r: ErpPurchaseRow) => (
        <div className="flex justify-end gap-1 whitespace-nowrap">
          <Button size="sm" variant="ghost" aria-label={t('erpLinks.linkOneNamed', 'Link to purchase: {{name}}', { name: r.name })}
            onClick={() => { setFailure(null); setDialogDocs([r]); }}>
            {t('erpLinks.linkOne', 'Link to purchase')}
          </Button>
          <Button size="sm" variant="ghost" loading={busyKey === r.id} disabled={busyKey !== null}
            aria-label={t('erpLinks.newOneNamed', 'New purchase from this: {{name}}', { name: r.name })}
            onClick={() => void newPurchaseFrom([r], r.id)}>
            {t('erpLinks.newOne', 'New purchase from this')}
          </Button>
        </div>
      ),
    }] : []),
  ];

  return (
    <div>
      {canLink && chosen.length > 0 && (
        <div role="group" aria-label={t('erpLinks.selectionGroup', 'Selected documents')}
          className="mb-3 flex flex-wrap items-center gap-2.5 rounded-lg bg-primary/[0.06] px-3 py-2.5">
          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[12px] font-semibold tabular text-muted-foreground">
            {t('erpLinks.selectedCount', '{{count}} selected', { count: chosen.length })}
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="primary" disabled={busyKey !== null} onClick={() => { setFailure(null); setDialogDocs(chosen); }}>
            {t('erpLinks.bulkLink', 'Link {{count}} to purchase', { count: chosen.length })}
          </Button>
          <Button size="sm" variant="outline" loading={busyKey === 'bulk'} disabled={busyKey !== null}
            onClick={() => void newPurchaseFrom(chosen, 'bulk')}>
            {t('erpLinks.bulkNew', 'New purchase from {{count}}', { count: chosen.length })}
          </Button>
          <Button size="sm" variant="ghost" disabled={busyKey !== null} onClick={() => setSelected(new Set())}>
            {t('erpLinks.clear', 'Clear')}
          </Button>
        </div>
      )}
      {failure && (
        <div role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3 text-[13px]">
          <p className="font-semibold text-destructive-text">{failure.headline}</p>
          {failure.lines.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {failure.lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
        </div>
      )}
      <DataTable<ErpPurchaseRow>
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        tableId={tableId}
        accessibleName={t('erpLinks.orphansTitle', 'ERPNext documents not in a purchase')}
      />
      {dialogDocs && (
        <LinkErpDocumentsDialog
          docs={dialogDocs}
          projectId={projectId}
          onClose={() => setDialogDocs(null)}
          onLinked={(id) => { setDialogDocs(null); setSelected(new Set()); navigate(`/procurement/${id}`); }}
          onPartiallyLinked={(headline, lines) => { setDialogDocs(null); setSelected(new Set()); setFailure({ headline, lines }); }}
        />
      )}
    </div>
  );
};
