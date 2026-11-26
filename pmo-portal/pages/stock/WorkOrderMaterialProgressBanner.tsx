import React, { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { useWorkOrderMaterialProgress } from '@/src/hooks/useWorkOrderMaterialProgress';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatQuantity } from '@/src/lib/stockFormat';

/**
 * Warning above a work order's stock (#2674, FR-MIP-020): items issued further ahead of the work order's progress than the
 * organisation's threshold. Information only: it blocks nothing, and renders nothing when the threshold is unset, nothing warns,
 * or the read fails. Outside the app's providers there is nothing to read, so it renders nothing.
 */
const Inner: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const { t } = useTranslation('stock');
  const q = useWorkOrderMaterialProgress(workOrderId);
  const data = q.data;
  const warned = (data?.items ?? []).filter((i) => i.warn);
  if (!data || data.thresholdPct === null || data.progressPct === null || warned.length === 0) return null;
  const fmt = (n: number) => formatQuantity(String(n), getNumberLocale());
  return (
    <div role="status" className="rounded-lg border border-warning/40 bg-warning/12 px-3.5 py-3 text-control text-warning-foreground">
      <p className="font-semibold">{t('siteWork.materialProgress.banner.title', { count: warned.length })}</p>
      <p className="mt-1">{t('siteWork.materialProgress.banner.body', { threshold: fmt(data.thresholdPct), progress: fmt(data.progressPct) })}</p>
      <table className="mt-2 w-full max-w-xl text-control" aria-label={t('siteWork.materialProgress.banner.title', { count: warned.length })}>
        <thead><tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-4 font-normal">{t('siteWork.materialProgress.banner.item')}</th>
          <th scope="col" className="py-1 pl-4 text-right font-normal">{t('siteWork.materialProgress.banner.issued')}</th>
          <th scope="col" className="py-1 pl-4 text-right font-normal">{t('siteWork.materialProgress.banner.ahead')}</th>
        </tr></thead>
        <tbody>{warned.map((i) => (
          <tr key={i.itemId} className="border-t border-warning/30">
            <th scope="row" className="py-1 pr-4 text-left font-medium">{i.itemName}</th>
            <td className="py-1 pl-4 text-right tabular-nums">{fmt(i.issuedPct ?? 0)}%</td>
            <td className="py-1 pl-4 text-right tabular-nums">{t('siteWork.materialProgress.banner.points', { gap: fmt(i.gapPp ?? 0) })}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
};

export const WorkOrderMaterialProgressBanner: React.FC<{ workOrderId: string }> = ({ workOrderId }) => {
  const auth = useContext(AuthContext);
  const queries = useContext(QueryClientContext);
  const hasProviders = Boolean(auth) && Boolean(queries);
  return hasProviders ? <Inner workOrderId={workOrderId} /> : null;
};
