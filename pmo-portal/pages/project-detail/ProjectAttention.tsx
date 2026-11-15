import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ListState, RecordSection, Tooltip } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import type { AttentionItem } from '@/src/hooks/useProjectPosition';

/** "Needs attention": what is wrong (with its status word), how big, and the verb that fixes it. */
export const ProjectAttention: React.FC<{
  items: AttentionItem[];
  excludeKeys?: ReadonlySet<string>;
  isPending?: boolean;
  error?: { what: string; retry: () => unknown };
  className?: string;
  /** Let the visible rows share a desktop grid row with the money position. */
  fillRow?: boolean;
}> = ({ items, excludeKeys, isPending, error, className, fillRow = false }) => {
  const { t } = useTranslation('project');
  const title = t('projectDetail.attention.title', 'Needs attention');
  const panel = (children: React.ReactNode, actions?: React.ReactNode) => (
    <RecordSection headingId="pd-attention" title={title} actions={actions} className={cn(className, fillRow && 'flex h-full flex-col')} bodyClassName={fillRow ? 'flex flex-1 flex-col' : undefined}>
      {children}
    </RecordSection>
  );
  if (isPending) return panel(<ListState variant="loading" shape="cards" rows={2} />);
  if (error) {
    return panel(
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <span>{t('projectDetail.attention.checkFailed', "Couldn't check {{what}}", { what: error.what })}</span>
        <Button variant="ghost" size="sm" onClick={() => void error.retry()}>{t('common.retry', 'Retry')}</Button>
      </p>,
    );
  }
  const visibleItems = excludeKeys ? items.filter((item) => !excludeKeys.has(item.key)) : items;
  if (excludeKeys && visibleItems.length === 0) return null;
  if (visibleItems.length === 0) {
    return panel(
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="check" className="size-4 text-success-text" />
        {t('projectDetail.attention.onTrack', 'Nothing needs you on this project right now.')}
      </p>,
    );
  }
  // Flat rows: the status word sits in `what`; its size carries the status colour (UX SD1). No stripes, no pills.
  return panel(
    <ul className={cn('divide-y divide-border/70', fillRow && 'flex flex-1 flex-col')}>
      {visibleItems.map((item) => (
        <li key={item.key} className={fillRow ? 'flex flex-1' : undefined}>
          <Tooltip content={item.explanation ?? t('projectDetail.attention.rowTooltip', 'Status is based on project records and their current workflow state.')} block>
            <Link to={item.to} className={cn('touch-target flex items-baseline gap-x-4 py-3 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', fillRow && 'flex-1 items-center')}>
              <span className="min-w-0 flex-1">
                <span className="text-sm font-semibold text-foreground">{item.what}</span>
                {item.size && <>{' '}<span className={cn('mt-0.5 block text-sm font-medium tabular-nums', item.tone === 'danger' ? 'text-destructive-text' : 'text-warning-foreground')}>{item.size}</span></>}
              </span>
              <span className="shrink-0 text-sm font-semibold text-primary-text">{item.action}</span>
            </Link>
          </Tooltip>
        </li>
      ))}
    </ul>,
    <Tooltip content={t('projectDetail.attention.countTooltip', 'Count of current project items that need follow-up.')}>
      <span tabIndex={0} className="font-normal text-muted-foreground">{visibleItems.length}</span>
    </Tooltip>,
  );
};
