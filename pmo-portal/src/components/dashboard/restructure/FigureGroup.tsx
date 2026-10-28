import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui/ListState';
import { Tooltip } from '@/src/components/ui/Tooltip';
import { Icon } from '@/src/components/ui/icons';

export interface DashboardFigure {
  id: string;
  label: string;
  /** Null means the source cannot prove a value; it is rendered as an explained dash. */
  value: React.ReactNode | null;
  subline?: React.ReactNode;
  href?: string;
  unavailableReason?: string;
  title?: string;
  help?: string;
}

export interface FigureGroupProps {
  heading: string;
  basis?: string;
  figures: DashboardFigure[];
  isPending?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  className?: string;
  /** Let the containing area panel own the heading and basis line. */
  hideHeading?: boolean;
}

export const FigureGroup: React.FC<FigureGroupProps> = ({
  heading,
  basis,
  figures,
  isPending = false,
  isError = false,
  onRetry,
  className = '',
  hideHeading = false,
}) => {
  const { t } = useTranslation('dashboard');
  if (isPending) return <ListState variant="loading" rows={Math.max(figures.length, 2)} testId="figure-group-loading" className={className} />;
  if (isError) return (
    <ListState
      variant="error"
      title={t('figures.error', "Couldn't load these figures")}
      sub={t('figures.errorSub', 'Retry to check the latest figures.')}
      onRetry={onRetry}
      className={className}
    />
  );

  return (
    <section aria-label={basis ? `${heading} · ${basis}` : heading} className={className}>
      {!hideHeading && <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-[18px] font-semibold leading-[1.3]">{heading}</h2>
        {basis && <span className="text-[12px] text-muted-foreground">{basis}</span>}
      </div>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-4">
        {figures.map((figure) => {
          const value = figure.value === null ? (
            <span title={figure.unavailableReason ?? t('figures.unknownReason', 'The source could not provide this figure.')}>—
              <span className="sr-only"> {figure.unavailableReason ?? t('figures.unknownReason', 'The source could not provide this figure.')}</span>
            </span>
          ) : (
            <span title={figure.title}>{figure.value}</span>
          );
          const content = (
            <>
              <span className="flex min-h-11 items-center gap-1 text-[12px] text-muted-foreground">
                {figure.label}
                {figure.help && (
                  <Tooltip content={figure.help}>
                    <button type="button" aria-label={t('kpi.aboutMetric', 'About this metric') + ': ' + figure.label} className="touch-target grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                      <Icon name="help" className="size-3.5" />
                    </button>
                  </Tooltip>
                )}
              </span>
              <span className="mt-1 block text-[23px] font-bold leading-tight tabular">{value}</span>
              {figure.subline && <span className="mt-1 block text-[12px] text-muted-foreground">{figure.subline}</span>}
            </>
          );

          return (
            <div key={figure.id} className="min-w-0 border-b border-border/70 py-3">
              {figure.href ? (
                <Link to={figure.href} className="block min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:underline">
                  {content}
                </Link>
              ) : content}
            </div>
          );
        })}
      </div>
    </section>
  );
};
