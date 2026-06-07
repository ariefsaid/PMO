import React from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';
import { Tooltip } from './Tooltip';
import { ViewToggle, type ViewOption } from './ViewToggle';

export type KPITone = 'blue' | 'violet' | 'amber' | 'red' | 'green' | 'cyan';

/** Tinted icon-tile tones. cyan is the one sanctioned literal (Open Q2). */
const TONE_CLASS: Record<KPITone, string> = {
  blue: 'bg-primary/[0.12] text-primary',
  violet: 'bg-violet/[0.12] text-violet',
  amber: 'bg-warning/[0.18] text-warning-foreground',
  red: 'bg-destructive/[0.12] text-destructive',
  green: 'bg-success/[0.13] text-success',
  cyan: 'bg-[hsl(199_89%_48%/0.13)] text-[hsl(199_89%_42%)]',
};

export interface KPIDelta {
  dir: 'up' | 'down' | 'neutral';
  text: string;
}

export interface KPIDualLens<L extends string = string> {
  lens: L;
  options: ViewOption<L>[];
  onLens: (lens: L) => void;
}

export interface KPITileProps<L extends string = string> {
  icon: IconName;
  tone: KPITone;
  label: string;
  value: React.ReactNode;
  /** Negative values turn destructive (DESIGN.md). */
  negative?: boolean;
  /** Help tooltip — exposed as a keyboard-focusable `?`. */
  help?: string;
  /** Foot delta chip + vs-comparison. */
  delta?: KPIDelta;
  vs?: string;
  /** Skeleton while the metric query loads. */
  loading?: boolean;
  /** Replaces the foot with a segmented on-hand/weighted lens toggle. */
  dual?: KPIDualLens<L>;
  /** Test id on the tile root (for AC-tagged smoke assertions). */
  testId?: string;
  className?: string;
}

const DELTA_CLASS: Record<KPIDelta['dir'], string> = {
  up: 'text-success bg-success/12',
  down: 'text-destructive bg-destructive/10',
  neutral: 'text-muted-foreground bg-secondary',
};

export function KPITile<L extends string = string>({
  icon,
  tone,
  label,
  value,
  negative = false,
  help,
  delta,
  vs,
  loading = false,
  dual,
  testId,
  className,
}: KPITileProps<L>) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'relative flex min-w-0 flex-col gap-2.5 rounded-lg border border-border bg-card px-4 pb-3.5 pt-4 transition-shadow duration-150 hover:shadow-[0_2px_10px_hsl(240_6%_10%/0.06)]',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'grid size-[30px] shrink-0 place-items-center rounded-lg [&_svg]:size-4',
            TONE_CLASS[tone]
          )}
        >
          <Icon name={icon} />
        </span>
        <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
        {help && (
          <Tooltip content={help}>
            <span
              tabIndex={0}
              role="button"
              aria-label={`Help: ${label}`}
              className="touch-target ml-auto grid size-[15px] cursor-help place-items-center text-muted-foreground opacity-55 hover:opacity-100 [&_svg]:size-3.5"
            >
              <Icon name="help" />
            </span>
          </Tooltip>
        )}
      </div>

      {loading ? (
        <div data-testid="kpi-skeleton" className="skel h-[23px] w-2/3" />
      ) : (
        <div
          className={cn(
            'text-[23px] font-bold leading-none tracking-[-0.02em] tabular',
            negative && 'text-destructive'
          )}
        >
          {value}
        </div>
      )}

      {dual ? (
        <ViewToggle
          options={dual.options}
          value={dual.lens}
          onChange={dual.onLens}
          ariaLabel={`${label} lens`}
          className="mt-auto h-[22px] self-start p-px"
        />
      ) : (
        (delta || vs) && (
          <div className="flex items-center gap-[7px] text-[12px]">
            {delta && (
              <span
                data-testid="kpi-delta"
                className={cn(
                  'inline-flex items-center gap-[3px] rounded-full px-1.5 py-px font-semibold [&_svg]:size-3',
                  DELTA_CLASS[delta.dir]
                )}
              >
                {delta.dir !== 'neutral' && <Icon name={delta.dir} />}
                {delta.text}
              </span>
            )}
            {vs && <span className="text-muted-foreground">{vs}</span>}
          </div>
        )
      )}
    </div>
  );
}
