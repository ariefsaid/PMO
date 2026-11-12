import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, DataTable, ListState, StatusPill, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatCurrency, formatDay } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useDetachJournalLine, usePurchaseJournalLines } from '@/src/hooks/useErpJournalLines';
import type { ErpJournalLine } from '@/src/lib/repositories/erpJournalLines';

/**
 * FR-JEC-016 — the accounting-system journal lines attached to this purchase. Read-only except Detach (FR-JEC-014,
 * Admin/Finance; the RPC is the authority). Renders nothing until a line is attached, so a purchase without journals
 * keeps today's screen; the read returns no rows outside the ERP-purchase audience.
 */
export const AttachedJournalLines: React.FC<{ procurementId: string; projectId: string | null }> = ({ procurementId, projectId }) => {
  const { t } = useTranslation('finance');
  const headingId = useId();
  const query = usePurchaseJournalLines(procurementId, projectId);
  const detach = useDetachJournalLine();
  const canDetach = usePermission()('delete', 'erpPurchaseLink');
  const [confirming, setConfirming] = useState<ErpJournalLine | null>(null);
  const [detachError, setDetachError] = useState<string | null>(null);

  const rows = query.data ?? [];
  if (!query.isError && rows.length === 0) return null;

  const close = () => { setConfirming(null); setDetachError(null); };
  const confirmDetach = async () => {
    if (!confirming?.linkId) return;
    setDetachError(null);
    try {
      await detach.mutateAsync(confirming.linkId);
      close();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setDetachError(detail ? `${headline} ${detail}` : headline);
    }
  };

  const columns: Column<ErpJournalLine>[] = [
    {
      key: 'journal', header: t('erpJournal.column.journal', 'Journal'), kind: 'primary',
      primaryTitle: (l) => l.voucherNo,
      cell: (l) => (l.erpUrl
        ? <a href={l.erpUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-primary-text hover:underline">{l.voucherNo}</a>
        : <span className="font-mono">{l.voucherNo}</span>),
      secondaryCell: (l) => l.remarks ?? null,
    },
    { key: 'date', header: t('erpJournal.column.date', 'Date'), kind: 'date', cell: (l) => formatDay(l.postingDate) },
    { key: 'account', header: t('erpJournal.column.account', 'Account'), cell: (l) => l.account },
    {
      key: 'amount', header: t('erpJournal.column.amount', 'Amount'), kind: 'money', align: 'num',
      cell: (l) => (l.isCancelled ? t('erpJournal.cancelled', 'Cancelled in the accounting system') : l.currency ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {l.possiblyReversed && <StatusPill variant="warn">{t('erpJournal.possiblyReversed', 'Possibly reversed')}</StatusPill>}
          {formatCurrency(l.amount, l.currency)}
        </span>
      ) : '—'),
    },
    ...(canDetach ? [{
      key: 'actions', header: <span className="sr-only">{t('erpLinks.actions', 'Actions')}</span>, kind: 'actions' as const, size: 120,
      cell: (l: ErpJournalLine) => (l.linkId ? (
        <Button size="sm" variant="outline" aria-label={t('erpJournal.detachOne', 'Detach {{name}}', { name: l.voucherNo })}
          onClick={() => { setDetachError(null); setConfirming(l); }}>
          {t('erpJournal.detach', 'Detach')}
        </Button>
      ) : null),
    }] : []),
  ];

  return (
    <section aria-labelledby={headingId} className="mt-6 border-t border-border pt-4">
      <h2 id={headingId} className="mb-2 px-1 text-[14px] font-semibold text-foreground">
        {t('erpJournal.attachedTitle', 'Journal entries from the accounting system')}
      </h2>
      {query.isError ? (
        <ListState variant="error" title={t('erpJournal.attachedError', "Couldn't load the attached journal entries")} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable<ErpJournalLine>
          rows={rows}
          columns={columns}
          rowKey={(l) => `${l.erpDoctype}|${l.voucherNo}|${l.account}`}
          tableId="procurement-attached-journal-lines"
          accessibleName={t('erpJournal.attachedTitle', 'Journal entries from the accounting system')}
        />
      )}
      <ConfirmDialog
        open={confirming !== null}
        tone="destructive"
        title={t('erpJournal.detachTitle', 'Detach {{name}}?', { name: confirming?.voucherNo ?? '' })}
        description={(
          <span className="block space-y-2">
            <span className="block">{t('erpJournal.detachBody', '{{name}} is no longer part of this purchase and its open commitment goes back up by that amount. Project spending does not change, and nothing changes in the accounting system.', { name: confirming?.voucherNo ?? '' })}</span>
            {detachError && <span role="alert" className="block text-destructive-text">{detachError}</span>}
          </span>
        )}
        confirmLabel={t('erpJournal.detach', 'Detach')}
        cancelLabel={t('erpLinks.cancel', 'Cancel')}
        loading={detach.isPending}
        onConfirm={() => void confirmDetach()}
        onCancel={close}
      />
    </section>
  );
};
