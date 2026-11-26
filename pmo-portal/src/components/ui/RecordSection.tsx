import React from 'react';
import { cn } from './cn';

/**
 * RecordSection: the ONE section of a record page. A record page is a header panel plus these panels;
 * nothing sits bare on the page background.
 *
 *   ┌──────────────────────────────────────────┐
 *   │ Heading (on the panel inset)    [actions]│   ← 12–16px from the heading text; heading and actions share one baseline, wrapped actions sit 12px under it
 *   │ content on the same inset  — or, flush —  │
 *   ├──────────────────────────────────────────┤
 *   │ table cell text starts on the inset       │   ← `flush`: table touches the panel edges
 *   └──────────────────────────────────────────┘
 *
 * The section is a labelled region (named by its title). API (kept small on purpose):
 *   • `title`   the heading text (an h2; the accessible name stays the title alone).
 *   • `actions` optional controls on the heading's right (one per section; a record action never sits bare).
 *   • children  none = a heading-only panel (heading + its action, nothing under it).
 *   • `flush`   content spans edge to edge (a table whose first column text is on the inset).
 *               Default: content is padded to the same inset as the heading.
 * Panels stack with the section gap (32px) via `RecordStack`; the heading sits 12–16px above its content.
 */
export interface RecordSectionProps {
  title: React.ReactNode;
  actions?: React.ReactNode;
  flush?: boolean;
  /** One muted line under the heading (a unit or basis said once), outside the heading's accessible name. */
  subline?: React.ReactNode;
  /** Stable id for the heading, for callers whose anchors or tests address the region by it. */
  headingId?: string;
  /** Extra classes on the content wrapper (a panel that fills its grid row stretches its content). */
  bodyClassName?: string;
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

export const RecordSection: React.FC<RecordSectionProps> = ({ title, actions, flush = false, subline, headingId: headingIdProp, bodyClassName, children, className, 'data-testid': testId }) => {
  const autoId = React.useId();
  const headingId = headingIdProp ?? autoId;
  const hasBody = children != null && children !== false;
  return (
  <section data-testid={testId} aria-labelledby={headingId} className={cn('panel-card overflow-hidden', className)}>
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-3 px-[var(--panel-inset)] pt-[var(--panel-inset)]', hasBody ? 'pb-3' : 'pb-[var(--panel-inset)]')}>
      {subline != null && subline !== false
        ? <div className="min-w-0 flex-[1_1_auto]">
            <h2 id={headingId} className="text-group font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-control font-normal text-muted-foreground">{subline}</p>
          </div>
        : <h2 id={headingId} className="min-w-0 flex-[1_1_auto] text-group font-semibold text-foreground">{title}</h2>}
      {actions != null && actions !== false && <div data-testid="record-section-actions" className="ml-auto flex flex-wrap items-baseline justify-end gap-2 max-sm:has-[[data-actions-wide]]:w-full">{actions}</div>}
    </div>
    {hasBody && (
      <div data-flush={flush ? 'true' : undefined} className={cn(flush ? 'p-0 [--table-cell-inset:var(--panel-inset)] [&_li[data-record-row]:first-child]:pt-1' : 'px-[var(--panel-inset)] pb-[var(--panel-inset)]', bodyClassName)}>{children}</div>
    )}
  </section>
  );
};

/** The vertical rhythm of a record page: panels 32px apart (the section gap), nothing else between them. */
export const RecordStack: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('flex flex-col gap-[var(--space-section)]', className)}>{children}</div>
);
