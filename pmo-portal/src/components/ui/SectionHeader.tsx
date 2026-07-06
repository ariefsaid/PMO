import React from 'react';
import { cn } from './cn';

export interface SectionHeaderProps {
  /** The section title, rendered as an <h2>. */
  title: React.ReactNode;
  /** Optional trailing action slot (e.g. a "Grant credits" button) on the same row. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * The shared section-header molecule (`docs/decisions.md` "section-header molecule"): one
 * consistently-structured row — `<h2>` title + an optional trailing action slot — used by every
 * `/administration` section (Users, Credits, Usage, Features) so no section rolls its own
 * one-off header markup.
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, action, className }) => (
  <div className={cn('mb-2 flex flex-wrap items-center justify-between gap-3', className)}>
    <h2 className="text-[16px] font-semibold">{title}</h2>
    {action}
  </div>
);
