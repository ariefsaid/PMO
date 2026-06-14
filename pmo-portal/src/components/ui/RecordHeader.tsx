import React from 'react';
import { PageHeader, type PageStat } from './PageHeader';

export interface RecordHeaderProps {
  /** Leading icon tile glyph (a letter) or node. Mandatory by the RecordHeader contract. */
  icon: React.ReactNode;
  iconColor?: string;
  name: React.ReactNode;
  /** Status pill — mandatory on every record (DESIGN.md §7 RecordHeader anatomy). */
  status: React.ReactNode;
  meta?: React.ReactNode;
  /** Optional in-header metric strip. */
  stats?: PageStat[];
  /**
   * The fixed action zone (top-right): Edit + Archive/Delete by permission. Wrapped in a
   * `data-testid="record-header-actions"` slot so the placement contract is testable.
   */
  actions?: React.ReactNode;
  /**
   * `page` (default) renders the bordered `card` header used on `/x/:id` detail pages.
   * `drawer` drops the card chrome so the host Drawer supplies its own border-bottom seam
   * (the drawer header anatomy still reads icon + name + status + top-right actions).
   */
  variant?: 'page' | 'drawer';
  className?: string;
}

/**
 * RecordHeader — the ONE record-page header (DESIGN.md §7 / coherence-wave §3.1).
 *
 * A thin wrapper over `PageHeader` that enforces the canonical record anatomy —
 * `[icon tile] [name] [status pill] … [Edit] [Archive/Delete]` with actions top-right —
 * so every record (Project, Procurement, Company, Contact) opens with the SAME header.
 * `status` and `icon` are non-optional here (they are optional on the lower-level
 * `PageHeader`); the action zone is a standardized slot.
 */
export const RecordHeader: React.FC<RecordHeaderProps> = ({
  icon,
  iconColor,
  name,
  status,
  meta,
  stats,
  actions,
  variant = 'page',
  className,
}) => (
  <PageHeader
    data-testid="record-header"
    // The drawer host already supplies a border-bottom seam + popover surface, so the
    // drawer variant drops the standalone card chrome (no double border / nested radius).
    surface={variant === 'drawer' ? 'bare' : 'card'}
    icon={icon}
    iconColor={iconColor}
    name={name}
    status={status}
    meta={meta}
    stats={stats}
    actions={
      actions ? (
        <span data-testid="record-header-actions" className="flex items-center gap-2">
          {actions}
        </span>
      ) : undefined
    }
    className={className}
  />
);

RecordHeader.displayName = 'RecordHeader';
