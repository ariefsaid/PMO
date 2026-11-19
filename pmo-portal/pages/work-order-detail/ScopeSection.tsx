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
          <Link className="underline" to={`/projects/${projectId}?tab=work-orders`}>{t('scope.allocate', 'Allocate lines on the project')}</Link>
        </p>
      </RecordSection>
    );
  }
  const pct = (v: number | null) => (v == null ? '—' : `${formatNumberExact(Math.round(v * 10) / 10)}%`);
  return (
    <RecordSection title={title} subline={progress.overallPercent != null ? t('scope.overall', 'Overall {{pct}} complete', { pct: pct(progress.overallPercent) }) : undefined}>
      <ul className="divide-y divide-border" data-testid="scope-lines">
        {progress.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0" data-testid={`scope-line-${l.boqItemId}`}>
            <span className="min-w-0">
              <span className="font-medium">{l.itemCode ?? '—'}</span>
              {l.description && <span className="ml-2 text-muted-foreground">{l.description}</span>}
            </span>
            <span className="tabular-nums text-control">
              {l.lumpSum
                ? t('scope.lump', '{{done}} of {{all}}', { done: pct(l.accepted * 100), all: pct(l.allocated * 100) })
                : t('scope.qty', '{{done}} of {{all}} {{unit}}', { done: formatNumberExact(l.accepted), all: formatNumberExact(l.allocated), unit: l.unit ?? '' })}
              {' · '}<span data-testid={`scope-pct-${l.boqItemId}`}>{pct(l.percent)}</span>
            </span>
          </li>
        ))}
      </ul>
    </RecordSection>
  );
};
