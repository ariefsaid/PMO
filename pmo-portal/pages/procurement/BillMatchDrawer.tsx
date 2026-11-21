import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Drawer, ListState, StatusPill, TextArea, type StatusVariant } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useApproveBillMatchException, useBillMatches } from '@/src/hooks/useThreeWayMatch';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay, formatNumberExact } from '@/src/lib/format';
import type { BillMatchLineReason, BillMatchReason, BillMatchStatus } from '@/src/lib/repositories/threeWayMatch';

/**
 * #2622 (FR-TWM-005/006/008/009, OQ-TWM-3): one vendor bill's three-way match — per line what was ordered, received and
 * billed, the reasons it is held, and (for an eligible Admin or Finance user) Approve exception with a reason. The
 * database evaluates the match, holds the payment and enforces who may approve (1018); this screen only shows and asks.
 */
export interface BillMatchDrawerProps {
  invoiceId: string;
  /** The bill's own number or reference, for the title. */
  billLabel: string;
  onClose: () => void;
}

const REASON_MAX = 1000;
const STATUS_VARIANT: Record<BillMatchStatus, StatusVariant> = { held: 'lost', matched: 'won', exception_approved: 'neutral', not_applicable: 'neutral' };

export const BillMatchDrawer: React.FC<BillMatchDrawerProps> = ({ invoiceId, billLabel, onClose }) => {
  const { t } = useTranslation(['common', 'procurement']);
  const may = usePermission();
  const [query] = useBillMatches([invoiceId], true);
  const approve = useApproveBillMatchException();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [approveError, setApproveError] = useState<string | null>(null);

  const statusText: Record<BillMatchStatus, string> = {
    held: t('procurement:threeWayMatch.status.held', 'Held'),
    matched: t('procurement:threeWayMatch.status.matched', 'Matched'),
    exception_approved: t('procurement:threeWayMatch.status.exceptionApproved', 'Exception approved'),
    not_applicable: t('procurement:threeWayMatch.status.notApplicable', 'Not matched'),
  };
  const reasonText: Record<BillMatchReason | BillMatchLineReason, string> = {
    no_lines: t('procurement:threeWayMatch.reason.noLines', 'No match lines recorded'),
    amount_mismatch: t('procurement:threeWayMatch.reason.amountMismatch', 'Bill amount differs from its lines'),
    not_on_order: t('procurement:threeWayMatch.reason.notOnOrder', 'Not on the order'),
    over_received: t('procurement:threeWayMatch.reason.overReceived', 'Billed more than received'),
    over_ordered: t('procurement:threeWayMatch.reason.overOrdered', 'Billed more than ordered'),
    price_variance: t('procurement:threeWayMatch.reason.priceVariance', 'Rate above the order rate'),
  };
  const refusals: Record<string, string> = {
    'three-way-match-own-bill': t('procurement:threeWayMatch.refusal.ownBill', 'You recorded this bill or its lines. A different Admin or Finance user approves its exception.'),
    'three-way-match-author-unknown': t('procurement:threeWayMatch.refusal.authorUnknown', "This bill's author is not recorded, so no exception can be approved."),
    '23505': t('procurement:threeWayMatch.refusal.alreadyApproved', 'An exception was already approved for this bill.'),
    MH002: t('procurement:threeWayMatch.refusal.notHeld', 'This bill is not held, so there is nothing to approve.'),
    '22023': t('procurement:threeWayMatch.refusal.reason', 'Give a reason of up to 1,000 characters.'),
    '42501': t('procurement:threeWayMatch.refusal.role', 'Only an Admin or Finance user approves an exception.'),
  };
  const qty = (v: string | null) => (v === null ? '—' : formatNumberExact(Number(v)));

  const match = query?.data;
  const canApprove = may('approve', 'billMatch') && match?.status === 'held';
  const reasonTrimmed = reason.trim();
  const reasonTooLong = reasonTrimmed.length > REASON_MAX;

  const runApprove = async () => {
    setApproveError(null);
    try {
      await approve.mutateAsync({ invoiceId, reason: reasonTrimmed });
      setConfirming(false);
      setReason('');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err, refusals);
      setApproveError(refusals[(err as { code?: string })?.code ?? ''] ?? `${headline} ${detail ?? ''}`.trim());
    }
  };

  return <>
    <Drawer open width="lg" onClose={onClose} nestedOpen={confirming}
      title={t('procurement:threeWayMatch.title', 'Three-way match · {{bill}}', { bill: billLabel })}
      status={match ? <StatusPill variant={STATUS_VARIANT[match.status]}>{statusText[match.status]}</StatusPill> : undefined}
      headerActions={canApprove ? <Button variant="primary" size="sm" onClick={() => { setApproveError(null); setConfirming(true); }}>
        {t('procurement:threeWayMatch.approve', 'Approve exception')}
      </Button> : undefined}>
      <div className="space-y-4 p-4 text-sm" data-testid="bill-match">
        {query?.isError ? (
          <ListState variant="error" title={t('procurement:threeWayMatch.loadError', "Couldn't load this bill's match")} retryLabel={t('admin.retry', 'Retry')} onRetry={() => void query.refetch()} />
        ) : !match ? (
          <ListState variant="loading" rows={3} />
        ) : <>
          {match.status === 'held' && <p role="status">{t('procurement:threeWayMatch.heldLine', 'Payments on this purchase are held until this bill matches or an exception is approved.')}</p>}
          {match.status === 'not_applicable' && <p className="text-muted-foreground">{t('procurement:threeWayMatch.notApplicableLine', 'This bill is outside the three-way match.')}</p>}
          {match.reasons.length > 0 && <ul className="list-disc pl-5" aria-label={t('procurement:threeWayMatch.reasons', 'Why it is held')}>
            {match.reasons.map((r) => <li key={r}>{reasonText[r] ?? r}</li>)}
          </ul>}
          {match.lines.length > 0 && <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-normal">{t('procurement:threeWayMatch.col.item', 'Item')}</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">{t('procurement:threeWayMatch.col.ordered', 'Ordered')}</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">{t('procurement:threeWayMatch.col.received', 'Received')}</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">{t('procurement:threeWayMatch.col.billedToDate', 'Billed to date')}</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">{t('procurement:threeWayMatch.col.orderRate', 'Order rate')}</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">{t('procurement:threeWayMatch.col.billRate', 'Bill rate')}</th>
              </tr></thead>
              <tbody>
                {match.lines.map((l) => <React.Fragment key={l.itemId}>
                  <tr className="border-t border-border" data-testid={`bill-match-line-${l.itemId}`}>
                    <th scope="row" className="py-2 pr-3 text-left font-medium">{l.itemName ?? reasonText.not_on_order}</th>
                    <td className="py-2 pr-3 text-right tabular-nums">{qty(l.ordered)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{qty(l.received)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{qty(l.billedToDate)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{qty(l.orderRate)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{qty(l.billRate)}</td>
                  </tr>
                  {l.reasons.length > 0 && <tr><td colSpan={6} className="pb-2 text-destructive-text">{l.reasons.map((r) => reasonText[r] ?? r).join(' · ')}</td></tr>}
                </React.Fragment>)}
              </tbody>
            </table>
          </div>}
          {match.quantityTolerancePct !== null && <p className="text-muted-foreground">{t('procurement:threeWayMatch.tolerances', 'Tolerance: quantity {{qty}}% · amount {{amount}}%', {
            qty: formatNumberExact(Number(match.quantityTolerancePct)), amount: formatNumberExact(Number(match.amountTolerancePct ?? 0)),
          })}</p>}
          {match.exception && <p data-testid="bill-match-exception">{t('procurement:threeWayMatch.exceptionLine', 'Exception approved {{date}}: {{reason}}', {
            date: formatDay(match.exception.approvedAt), reason: match.exception.reason,
          })}</p>}
        </>}
      </div>
    </Drawer>
    <ConfirmDialog open={confirming} tone="default"
      title={t('procurement:threeWayMatch.confirmTitle', 'Approve an exception for {{bill}}?', { bill: billLabel })}
      description={<div className="space-y-3">
        <p>{t('procurement:threeWayMatch.confirmDescription', 'Payments on this purchase can then go ahead. The approval is permanent and recorded with your reason. You cannot approve a bill you recorded or whose lines you recorded.')}</p>
        <TextArea id="bill-match-exception-reason" label={t('procurement:threeWayMatch.reasonLabel', 'Reason')} value={reason} onChange={setReason} required rows={3}
          error={reasonTooLong ? refusals['22023'] : undefined} />
      </div>}
      error={approveError ?? undefined}
      confirmLabel={t('procurement:threeWayMatch.approve', 'Approve exception')}
      confirmDisabled={!reasonTrimmed || reasonTooLong}
      loading={approve.isPending}
      onConfirm={() => void runApprove()}
      onCancel={() => { setConfirming(false); setApproveError(null); }} />
  </>;
};
