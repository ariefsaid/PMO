import React from 'react';
import { useTranslation } from 'react-i18next';
import { RecordMenu, type RecordMenuItem } from './RecordMenu';
import { cn } from './cn';

export type { RecordMenuItem };

/** One fact in the key-facts row: a short label over its value. */
export interface PageStat {
  label: string;
  value: React.ReactNode;
}

export interface RecordHeaderProps {
  /** Leading icon tile glyph or node; omit (or null) inside drawers, where the tile is decoration. */
  icon?: React.ReactNode;
  iconColor?: string;
  /** The record's title (an h1; 24px on a page). */
  name: React.ReactNode;
  /** 2 when the page already carries its own h1 above (a record whose number is the page title). */
  headingLevel?: 1 | 2;
  /** Status pill, mandatory on every record. Use `<StatusPill record=... state=... />` so the colour comes from the shared map. */
  status: React.ReactNode;
  /** Keep a long record name full width on mobile, with status below its identity line. */
  statusBelowMetaOnMobile?: boolean;
  /** Phone: the name takes at most two lines with the status under it; a tap on a cut name shows it whole. */
  clampNameOnMobile?: boolean;
  /** Quiet identity line under the title (reference number, client). Not a sentence. */
  meta?: React.ReactNode;
  metaId?: string;
  /** Render the identity line under the whole title row (full width, beneath the actions) instead of under the title only. */
  metaFullWidth?: boolean;
  /** The key-facts row under the title (label + value pairs). */
  stats?: PageStat[];
  /** The ONE filled primary action of the record (right side, before the overflow menu). */
  primaryAction?: React.ReactNode;
  /** Every other action, as an overflow menu (Base UI Menu: focus, keyboard, dismissal, positioning). No items, no trigger. */
  menuItems?: RecordMenuItem[];
  /** Accessible name of the overflow trigger. */
  menuLabel?: string;
  /**
   * @deprecated Legacy free-form action slot (several buttons in a row). A record has ONE filled
   * `primaryAction` and the rest in `menuItems`; callers still on this slot are switched by the screen sweeps.
   * Wrapped in a `data-testid="record-header-actions"` slot so the placement contract is testable.
   */
  actions?: React.ReactNode;
  /** Preserve an existing direct action's position after the primary action during a staged migration. */
  actionsAfterPrimary?: boolean;
  /**
   * `page` (default) renders the bordered card header used on `/x/:id` pages.
   * `drawer` drops the card chrome so the host Drawer supplies its own border seam, and puts the
   * actions on their own row so the name is never truncated by them.
   */
  variant?: 'page' | 'drawer';
  /** Page variant: keep the action zone on the title row at every width (a phone's lone ⋯ never gets its own row). */
  actionsOnTitleRow?: boolean;
  /** Page variant: pad the panel on the panel inset (24px desktop / 16px phone) so it shares its left edge with `RecordSection` panels. */
  panelInset?: boolean;
  /** A block under the identity row (and the facts), after a rule: a record's stage track or status steps. */
  band?: React.ReactNode;
  /** Notes that belong to the record (one muted line each), inside the header panel under the facts. */
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * RecordHeader: the ONE header for a record (project, purchase, company, invoice, document, meeting).
 *
 *   [icon] Title  [status pill]                [primary action] [⋯]
 *          identity line
 *   ── key facts: label over value, label over value … ──
 *
 * One filled action at most; everything else lives in the menu. Callers pass the pill from the shared
 * status map so the same state is the same colour and name on every screen.
 */
export const RecordHeader: React.FC<RecordHeaderProps> = ({
  icon,
  iconColor,
  name,
  headingLevel = 1,
  status,
  statusBelowMetaOnMobile = false,
  clampNameOnMobile = false,
  meta,
  metaId,
  metaFullWidth = false,
  stats,
  primaryAction,
  menuItems,
  menuLabel,
  actions,
  actionsAfterPrimary = false,
  variant = 'page',
  actionsOnTitleRow = false,
  panelInset = false,
  band,
  children,
  className,
  'data-testid': dataTestId = 'record-header',
}) => {
  const { t } = useTranslation();
  const label = menuLabel ?? t('uxs14.moreActions', 'More actions');
  const hasMenu = Boolean(menuItems && menuItems.length > 0);
  const isDrawer = variant === 'drawer';
  const Heading = headingLevel === 2 ? 'h2' : 'h1';
  const [nameOpen, setNameOpen] = React.useState(false);
  const zone = actions || primaryAction || hasMenu ? (
    <span data-testid="record-header-actions" className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {actionsAfterPrimary ? <>{primaryAction}{actions}</> : <>{actions}{primaryAction}</>}
      {hasMenu && <RecordMenu items={menuItems!} ariaLabel={label} />}
    </span>
  ) : undefined;
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        // The drawer host already supplies a border-bottom seam + popover surface (no double border / nested radius).
        !isDrawer && 'mb-[var(--space-section)] rounded-lg border border-border bg-card', !isDrawer && (panelInset ? 'p-[var(--panel-inset)]' : 'p-[var(--space-content-inset)]'),
        isDrawer && '[&_h1]:text-control [&_h1]:font-semibold [&_h1]:leading-5',
        className,
      )}
    >
      {/* Narrow widths: the record name gets width priority; the action zone can wrap below. */}
      <div className="flex flex-wrap items-start gap-[var(--space-group)]">
        {icon && (
          <span
            className="grid size-11 shrink-0 place-items-center rounded-[10px] text-section font-bold text-primary-foreground [&_svg]:size-5"
            style={{ background: iconColor ?? 'hsl(var(--primary))' }}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className={cn(
            'min-w-0 gap-2',
            statusBelowMetaOnMobile
              ? 'grid grid-cols-[minmax(0,1fr)_auto] items-baseline sm:flex sm:flex-nowrap'
              : 'flex flex-nowrap items-baseline',
            clampNameOnMobile && 'max-sm:flex-col max-sm:items-start max-sm:gap-1',
          )}>
            <Heading
              title={clampNameOnMobile && typeof name === 'string' ? name : undefined}
              onClick={clampNameOnMobile ? () => setNameOpen((open) => !open) : undefined}
              className={cn(
              'min-w-0 text-page font-semibold',
              statusBelowMetaOnMobile
                ? 'col-span-2 row-start-1 break-words sm:col-span-1 sm:row-start-auto sm:flex-[0_1_auto]'
                : 'flex-[0_1_auto] truncate',
              clampNameOnMobile && cn('max-sm:max-w-full max-sm:whitespace-normal max-sm:break-words', !nameOpen && 'max-sm:line-clamp-2'),
              !isDrawer && 'sm:truncate',
            )}>{name}</Heading>
            {status != null && status !== false && <span className={cn(
              'shrink-0 self-baseline',
              statusBelowMetaOnMobile && 'col-span-2 row-start-3 justify-self-start sm:col-span-1 sm:row-start-auto',
            )}>{status}</span>}
          </div>
          {meta && !metaFullWidth && <div id={metaId} className={cn(
            'mt-1 text-control font-normal text-muted-foreground',
            statusBelowMetaOnMobile && 'col-span-2 row-start-2 sm:row-start-auto',
          )}>{meta}</div>}
        </div>
        {zone && <div className={cn('flex shrink-0 items-center gap-2', actionsOnTitleRow ? 'ml-auto max-w-full' : cn('w-full', !isDrawer && 'ml-auto sm:w-auto'))}>{zone}</div>}
      </div>
      {meta && metaFullWidth && <div id={metaId} className="mt-1 text-control font-normal text-muted-foreground">{meta}</div>}
      {stats && stats.length > 0 && (
        <div
          className="mt-4 grid gap-4 border-t border-border pt-4"
          // Wraps to as many columns as fit (two on a phone) instead of squeezing five facts into 390px.
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))' }}
        >
          {stats.map((s, i) => (
            <div key={i}>
              <div className="mb-1 text-control font-medium text-foreground">{s.label}</div>
              <div className="text-group font-semibold tabular">{s.value}</div>
            </div>
          ))}
        </div>
      )}
      {band != null && band !== false && <div data-testid="record-header-band" className="mt-4 border-t border-border pt-4">{band}</div>}
      {children != null && children !== false && <div data-testid="record-header-notes" className="mt-3 flex flex-col gap-1 text-control text-muted-foreground">{children}</div>}
    </div>
  );
};

RecordHeader.displayName = 'RecordHeader';
