import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useMyStockLocations } from '@/src/hooks/useStock';
import { useProofStatus, useTransferSettings } from '@/src/hooks/useStockTransfers';
import { formatClockTime, formatDate } from '@/src/lib/format';
import type { ProofStatusRow } from '@/src/lib/db/stockTransfers';
import { byOldest, daysWaiting, missingRules } from './proofChase';

const FIRST = 5;

const hrefOf = (r: ProofStatusRow): string => (r.mode === 'two_step' ? `/stock/transfers/${r.movementId}` : `/stock/documents/${r.movementId}`);

/**
 * #2689: movements whose required proof has not arrived, on the stock home. Shown only while the organisation lets proof follow
 * (`may_follow`), to the people who can attach it (Admin: all; a keeper: movements at a location they keep). Anything else, a loading or
 * failed read, or an empty list renders nothing, so the stock home is unchanged for every other organisation.
 */
export const ProofChaseCard: React.FC = () => {
  const { t } = useTranslation('stock');
  const { realRole } = useEffectiveRole();
  const settings = useTransferSettings();
  const mine = useMyStockLocations();
  const [all, setAll] = React.useState(false);
  const mayFollow = settings.data?.proofTiming === 'may_follow';
  const isAdmin = realRole === 'Admin';
  const canAttach = isAdmin || mine.keepsAny;
  const proof = useProofStatus('outstanding', mayFollow && canAttach);
  if (!mayFollow || !canAttach || !proof.data) return null;
  const rows = proof.data
    .filter((r) => r.proofStatus === 'outstanding' && (isAdmin || mine.keeps(r.fromWarehouseId) || mine.keeps(r.toWarehouseId)))
    .sort(byOldest);
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, FIRST);
  const time = proof.dataUpdatedAt ? formatClockTime(new Date(proof.dataUpdatedAt)) : '';
  return (
    <section aria-label={t('proof.chase.title', { count: rows.length })} className="mb-4 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-semibold">{t('proof.chase.title', { count: rows.length })}</h2>
        {time && <span className="text-xs text-muted-foreground">{t('proof.chase.updated', { time })}</span>}
      </div>
      <ul className="mt-2 divide-y divide-border">
        {shown.map((r) => (
          <li key={r.movementId}>
            <Link to={hrefOf(r)} aria-label={`${t('proof.chase.go')}: ${r.number}`} className="block py-2 hover:bg-muted/40">
              <div className="flex flex-wrap items-center justify-between gap-x-3">
                <span className="font-medium">{r.number}</span>
                <span className="text-sm tabular-nums text-muted-foreground">{t('proof.chase.waiting', { count: daysWaiting(r.movementDate) })}</span>
              </div>
              <div className="text-sm">{r.fromWarehouseName} → {r.toWarehouseName}</div>
              <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                <span>{formatDate(r.movementDate)}</span>
                <span>{t('proof.chase.missing', { what: missingRules(r.missing).map((m) => t(`proof.rule.${m}`)).join(', ') })}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {rows.length > FIRST && (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setAll((v) => !v)}>
          {all ? t('proof.chase.showFewer') : t('proof.chase.showAll', { count: rows.length })}
        </Button>
      )}
    </section>
  );
};
