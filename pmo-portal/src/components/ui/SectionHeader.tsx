import React from 'react';
import { cn } from './cn';

export interface SectionHeaderProps {
  /** The section title, rendered as an <h2>. */
  title: React.ReactNode;
  /** Optional trailing action slot (e.g. a "Grant credits" button) on the same row. */
  action?: React.ReactNode;
  /** Optional id for the heading, so a section can aria-labelledby it. */
  id?: string;
  className?: string;
}

/**
 * The shared section-header molecule (`docs/decisions.md` "section-header molecule"): one
 * consistently-structured row — `<h2>` title + an optional trailing action slot — used by every
 * `/administration` section (Users, Credits, Usage, Features) so no section rolls its own
 * one-off header markup.
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, action, id, className }) => (
  <div className={cn('mb-[var(--space-group)] flex flex-wrap items-center justify-between gap-[var(--space-group)]', className)}>
    <h2 id={id} className="text-group font-semibold">{title}</h2>
    {action}
  </div>
);
