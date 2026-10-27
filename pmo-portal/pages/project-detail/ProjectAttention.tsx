import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ListState, Tooltip } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import type { AttentionItem } from './useProjectPosition';

/** "Needs attention": what is wrong (with its status word), how big, and the verb that fixes it. */
export const ProjectAttention: React.FC<{
  items: AttentionItem[];
  excludeKeys?: ReadonlySet<string>;
  isPending?: boolean;
  error?: { what: string; retry: () => unknown };
  className?: string;
}> = ({ items, excludeKeys, isPending, error, className }) => {
  const { t } = useTranslation('project');
  if (isPending) {
    return (
      <section aria-labelledby="pd-attention" className={className}>
        <h2 id="pd-attention" className="mb-4 text-sm font-semibold text-foreground">{t('projectDetail.attention.title', 'Needs attention')}</h2>
        <ListState variant="loading" rows={2} />
      </section>
    );
  }
  if (error) {
    return (
      <section aria-label={t('projectDetail.attention.title', 'Needs attention')} className={className}>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span>{t('projectDetail.attention.checkFailed', "Couldn't check {{what}}", { what: error.what })}</span>
          <Button variant="ghost" size="sm" onClick={() => void error.retry()}>{t('common.retry', 'Retry')}</Button>
        </p>
      </section>
    );
  }
  const visibleItems = excludeKeys ? items.filter((item) => !excludeKeys.has(item.key)) : items;
  if (excludeKeys && visibleItems.length === 0) return null;
  if (visibleItems.length === 0) {
    return (
      <section aria-label={t('projectDetail.attention.title', 'Needs attention')} className={className}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="check" className="size-4 text-success-text" />
          {t('projectDetail.attention.onTrack', 'Nothing needs you on this project right now.')}
        </p>
      </section>
    );
  }
  // Flat rows: the status word sits in `what`; its size carries the status colour (UX SD1). No stripes, no pills.
  return (
    <section aria-labelledby="pd-attention" className={className}>
      <h2 id="pd-attention" className="mb-4 text-sm font-semibold text-foreground">
        {t('projectDetail.attention.title', 'Needs attention')}{' '}
        <Tooltip content={t('projectDetail.attention.countTooltip', 'Count of current project items that need follow-up.')}>
          <span tabIndex={0} className="font-normal text-muted-foreground">{visibleItems.length}</span>
        </Tooltip>
      </h2>
      <ul className="divide-y divide-border/70 border-y border-border/70">
        {visibleItems.map((item) => (
          <li key={item.key}>
            <Tooltip content={item.explanation ?? t('projectDetail.attention.rowTooltip', 'Status is based on project records and their current workflow state.')} className="w-full">
              <Link to={item.to} className="touch-target flex items-baseline gap-x-4 py-3 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-foreground">{item.what}</span>
                  {item.size && <>{' '}<span className={cn('block text-xs font-medium tabular-nums sm:ml-3 sm:inline', item.tone === 'danger' ? 'text-destructive-text' : 'text-warning-foreground')}>{item.size}</span></>}
                </span>
                <span className="shrink-0 text-xs font-semibold text-primary-text">{item.action}</span>
              </Link>
            </Tooltip>
          </li>
        ))}
      </ul>
    </section>
  );
};
