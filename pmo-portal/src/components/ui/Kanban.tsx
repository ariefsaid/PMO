import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';

/** `target` = an allowed column with the dragged card over it right now. */
export type DropState = 'allowed' | 'target' | 'blocked';

export interface KanbanColumnProps {
  title: string;
  /** Stage dot color (token or sanctioned literal). */
  dotColor?: string;
  /** Optional probability chip (e.g. "60%"). */
  prob?: string;
  count: number;
  /** Optional totals line (e.g. value + weighted). */
  totals?: React.ReactNode;
  children?: React.ReactNode;
  /** Shown when the column has no cards. */
  emptyMessage?: string;
  /** Marks the column as the one a surrounding control (e.g. a funnel stage) has selected. */
  selected?: boolean;
  /** Flat separators for boards whose cards sit inside a shared panel surface. */
  presentation?: 'cards' | 'flat';
  /** Drag feedback while a card is being dragged (DND, #1637): where it may or may not land. */
  dropState?: DropState;
}

/** Base kanban column shell — sticky header, scrollable body. Surface issues
 *  fill the card content/variants. */
export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  title,
  dotColor = 'hsl(var(--muted-foreground))',
  prob,
  count,
  totals,
  children,
  emptyMessage = 'No items',
  selected = false,
  presentation = 'cards',
  dropState,
}) => {
  const { t } = useTranslation('boardDrag');
  const empty = React.Children.count(children) === 0;
  return (
    <div
      data-selected={selected ? 'true' : undefined}
      data-empty-column={empty ? 'true' : undefined}
      aria-current={selected ? 'true' : undefined}
      data-drop-state={dropState}
      className={cn(
        'flex min-w-0 flex-col',
        presentation === 'flat'
          ? ''
          : 'rounded-lg border border-transparent bg-secondary/50',
        // ring = the non-colour cue (matches the selected card treatment)
        selected && (presentation === 'flat'
          ? 'border-b-2 border-primary bg-primary/[0.04]'
          : 'border-primary ring-2 ring-primary/40 bg-primary/[0.04]'),
        dropState === 'allowed' && 'border-primary/60 ring-1 ring-primary/30',
        dropState === 'target' && 'border-primary bg-primary/[0.08] ring-2 ring-primary/60',
        // dashed edge, not opacity: dimming text drops it under AA contrast (axe, mid-drag)
        dropState === 'blocked' && 'border-dashed border-border',
      )}
    >
      <div className="kcol-head-sticky border-b border-border px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-[9px] shrink-0 rounded-full"
            style={{ background: dotColor }}
          />
          <span className="text-control font-bold tracking-[-0.01em]">{title}</span>
          {prob && (
            <span className="grid h-5 place-items-center rounded-full border border-border bg-background px-1.5 text-control font-bold text-muted-foreground">
              {prob}
            </span>
          )}
          <span className="ml-auto grid h-5 min-w-[22px] place-items-center rounded-full border border-border bg-background px-2 text-support font-bold text-muted-foreground tabular">
            {count}
          </span>
        </div>
        {totals && <div className="mt-2 flex items-baseline gap-2">{totals}</div>}
        {dropState && (
          <p className="mt-1 text-control text-muted-foreground">
            {dropState !== 'blocked' ? t('boardDrag:dropHere', 'Drop to move here') : t('boardDrag:cantMoveHere', "Can't move here")}
          </p>
        )}
      </div>
      <div
        role="group"
        aria-label={t('columnScrollRegion', '{{title}} column, scrollable vertically', { title })}
        tabIndex={0}
        className="flex min-h-[60px] flex-col gap-2 overflow-y-auto p-2"
      >
        {empty ? (
          <div className="py-6 text-center text-control text-muted-foreground">{emptyMessage}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
};

export interface KanbanCardProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  onActivate?: () => void;
}

/** Focusable, activatable kanban card with the deeper hover-lift. */
export const KanbanCard: React.FC<KanbanCardProps> = ({
  selected = false,
  onActivate,
  className,
  children,
  ...rest
}) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onActivate}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate?.();
      }
    }}
    className={cn(
      'relative cursor-pointer rounded-lg border border-border bg-card p-3 shadow-[0_1px_2px_hsl(240_6%_10%/0.04)] transition-[box-shadow,border-color,transform] duration-150',
      'hover:border-muted-foreground/35 hover:shadow-[0_4px_14px_hsl(240_6%_10%/0.1)] active:scale-[0.992]',
      selected && 'border-primary ring-2 ring-primary/40 bg-primary/[0.04]',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);

/**
 * Horizontal-scroll kanban grid wrapper. `data-more-right` is set while columns run off the right
 * edge (the CSS fades the edge only then). `narrowEmpty` shrinks empty columns (still drop targets).
 */
export const Kanban: React.FC<React.HTMLAttributes<HTMLDivElement> & { narrowEmpty?: boolean }> = ({
  className,
  children,
  narrowEmpty,
  ...rest
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMoreRight(el.scrollWidth - el.scrollLeft - el.clientWidth > 1);
    update();
    el.addEventListener('scroll', update, { passive: true });
    // ponytail: ResizeObserver covers resize and column changes; absent in old test envs
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => { el.removeEventListener('scroll', update); ro?.disconnect(); };
  }, []);
  return (
    <div ref={ref} className="kanban-scroll" data-more-right={moreRight ? 'true' : undefined} {...rest}>
      <div className={cn('kanban', className)} data-narrow-empty={narrowEmpty ? 'true' : undefined}>{children}</div>
    </div>
  );
};
