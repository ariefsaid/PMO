/**
 * HoursBar — single-hue hours bar row.
 * Track = bg-secondary, fill = bg-primary (One-Blue Rule).
 * Carries role="progressbar" + aria-label for WCAG-AA (plan §6, T5).
 * Used by Engineer "This week by project" and Timesheet "By project this week".
 */
import React from 'react';

export interface HoursBarProps {
  /** Project name (displayed as body text). */
  label: string;
  /** Machine identifier — rendered in mono when present. */
  code: string | null;
  /** This project's hours value. */
  hours: number;
  /** Maximum value used for proportional fill (typically sum of all hours). */
  maxHours: number;
}

export const HoursBar: React.FC<HoursBarProps> = ({ label, code, hours, maxHours }) => {
  const pct = maxHours > 0 ? (hours / maxHours) * 100 : 0;

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
          aria-label={`${label}: ${hours} hours`}
          aria-valuenow={hours}
          aria-valuemin={0}
          aria-valuemax={maxHours}
          className="mt-1 block h-[7px] w-full overflow-hidden rounded-full bg-secondary"
        >
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
        </span>
      </div>
      <span className="w-10 shrink-0 text-right text-[12px] font-semibold tabular text-foreground">
        {hours}h
      </span>
    </div>
  );
};
