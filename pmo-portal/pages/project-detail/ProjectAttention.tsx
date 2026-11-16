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
  /** Sources still loading: rows from settled sources show, with one loading row for the rest. */
  pendingSources?: readonly string[];
  error?: { what: string; retry: () => unknown };
  className?: string;
  /** Share a desktop grid row's height with the money position; rows keep their natural height, the spare space stays below them. */
  fillRow?: boolean;
}> = ({ items, excludeKeys, isPending, pendingSources, error, className, fillRow = false }) => {
  const { t } = useTranslation('project');
  const title = t('projectDetail.attention.title', 'Needs attention');
  const hasPending = Boolean(isPending) && (pendingSources?.length ?? 0) > 0;
  const panel = (children: React.ReactNode, actions?: React.ReactNode) => (
    <RecordSection data-testid="needs-attention" headingId="pd-attention" title={title} actions={actions} className={cn(className, fillRow && 'flex h-full flex-col')} bodyClassName={fillRow ? 'flex flex-1 flex-col' : undefined}>
      {children}
    </RecordSection>
  );
  const errorLine = (extra?: string) => error && (
    <p className={cn('flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground', extra)}>
      <span>{t('projectDetail.attention.checkFailed', "Couldn't check {{what}}", { what: error.what })}</span>
      <Button variant="ghost" size="sm" onClick={() => void error.retry()}>{t('common.retry', 'Retry')}</Button>
    </p>
  );
  const visibleItems = excludeKeys ? items.filter((item) => !excludeKeys.has(item.key)) : items;
  // Rows already derived from settled sources stay on screen; only an empty card falls back to the whole skeleton / error.
  if (isPending && visibleItems.length === 0) return panel(<ListState variant="loading" shape="cards" rows={2} />);
  if (error && visibleItems.length === 0) return panel(errorLine());
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
  // The count waits until every source it counts has loaded.
  return panel(
    <>
      <ul data-testid="needs-attention-rows" className="divide-y divide-border/70">
        {visibleItems.map((item) => (
          <li key={item.key}>
            <Tooltip content={item.explanation ?? t('projectDetail.attention.rowTooltip', 'Status is based on project records and their current workflow state.')} block>
              <Link to={item.to} className="touch-target flex w-full items-center gap-x-4 py-2.5 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">{item.what}</span>
                  {item.size && <>{' '}<span className={cn('mt-0.5 block text-sm tabular-nums', item.tone === 'danger' ? 'text-destructive-text' : 'text-warning-foreground')}>{item.size.replace(/ · /gu, ' · ')}</span></>}
                </span>
                <span className="shrink-0 text-sm font-medium text-primary-text">{item.action}</span>
              </Link>
            </Tooltip>
          </li>
        ))}
      </ul>
      {hasPending && <ListState variant="loading" shape="cards" rows={1} testId="project-attention-pending" />}
      {errorLine('border-t border-border/70 pt-3')}
    </>,
    <Tooltip content={t('projectDetail.attention.countTooltip', 'Count of current project items that need follow-up.')}>
      {hasPending
        ? <span aria-busy="true" data-testid="project-attention-count-loading" className="inline-block h-4 w-5 animate-pulse rounded bg-muted align-middle" />
        : <span tabIndex={0} data-testid="project-attention-count" className="font-normal text-muted-foreground">{visibleItems.length}</span>}
    </Tooltip>,
  );
};
