import React, { useId, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListState, StatusPill, Tooltip, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectJournalLines } from '@/src/hooks/useErpJournalLines';
import { formatCurrency, formatDate } from '@/src/lib/format';
import type { ErpJournalLine } from '@/src/lib/repositories/erpJournalLines';
import { AttachJournalLineDialog } from './AttachJournalLineDialog';

/**
 * FR-JEC-001/003/004 — the journal entries the accounting system booked to this project, each attachable to a PMO
 * purchase (link only). Their cost is already in Actuals through the ledger, so the list shows no total that could be
 * read as extra spend. Renders nothing until there is a line, so a project without journal history (or an org that reads
 * no ledger, or a role outside the ERP-purchase audience; the RPC returns no rows to it) keeps today's screen.
 */
export const ErpJournalLinesSection: React.FC<{ projectId: string; className?: string }> = ({ projectId, className }) => {
  const { t } = useTranslation('finance');
  const headingId = useId();
  const may = usePermission();
  const canView = may('view', 'procurement');
  const canAttach = may('create', 'erpPurchaseLink');
  const query = useProjectJournalLines(projectId, { enabled: canView });
  const [attaching, setAttaching] = useState<ErpJournalLine | null>(null);

  const rows = query.data ?? [];
  if (!canView || (!query.isError && rows.length === 0)) return null;

  const noPurchase = t('erpJournal.noPurchaseNote', 'Paid directly and recorded in the accounting system as a journal, so no purchase was raised in PMO.');

  const columns: Column<ErpJournalLine>[] = [
    {
      key: 'journal', header: t('erpJournal.column.journal', 'Journal'), kind: 'primary',
      primaryTitle: (l) => l.voucherNo,
      cell: (l) => (l.erpUrl
        ? <a href={l.erpUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-primary-text hover:underline">{l.voucherNo}</a>
        : <span className="font-mono">{l.voucherNo}</span>),
      secondaryCell: (l) => l.remarks ?? l.party ?? null,
    },
    { key: 'date', header: t('erpJournal.column.date', 'Date'), kind: 'date', cell: (l) => formatDate(l.postingDate) },
    {
      key: 'account', header: t('erpJournal.column.account', 'Account'),
      cell: (l) => (
        <span className="block">
          {l.account}
          <span className="block text-xs text-muted-foreground">{l.category}</span>
        </span>
      ),
    },
    { key: 'remark', header: t('erpJournal.column.remark', 'Remark'), cell: (l) => l.remarks ?? '—' },
    {
      key: 'amount', header: t('erpJournal.column.amount', 'Amount'), kind: 'money', align: 'num',
      cell: (l) => (l.isCancelled || !l.currency ? '—' : formatCurrency(l.amount, l.currency)),
    },
    {
      key: 'purchase', header: t('erpJournal.column.purchase', 'Purchase'),
      cell: (l) => {
        if (l.isCancelled) return <StatusPill variant="neutral">{t('erpJournal.cancelled', 'Cancelled in the accounting system')}</StatusPill>;
        if (l.procurementId) {
          return <Link to={`/procurement/${l.procurementId}`} className="text-primary-text hover:underline">{l.procurementTitle ?? l.procurementId}</Link>;
        }
        return <span className="text-muted-foreground">{t('erpJournal.notInPurchase', 'Not in a purchase')}</span>;
      },
    },
    ...(canAttach ? [{
      key: 'actions', header: <span className="sr-only">{t('erpLinks.actions', 'Actions')}</span>, kind: 'actions' as const, size: 150,
      cell: (l: ErpJournalLine) => (!l.linkId && !l.isCancelled && l.amount > 0 ? (
        <Button size="sm" variant="outline" aria-label={t('erpJournal.attachOne', 'Attach {{name}} to a purchase', { name: l.voucherNo })}
          onClick={() => setAttaching(l)}>
          {t('erpJournal.attach', 'Attach to purchase')}
        </Button>
      ) : null),
    }] : []),
  ];

  return (
    <section aria-labelledby={headingId} className={className}>
      <div className="mb-3.5">
        <h2 id={headingId} className="text-[16px] font-bold tracking-[-0.01em]">
          {t('erpJournal.title', 'Journal entries from the accounting system')}
        </h2>
        <p className="text-sm text-muted-foreground">
          <Tooltip content={t('erpJournal.qualifier', 'These costs are already counted in project spending. Attaching connects a journal to a purchase and does not add spend.')}>
            <span tabIndex={0} className="rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              {t('erpJournal.alreadyInSpending', 'Already in spending')}
            </span>
          </Tooltip>
        </p>
        {rows.some((l) => !l.linkId && !l.isCancelled) && <p className="text-sm text-muted-foreground">{noPurchase}</p>}
      </div>
      {query.isError ? (
        <ListState variant="error" title={t('erpJournal.loadError', "Couldn't load the journal entries")} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable<ErpJournalLine>
          rows={rows}
          columns={columns}
          rowKey={(l) => `${l.erpDoctype}|${l.voucherNo}|${l.account}`}
          tableId="project-erp-journal-lines"
          accessibleName={t('erpJournal.title', 'Journal entries from the accounting system')}
        />
      )}
      {attaching && <AttachJournalLineDialog line={attaching} onClose={() => setAttaching(null)} />}
    </section>
  );
};
