import React from 'react';
import { useTranslation } from 'react-i18next';
import { RecordMenu, type RecordMenuItem } from './RecordMenu';
import { PageHeader, type PageStat } from './PageHeader';
import { cn } from './cn';

export type { RecordMenuItem };

export interface RecordHeaderProps {
  /** Leading icon tile glyph or node; omitted (null) inside drawers, where the tile is decoration. */
  icon: React.ReactNode;
  iconColor?: string;
  name: React.ReactNode;
  /** Status pill — mandatory on every record (DESIGN.md §7 RecordHeader anatomy). */
  status: React.ReactNode;
  /** Keep a long record name full width on mobile, with status below its metadata. */
  statusBelowMetaOnMobile?: boolean;
  meta?: React.ReactNode;
  metaId?: string;
  /** The key-facts row under the title (label + value pairs). */
  stats?: PageStat[];
  /** The ONE primary action of the record (right side, before the overflow menu). */
  primaryAction?: React.ReactNode;
  /** Overflow menu items (Base UI Menu: focus, keyboard, dismissal, positioning). No items, no trigger. */
  menuItems?: RecordMenuItem[];
  /** Accessible name of the overflow trigger. */
  menuLabel?: string;
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
  statusBelowMetaOnMobile = false,
  meta,
  metaId,
  stats,
  primaryAction,
  menuItems,
  menuLabel,
  actions,
  variant = 'page',
  className,
}) => {
  const { t } = useTranslation();
  const label = menuLabel ?? t('uxs14.moreActions', 'More actions');
  const hasMenu = Boolean(menuItems && menuItems.length > 0);
  const zone = actions || primaryAction || hasMenu ? (
    <span data-testid="record-header-actions" className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {actions}
      {primaryAction}
      {hasMenu && <RecordMenu items={menuItems!} ariaLabel={label} />}
    </span>
  ) : undefined;
  return (
  <PageHeader
    data-testid="record-header"
    // The drawer host already supplies a border-bottom seam + popover surface, so the
    // drawer variant drops the standalone card chrome (no double border / nested radius).
    surface={variant === 'drawer' ? 'bare' : 'card'}
    actionsBelow={variant === 'drawer'}
    icon={icon}
    iconColor={iconColor}
    name={name}
    status={status}
    statusInline
    statusBelowMetaOnMobile={statusBelowMetaOnMobile}
    meta={meta}
    metaId={metaId}
    stats={stats}
    actions={zone}
    className={cn(
      variant === 'drawer' && '[&_h1]:text-control [&_h1]:font-semibold [&_h1]:leading-5',
      className,
    )}
  />
  );
};

RecordHeader.displayName = 'RecordHeader';
