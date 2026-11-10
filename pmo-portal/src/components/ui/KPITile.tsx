import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { cn } from './cn';
import { FigureContent } from './FigureContent';
import { Icon, type IconName } from './icons';
import { Tooltip } from './Tooltip';
import { useFigureReport, type HiddenFigure } from './useFigureScope';
import type { KPITone } from './KPITile.types';

// Re-exported (not duplicated) from the pure sibling file (see KPITile.types.ts doc comment) —
// still the single source of truth `registry.ts`'s `satisfies` drift guard relies on.
export type { KPITone };

/** Tinted icon-tile tones — all on-palette DESIGN.md hues (Wave-6 H1: off-palette cyan removed). */
const TONE_CLASS: Record<KPITone, string> = {
  blue: 'bg-primary/[0.12] text-primary',
  violet: 'bg-violet/[0.12] text-violet',
  amber: 'bg-warning/[0.18] text-warning-foreground',
  red: 'bg-destructive/[0.12] text-destructive',
  green: 'bg-success/[0.13] text-success',
};

/** @deprecated A second line on a tile. A tile has ONE caption: pass `caption`. */
export interface KPIDelta {
  dir: 'up' | 'down' | 'neutral';
  text: string;
}

export interface KPITileProps {
  icon: IconName;
  tone: KPITone;
  label: string;
  value: React.ReactNode;
  /** Full whole-unit amount metadata for compact money figures. */
  exactValue?: string;
  /**
   * Why the metric is unknown. The tile is then NOT drawn: inside a `FigureScope` it reports itself to the
   * page's one "N figures hidden: <reason>" line (`FigureHiddenLine`); outside one it shows the reason in place.
   * A tile with no `value` (null/undefined) is unknown too.
   */
  unavailableReason?: string;
  /** Where the unknown figure is fixed ("Set up"); shown as the link in the hidden-figures line. */
  hiddenLink?: { to: string; label: string };
  /** Negative values turn destructive (DESIGN.md). */
  negative?: boolean;
  /**
   * Definition of the figure. Inside a `FigureScope` it is not drawn on the tile: it is collected into the page's one
   * help control. Outside one it is still the old per-tile "?" (until the page adopts the scope).
   */
  help?: string;
  /** Names this figure in that help list; defaults to `label`. */
  helpLabel?: string;
  /** The tile's ONE caption (at most 6 words, truncated to one line). */
  caption?: string;
  /** @deprecated Use `caption`. */
  vs?: string;
  /** @deprecated A tile has one caption; the text is used as `caption` when none is given. */
  delta?: KPIDelta;
  /** Skeleton while the metric query loads. */
  loading?: boolean;
  /** When true, omits the value (fetch error state); the surrounding block carries the error. */
  error?: boolean;
  /**
   * When set, the tile has a full-surface router `<Link>` doorway (Wave-5 N15).
   * Help remains an independent button above the link, never nested in the anchor.
   */
  to?: string;
  /** Accessible name for the link variant (e.g. "Awaiting your approval: 3 items"). */
  linkLabel?: string;
  /** Test id on the tile root (for AC-tagged smoke assertions). */
  testId?: string;
  /** @deprecated Not drawn: a figure tile is label, value and one caption. */
  ctaLabel?: string;
  className?: string;
}

/** Inside a KPIRow the tiles become cells of one joined strip: no own frame, no decorative icon tile. */
/** The tile's one caption: a single truncated line. */
const Caption: React.FC<{ children: string }> = ({ children }) => (
  <div title={children} className="truncate text-[12px] text-muted-foreground">{children}</div>
);

const KPIRowContext = React.createContext(false);

export interface KPIRowProps {
  children: React.ReactNode;
  /** Column classes for the strip, e.g. `grid-cols-2 lg:grid-cols-4`. */
  className?: string;
  'aria-label'?: string;
}

/**
 * One figure row: tiles share a single bordered frame split by hairlines (the procurement summary strip),
 * so a row of figures reads as one group rather than a grid of identical cards. A last odd cell spans the
 * row on the two-column phone layout instead of leaving a grey hole.
 */
export const KPIRow: React.FC<KPIRowProps> = ({ children, className, 'aria-label': ariaLabel }) => (
  <section
    aria-label={ariaLabel}
    className={cn(
      'grid min-w-0 gap-px overflow-hidden rounded-lg border border-border bg-border [&>*]:bg-card max-sm:[&>*:last-child:nth-child(odd)]:col-span-full',
      className,
    )}
  >
    <KPIRowContext.Provider value>{children}</KPIRowContext.Provider>
  </section>
);

export function KPITile({
  icon,
  tone,
  label,
  value,
  exactValue,
  unavailableReason,
  negative = false,
  hiddenLink,
  help,
  helpLabel,
  caption: captionProp,
  vs,
  delta,
  loading = false,
  error = false,
  to,
  linkLabel,
  testId,
  className,
}: KPITileProps) {
  const { t } = useTranslation();
  const inRow = React.useContext(KPIRowContext);
  const caption = captionProp ?? vs ?? delta?.text;
  const unknown = !loading && !error && (unavailableReason != null || value == null);
  const hiddenEntry: HiddenFigure[] = unknown
    ? [{ label, reason: unavailableReason ?? '', ...(hiddenLink ? { link: hiddenLink } : {}) }]
    : [];
  const inScope = useFigureReport(hiddenEntry, help && !unknown ? [{ label: helpLabel ?? label, text: help }] : []);
  if (unknown && inScope) return null;
  const isLink = to != null;
  const rootClass = cn(
    'relative flex min-w-0 flex-col gap-2.5 bg-card px-4 pb-3.5 pt-4',
    !inRow && 'rounded-lg border border-border',
    // Hover-lift is an interaction affordance — only a drillable (link) tile gets it,
    // so a plain tile reads as a static surface and never promises a click it can't honor
    // (design-review I1: shared hover lift was a false affordance on plain tiles).
    isLink && (inRow ? 'transition-colors duration-150 hover:bg-accent/60' : 'transition-shadow duration-150 hover:shadow-[0_2px_10px_hsl(240_6%_10%/0.06)]'),
    className
  );

  const head = (
    <div className="flex items-center gap-2">
      {!inRow && <span
        className={cn(
          'grid size-[30px] shrink-0 place-items-center rounded-lg [&_svg]:size-4',
          TONE_CLASS[tone]
        )}
      >
        <Icon name={icon} />
      </span>}
      <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
      {/* Legacy: outside a FigureScope the help stays a per-tile "?" until the page adopts the scope. */}
      {help && !inScope && (
        <Tooltip content={help} title={helpLabel}>
          <button
            type="button"
            aria-label={helpLabel ? `${helpLabel}: ${label}` : t('dashboard.kpi.helpLabel', 'Help: {{label}}', { label })}
            className="touch-target pointer-events-auto relative z-10 ml-auto grid size-[15px] cursor-help place-items-center text-muted-foreground [&_svg]:size-3.5"
          >
            <Icon name="help" />
          </button>
        </Tooltip>
      )}
    </div>
  );

  // Linked tiles retain one full-surface navigation target. Presentation sits
  // outside the link so the help button is an independent, accessible control.
  if (isLink) {
    return (
      <div data-testid={testId} className={rootClass}>
        <Link
          to={to}
          aria-label={linkLabel ?? label}
          className={cn('absolute inset-0 z-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring', inRow ? 'focus-visible:-outline-offset-2' : 'rounded-lg focus-visible:outline-offset-2')}
        />
        <div className="relative z-10 flex min-w-0 flex-col gap-2.5 pointer-events-none">
          {head}
          {loading ? (
            <div data-testid="kpi-skeleton" className="skel h-[23px] w-2/3" />
          ) : error ? null : (
            <div
              className={cn(
                'min-w-0 break-words text-[23px] font-bold leading-none tracking-[-0.02em] tabular',
                negative && 'text-destructive'
              )}
            >
              <FigureContent value={value} exactValue={exactValue} unavailableReason={unavailableReason} />
            </div>
          )}
          {caption && <Caption>{caption}</Caption>}
        </div>
      </div>
    );
  }

  return (
    <div data-testid={testId} className={rootClass}>
      {head}

      {loading ? (
        <div data-testid="kpi-skeleton" className="skel h-[23px] w-2/3" />
      ) : error ? null : (
        <div
          className={cn(
            'min-w-0 break-words text-[23px] font-bold leading-none tracking-[-0.02em] tabular',
            negative && 'text-destructive'
          )}
        >
          <FigureContent value={value} exactValue={exactValue} unavailableReason={unavailableReason} />
        </div>
      )}

      {caption && <Caption>{caption}</Caption>}
    </div>
  );
}
