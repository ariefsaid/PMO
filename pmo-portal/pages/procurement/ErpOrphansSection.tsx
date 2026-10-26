import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DataTable, MenuButton, type Column, type RowMenuItem } from '@/src/components/ui';
import { formatDate, formatNumber } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ErpLinkRow, ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { useLinkErpDocuments } from '@/src/hooks/useErpPurchaseLinks';
import { LinkErpDocumentsDialog, type PartialLink } from './LinkErpDocumentsDialog';
import { erpDoctypeLabel, erpLinkReasonText, erpPreTaxAmount } from './erpLinkReasons';

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

/** What a link call made and what it refused — shown above the list (FR-PFE-023, review 1). */
type Outcome =
  | { kind: 'result'; verb: 'added' | 'linked'; made: number; targets: string[]; newPurchase: boolean; refused: string[] }
  | { kind: 'error'; headline: string; detail?: string };

/** FR-PFE-041 — ERPNext documents not yet in a purchase: one "Link…" action per row, plus bulk link / new purchase. */
export const ErpOrphansSection: React.FC<ErpOrphansSectionProps> = ({ rows, projectId, canLink, projectNames, tableId }) => {
  const { t } = useTranslation('finance');
  const navigate = useNavigate();
  const link = useLinkErpDocuments();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialogDocs, setDialogDocs] = useState<ErpPurchaseRow[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // A row that left the list (linked elsewhere, refreshed away) drops out of the selection on its own.
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const selecting = chosen.length > 0;
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allChosen ? new Set() : new Set(rows.map((r) => r.id)));

  /** FR-PFE-025/026 — the project a new purchase lands on: the scoped project, else the document's only project. */
  const targetProject = (d: ErpPurchaseRow): string | null => projectId ?? (d.projectIds.length === 1 ? d.projectIds[0] : null);
  /** Only a document split across several projects is ambiguous; one with none is an explicit "No project" purchase. */
  const isSplit = (d: ErpPurchaseRow) => projectId === undefined && d.projectIds.length > 1;
  const bulkNewBlocked = chosen.some(isSplit);
  const projectName = (id: string) => projectNames?.get(id) ?? t('erpLinks.thisProject', 'the project');

  const openDialog = (docs: ErpPurchaseRow[]) => { setOutcome(null); setDialogDocs(docs); };

  /** FR-PFE-026 — a new Draft purchase for the documents (one per project; a bulk call shares one group key). */
  const newPurchaseFrom = async (docs: ErpPurchaseRow[], key: string) => {
    setOutcome(null);
    setBusyKey(key);
    const group = docs.length > 1 ? `bulk-${docs[0].name}` : undefined;
    const linkRows: ErpLinkRow[] = docs.map((d) => ({
      erp_doctype: d.doctype,
      erp_name: d.name,
      project_id: targetProject(d),
      ...(group ? { group } : {}),
    }));
    try {
      const res = await link.mutateAsync({ rows: linkRows });
      const refused = res.results.filter((r) => r.outcome === 'refused')
        .map((r) => `${r.erp_name ?? ''}: ${erpLinkReasonText(r.reason, t)}`);
      const targets = [...new Set(res.results.filter((r) => r.outcome !== 'refused')
        .map((r) => r.procurement_id).filter((id): id is string => Boolean(id)))];
      setSelected(new Set());
      if (refused.length === 0 && targets.length === 1) {
        navigate(`/procurement/${targets[0]}`);
        return;
      }
      setOutcome({ kind: 'result', verb: 'added', made: docs.length - refused.length, targets, newPurchase: true, refused });
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setOutcome({ kind: 'error', headline, detail });
    } finally {
      setBusyKey(null);
    }
  };

  const rowMenu = (r: ErpPurchaseRow): RowMenuItem[] => {
    // An invoice split across projects is not linked into one purchase (the server refuses it): say how to add it instead.
    if (r.doctype === 'Purchase Invoice' && r.projectIds.length > 1) {
      return [{ label: t('erpLinks.splitInvoice', 'Split across projects: link it per project in ERPNext, or record it in PMO'), onClick: () => undefined, disabled: true }];
    }
    const items: RowMenuItem[] = [{ label: t('erpLinks.linkOne', 'Link to purchase'), onClick: () => openDialog([r]) }];
    if (targetProject(r) !== null) {
      items.push({ label: t('erpLinks.newOne', 'New purchase from this'), onClick: () => void newPurchaseFrom([r], r.id), disabled: busyKey !== null });
    } else if (!isSplit(r)) {
      // Untagged in ERPNext: an overhead / projectless purchase is permitted, so it is an explicit choice, not a dead end.
      items.push({ label: t('erpLinks.newNoProject', 'New purchase with no project'), onClick: () => void newPurchaseFrom([r], r.id), disabled: busyKey !== null });
    } else {
      // Review 2a: a document split across projects is added from one of its projects, never by a refused one-click.
      for (const id of r.projectIds) {
        items.push({ label: t('erpLinks.openProject', 'Open {{project}} to add it', { project: projectName(id) }), onClick: () => navigate(`/projects/${id}/procurement`) });
      }
    }
    return items;
  };

  const projectLabel = (r: ErpPurchaseRow) =>
    r.projectIds.map((id) => projectNames?.get(id)).filter(Boolean).join(', ') || t('erpPurchases.noProject', 'No project');
  const amountOf = (r: ErpPurchaseRow) => {
    const amount = erpPreTaxAmount(r);
    return amount === null || !r.currency ? '—' : formatNumber(amount);
  };

  const columns: Column<ErpPurchaseRow>[] = [
    {
      key: 'document',
      header: t('erpPurchases.column.document', 'Document'),
      kind: 'primary',
      size: 240,
      minSize: 220,
      primaryTitle: (r) => r.name,
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          {canLink && (
            <Checkbox
              className="max-[767px]:!size-6"
              checked={selected.has(r.id)}
              onChange={() => toggle(r.id)}
              label={t('erpLinks.selectOne', 'Select {{name}}', { name: r.name })}
            />
          )}
          <span className="font-mono">{r.name}</span>
        </span>
      ),
      secondaryCell: (r) => <span className={canLink ? 'pl-6 max-[767px]:pl-8' : undefined}>{erpDoctypeLabel(t, r.doctype)}</span>,
      exportValue: (r) => r.name,
    },
    { key: 'supplier', header: t('erpPurchases.column.supplier', 'Supplier'), size: 200, cell: (r) => r.supplier ?? '—', exportValue: (r) => r.supplier ?? '' },
    ...(projectNames ? [{
      key: 'project', header: t('erpPurchases.column.project', 'Project'), size: 220,
      cell: (r: ErpPurchaseRow) => projectLabel(r), exportValue: (r: ErpPurchaseRow) => projectLabel(r),
    }] : []),
    { key: 'date', header: t('erpPurchases.column.date', 'Date'), kind: 'date', size: 130, cell: (r) => formatDate(r.docDate), exportValue: (r) => r.docDate ?? '' },
    {
      key: 'amount', header: t('erpPurchases.column.amountPreTax', 'Amount (pre-tax)'), kind: 'money', align: 'num', size: 170,
      cell: amountOf,
      exportValue: (r) => erpPreTaxAmount(r) ?? '',
    },
    ...(canLink ? [{
      key: 'actions',
      header: <span className="sr-only">{t('erpLinks.actions', 'Actions')}</span>,
      kind: 'actions' as const,
      size: 110,
      minSize: 110,
      // Decision 5: one labelled row action; hidden while rows are selected (the bulk bar is the action then).
      cell: (r: ErpPurchaseRow) => (selecting ? null : (
        <div className="flex justify-end">
          <MenuButton label={t('erpLinks.linkMenu', 'Link…')} ariaLabel={t('erpLinks.linkMenuNamed', 'Link {{name}}', { name: r.name })} items={rowMenu(r)} />
        </div>
      )),
    }] : []),
  ];

  return (
    <div>
      {canLink && rows.length > 0 && (
        // Always mounted (review 10): selecting never shifts the list, and select-all works on phone cards too.
        <div role="group" aria-label={t('erpLinks.selectionGroup', 'Selected documents')}
          className="mb-3 flex min-h-12 flex-wrap items-center gap-2.5 rounded-lg bg-primary/[0.06] px-3 py-2">
          <Checkbox
            className="max-[767px]:!size-6"
            checked={allChosen ? true : selecting ? 'mixed' : false}
            onChange={toggleAll}
            label={t('erpLinks.selectAll', 'Select all {{count}} documents', { count: rows.length })}
          />
          {selecting ? (
            <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[12px] font-semibold tabular text-muted-foreground">
              {t('erpLinks.selectedCount', '{{count}} selected', { count: chosen.length })}
            </span>
          ) : (
            <span className="text-[13px] text-muted-foreground">{t('erpLinks.selectHint', 'Select documents to link several at once.')}</span>
          )}
          <span className="flex-1" />
          {selecting && (
            <>
              <Button size="sm" variant="primary" disabled={busyKey !== null} onClick={() => openDialog(chosen)}>
                {t('erpLinks.bulkLink', 'Link {{count}} to purchase', { count: chosen.length })}
              </Button>
              <Button size="sm" variant="outline" loading={busyKey === 'bulk'} disabled={busyKey !== null || bulkNewBlocked}
                onClick={() => void newPurchaseFrom(chosen, 'bulk')}>
                {t('erpLinks.bulkNew', 'New purchase from {{count}}', { count: chosen.length })}
              </Button>
              <Button size="sm" variant="ghost" disabled={busyKey !== null} onClick={() => setSelected(new Set())}>
                {t('erpLinks.clear', 'Clear')}
              </Button>
            </>
          )}
          {selecting && bulkNewBlocked && (
            <p className="basis-full text-[12.5px] text-muted-foreground">
              {t('erpLinks.bulkNeedsProject', 'Open the project to add documents split across several projects.')}
            </p>
          )}
        </div>
      )}
      {outcome && <OutcomeNotice outcome={outcome} />}
      <DataTable<ErpPurchaseRow>
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        tableId={tableId ?? 'erp-orphans-table'}
        accessibleName={t('erpLinks.orphansTitle', 'ERPNext documents not in a purchase')}
        groupBy={(row) => row.currency || t('common:notAvailable', 'Not available')}
        groupHeadingClassName="text-xl font-bold leading-tight"
      />
      {dialogDocs && (
        <LinkErpDocumentsDialog
          docs={dialogDocs}
          projectId={projectId}
          onClose={() => setDialogDocs(null)}
          onLinked={(id) => { setDialogDocs(null); setSelected(new Set()); navigate(`/procurement/${id}`); }}
          onPartiallyLinked={(p: PartialLink) => {
            setDialogDocs(null);
            setSelected(new Set());
            setOutcome({ kind: 'result', verb: 'linked', made: p.linked, targets: [p.procurementId], newPurchase: false, refused: p.refused });
          }}
        />
      )}
    </div>
  );
};

/** Review 1: say what was made (with a way to open it) and what was not, in plain words. */
const OutcomeNotice: React.FC<{ outcome: Outcome }> = ({ outcome }) => {
  const { t } = useTranslation('finance');
  if (outcome.kind === 'error') {
    return (
      <div role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3 text-[13px]">
        <p className="font-semibold text-destructive-text">{outcome.headline}</p>
        {outcome.detail && <p className="mt-1 text-muted-foreground">{outcome.detail}</p>}
      </div>
    );
  }
  const { verb, made, targets, newPurchase, refused } = outcome;
  const targetName = (i: number) => (newPurchase
    ? (targets.length === 1 ? t('erpLinks.aNewPurchase', 'a new purchase') : t('erpLinks.newPurchaseN', 'new purchase {{n}}', { n: i + 1 }))
    : t('erpLinks.thePurchase', 'the purchase'));
  return (
    <div role={refused.length > 0 ? 'alert' : 'status'}
      className={refused.length > 0
        ? 'mb-3 rounded-lg border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3 text-[13px]'
        : 'mb-3 rounded-lg border border-border bg-card px-3.5 py-3 text-[13px]'}>
      {made > 0 && (
        <p className="text-foreground">
          {verb === 'added'
            ? t('erpLinks.addedTo', '{{count}} added to', { count: made })
            : t('erpLinks.linkedTo', '{{count}} linked to', { count: made })}{' '}
          {targets.map((id, i) => (
            <React.Fragment key={id}>
              {i > 0 && ', '}
              <Link to={`/procurement/${id}`} className="font-medium text-primary hover:underline">{targetName(i)}</Link>
            </React.Fragment>
          ))}
          {refused.length > 0 && '.'}
        </p>
      )}
      {refused.length > 0 && (
        <>
          <p className="font-semibold text-destructive-text">
            {verb === 'added'
              ? t('erpLinks.notAdded', '{{count}} not added:', { count: refused.length })
              : t('erpLinks.notLinked', '{{count}} not linked:', { count: refused.length })}
          </p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {refused.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </>
      )}
    </div>
  );
};
