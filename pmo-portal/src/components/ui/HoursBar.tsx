/**
 * HoursBar — single-hue hours bar row.
 * Track = bg-secondary, fill = bg-muted-foreground (Freed-Blue Status Rule, DESIGN.md §2).
 * A quantity/hours bar is a data indicator, NOT an interactive affordance — it must NOT
 * use bg-primary (action-blue). Neutral muted-foreground reads as "measured amount".
 * Carries role="progressbar" + aria-label for WCAG-AA (plan §6, T5).
 * Used by Engineer "This week by project" and Timesheet "By project this week".
 */
import React from 'react';

export interface HoursBarProps {
  /** Project name (displayed as body text). */
  label: string;
  /** Machine identifier — rendered in mono when present. */
  code: string | null;
  /** This project's value (hours by default; any quantity when `formatValue` is set). */
  hours: number;
  /** Maximum value used for proportional fill (typically sum of all values). */
  maxHours: number;
  /**
   * Formats the trailing value AND the progressbar accessible-name suffix.
   * Defaults to the "Nh" hours form. Pass e.g. `formatCurrency` when the bar
   * shows money (budget-by-category) so it never renders the raw "2000000h".
   */
  formatValue?: (value: number) => string;
  /** Accessible-name unit word (default "hours"); ignored when `formatValue` is set. */
  unitLabel?: string;
}

const defaultFormat = (v: number) => `${v}h`;

export const HoursBar: React.FC<HoursBarProps> = ({
  label,
  code,
  hours,
  maxHours,
  formatValue,
  unitLabel = 'hours',
}) => {
  const pct = maxHours > 0 ? (hours / maxHours) * 100 : 0;
  const display = (formatValue ?? defaultFormat)(hours);
  // When a custom formatter is given, the formatted string is the a11y suffix;
  // otherwise fall back to the "N hours" phrasing.
  const ariaValue = formatValue ? display : `${hours} ${unitLabel}`;

  return (
    <div className="flex items-center gap-2.5 py-[5px]">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="truncate text-[13px] font-semibold min-w-0">{label}</span>
          {code && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{code}</span>
          )}
        </div>
        <span
          role="progressbar"
          aria-label={`${label}: ${ariaValue}`}
          aria-valuenow={hours}
          aria-valuemin={0}
          aria-valuemax={maxHours}
          className="mt-1 block h-[7px] w-full overflow-hidden rounded-full bg-secondary"
        >
          <span
            className="block h-full rounded-full bg-muted-foreground"
            style={{ width: `${pct}%` }}
          />
        </span>
      </div>
      <span className="w-auto min-w-10 shrink-0 text-right text-[12px] font-semibold tabular text-foreground">
        {display}
      </span>
    </div>
  );
};
