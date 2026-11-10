import React from 'react';
import { HelpPopover } from './HelpPopover';
import { FigureHelpList, useFigureScope } from './FigureScope';
import { cn } from './cn';

export interface PageHeaderProps {
  /** The page title. */
  title: React.ReactNode;
  /** 1 for a route's own page (default), 2 for a page embedded inside another. */
  headingLevel?: 1 | 2;
  /** Quiet figure beside the title, e.g. a count chip. */
  count?: React.ReactNode;
  /** The ONE filled primary action of the page ("New project"), top right. */
  action?: React.ReactNode;
  /**
   * The ONE help control of the page: what a definition or caveat on this screen means. Opens from a
   * "?" beside the title. Per-tile and per-column "?" icons do not exist: inside a `FigureScope`, the
   * help text of the figure tiles is appended to this popover automatically.
   */
  help?: React.ReactNode;
  /** Names the help button ("About {{subject}}"); defaults to a string title. */
  helpSubject?: string;
  /**
   * @deprecated Removed: no sentence sits under a page title (screen rule "Words"). Kept as a typed no-op
   * because ~80 callers still pass one; `scripts/check-date-formatting.mjs` lists them and blocks new ones.
   */
  subtitle?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * The page title row: title, the one primary action, at most one help control. Nothing else:
 * no subtitle, no stats, no status (a record's status lives in `RecordHeader`).
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  headingLevel = 1,
  count,
  action,
  help,
  helpSubject,
  className,
  'data-testid': dataTestId = 'page-header',
}) => {
  const hasFigureHelp = (useFigureScope()?.help.length ?? 0) > 0;
  const hasHelp = (help != null && help !== false) || hasFigureHelp;
  return (
  <div data-testid={dataTestId} className={cn('mb-4 flex flex-wrap items-center justify-between gap-3', className)}>
    <div className="flex min-w-0 items-center gap-2.5">
      {headingLevel === 2 ? (
        <h2 className="text-[18px] font-semibold">{title}</h2>
      ) : (
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">{title}</h1>
      )}
      {count != null && count !== false && (
        <span
          data-testid="list-page-count"
          className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-secondary px-2 text-[12.5px] font-semibold tabular text-muted-foreground"
        >
          {count}
        </span>
      )}
      {hasHelp && (
        <HelpPopover subject={helpSubject ?? (typeof title === 'string' ? title : '')}>
          {help}
          <FigureHelpList />
        </HelpPopover>
      )}
    </div>
    {action}
  </div>
  );
};

PageHeader.displayName = 'PageHeader';
