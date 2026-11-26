import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import { formatNumberExact } from '@/src/lib/format';
import type { ScopeProgress } from '@/src/lib/workOrderProgress';

interface Props { projectId: string; progress: ScopeProgress | null; isPending: boolean; isError: boolean; onRetry: () => void }

/** Scope and progress (FR-WORP-020): BoQ lines on this work order with accepted-to-date quantity and percent. */
export const ScopeSection: React.FC<Props> = ({ projectId, progress, isPending, isError, onRetry }) => {
  const { t } = useTranslation('workOrders');
  const title = t('scope.title', 'Scope and progress');
  if (isPending) return <RecordSection title={title}><ListState variant="loading" rows={2} /></RecordSection>;
  if (isError || !progress) {
    return <RecordSection title={title}><ListState variant="error" title={t('scope.error', "Couldn't load the scope")} onRetry={onRetry} /></RecordSection>;
  }
  if (progress.lines.length === 0) {
    return (
      <RecordSection title={title}>
        <p className="text-control text-muted-foreground">
          {t('scope.empty', 'No contract lines are allocated to this work order yet.')}{' '}
          <Link className="underline" to={`/projects/${projectId}/work-orders`}>{t('scope.allocate', 'Allocate lines on the project')}</Link>
        </p>
      </RecordSection>
    );
  }
  const pct = (v: number | null) => (v == null ? '—' : `${formatNumberExact(Math.round(v * 10) / 10)}%`);
  return (
    <RecordSection title={title} subline={progress.overallPercent != null ? t('scope.overall', 'Overall {{pct}} complete', { pct: pct(progress.overallPercent) }) : undefined}>
      <div className="overflow-x-auto">
        <table className="w-full text-control" data-testid="scope-lines">
          <thead><tr className="text-muted-foreground">
            <th scope="col" className="pb-2 pr-4 text-left font-normal">{t('scope.col.line', 'Contract line')}</th>
            <th scope="col" className="pb-2 pr-4 text-right font-normal">{t('scope.col.accepted', 'Accepted')}</th>
            <th scope="col" className="w-20 pb-2 text-right font-normal">{t('scope.col.percent', 'Complete')}</th>
          </tr></thead>
          <tbody>
            {progress.lines.map((l) => (
              <tr key={l.id} className="border-t border-border" data-testid={`scope-line-${l.boqItemId}`}>
                <td className="py-2.5 pr-4 align-baseline">
                  <span className="whitespace-nowrap font-medium">{l.itemCode ?? '—'}</span>
                  {l.description && <span className="block text-muted-foreground sm:ml-2 sm:inline">{l.description}</span>}
                </td>
                <td className="whitespace-nowrap py-2.5 pr-4 text-right align-baseline tabular-nums">
                  {l.lumpSum
                    ? t('scope.lump', '{{done}} of {{all}}', { done: pct(l.accepted * 100), all: pct(l.allocated * 100) })
                    : t('scope.qty', '{{done}} of {{all}} {{unit}}', { done: formatNumberExact(l.accepted), all: formatNumberExact(l.allocated), unit: l.unit ?? '' })}
                </td>
                <td className="py-2.5 text-right align-baseline font-medium tabular-nums" data-testid={`scope-pct-${l.boqItemId}`}>{pct(l.percent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RecordSection>
  );
};
