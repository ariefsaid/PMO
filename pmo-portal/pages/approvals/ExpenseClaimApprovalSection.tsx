import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, DecisionContextSummary, ListState, ReceiptPreview } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useExpenseClaimsAwaitingDecision, type ExpenseClaimAwaiting } from '@/src/hooks/useExpenseClaims';
import { claimsAwaitingViewer } from '@/src/lib/expenses/expenseRules';
import { formatCurrencyCents } from '@/src/lib/format';
import { useExpenseReceipts } from '@/src/hooks/useExpenseReceipts';
import type { ExpenseReceiptRow } from '@/src/lib/db/expenseReceipts';

const receiptName = (path: string) => path.split('/').pop() || path;

const ExpenseClaimEvidencePreview: React.FC<{ claim: ExpenseClaimAwaiting['claim'] }> = ({ claim }) => {
  const { t } = useTranslation();
  const { list, download } = useExpenseReceipts(claim.id);
  const files: ExpenseReceiptRow[] = list.data ?? [];

  const downloadOriginal = async (path: string) => {
    const url = await download(path, { download: true });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (list.isPending) return <p className="px-4 py-2 text-xs text-muted-foreground">{t('expenses.approvals.receiptsLoading', 'Loading receipts…')}</p>;
  if (list.isError) return <p role="alert" className="px-4 py-2 text-xs text-destructive-text">{t('expenses.approvals.receiptsError', "Couldn't load receipts.")}</p>;
  if (files.length === 0) return <p className="px-4 py-2 text-xs text-muted-foreground">{t('expenses.approvals.noReceipts', 'No receipts attached.')}</p>;

  return (
    <div className="border-t border-border px-4 py-3">
      <DecisionContextSummary
        identity={claim.claim_number ?? claim.title}
        amount={formatCurrencyCents(Number(claim.amount), claim.currency)}
      />
      <ul className="mt-3 space-y-2">
      {files.map((file) => {
        const name = receiptName(file.file_path);
        return <li key={file.id} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs" title={name}>{name}</span>
          <ReceiptPreview fileName={name} getPreviewUrl={() => download(file.file_path)} onDownload={() => downloadOriginal(file.file_path)} />
        </li>;
      })}
      </ul>
    </div>
  );
};

/** "Expense claims awaiting you" on /approvals (FR-EXP-066). Decisions happen on the record page. Hidden when none;
 *  a failed read shows an error rather than a false "nothing waiting" (the AwaitingApprovalTile lesson). */
export const ExpenseClaimApprovalSection: React.FC = () => {
  const { t } = useTranslation();
  const userId = useAuth().currentUser?.id;
  const { realRole } = useEffectiveRole();
  const { data, isPending, isError, refetch } = useExpenseClaimsAwaitingDecision();
  const rows = useMemo(() => claimsAwaitingViewer(data ?? [], userId, realRole), [data, userId, realRole]);
  const [evidenceClaimId, setEvidenceClaimId] = useState<string | null>(null);
  if (isPending) return null;
  if (isError) {
    return (
      <div className="mb-4">
        <ListState variant="error" title={t('expenses.approvals.errorTitle', "Couldn't load expense claims awaiting you")}
          sub={t('expenses.approvals.errorSub', 'Purchase requests and timesheets below are unaffected.')} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (rows.length === 0) return null;
  return (
    <section aria-label={t('expenses.approvals.label', 'Expense claims awaiting you')} className="mb-4">
      <Card seam>
        <CardHead className="rounded-t-lg">{t('expenses.approvals.heading', 'Expense claims awaiting you ({{count}})', { count: rows.length })}</CardHead>
        <ul className="divide-y divide-border rounded-b-lg border-t border-border">
          {rows.map(({ claim }) => (
            <li key={claim.id} className="px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Link to={`/expenses/${claim.id}`} className="font-medium text-primary-text hover:underline">{claim.claim_number ?? claim.title}</Link>
                <span className="min-w-0 flex-1 truncate">{claim.title}</span>
                <span className="text-muted-foreground">{claim.claimant?.full_name ?? '—'}</span>
                <span className="tabular-nums">{formatCurrencyCents(Number(claim.amount), claim.currency)}</span>
                <Button variant="outline" size="sm" aria-expanded={evidenceClaimId === claim.id} onClick={() => setEvidenceClaimId((current) => current === claim.id ? null : claim.id)}>
                  {t('expenses.approvals.previewEvidence', 'Preview claim evidence')}
                </Button>
              </div>
              {evidenceClaimId === claim.id && <ExpenseClaimEvidencePreview claim={claim} />}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
};
