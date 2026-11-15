import React from 'react';
import { cn } from './cn';

/**
 * RecordSection: the ONE section of a record page. A record page is a header panel plus these panels;
 * nothing sits bare on the page background.
 *
 *   ┌──────────────────────────────────────────┐
 *   │ Heading (on the panel inset)    [actions]│   ← 16px under the heading
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
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

export const RecordSection: React.FC<RecordSectionProps> = ({ title, actions, flush = false, children, className, 'data-testid': testId }) => {
  const headingId = React.useId();
  const hasBody = children != null && children !== false;
  return (
  <section data-testid={testId} aria-labelledby={headingId} className={cn('panel-card overflow-hidden', className)}>
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-2 px-[var(--panel-inset)] pt-[var(--panel-inset)]', hasBody ? 'pb-3' : 'pb-[var(--panel-inset)]')}>
      <h2 id={headingId} className="min-w-0 flex-[1_1_auto] text-group font-semibold text-foreground">{title}</h2>
      {actions != null && actions !== false && <div data-testid="record-section-actions" className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
    {hasBody && (
      <div data-flush={flush ? 'true' : undefined} className={flush ? 'p-0 [--table-cell-inset:var(--panel-inset)]' : 'px-[var(--panel-inset)] pb-[var(--panel-inset)]'}>{children}</div>
    )}
  </section>
  );
};

/** The vertical rhythm of a record page: panels 32px apart (the section gap), nothing else between them. */
export const RecordStack: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('flex flex-col gap-[var(--space-section)]', className)}>{children}</div>
);
