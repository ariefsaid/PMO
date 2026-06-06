import React from 'react';
import { cn } from './cn';

export interface FunnelStage {
  name: string;
  dotColor?: string;
  prob?: string;
  value: React.ReactNode;
  weighted?: React.ReactNode;
  /** 0-100 bar fill. */
  barPct?: number;
  barColor?: string;
}

export interface FunnelProps {
  stages: FunnelStage[];
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  className?: string;
}

/** Connected stage-summary band (macro analog of the stepper). */
export const Funnel: React.FC<FunnelProps> = ({ stages, selectedIndex, onSelect, className }) => (
  <div
    className={cn('grid', className)}
    style={{ gridTemplateColumns: `repeat(${stages.length}, 1fr)` }}
  >
    {stages.map((s, i) => {
      const selected = i === selectedIndex;
      const interactive = !!onSelect;
      return (
        <div
          key={i}
          role={interactive ? 'button' : undefined}
          tabIndex={interactive ? 0 : undefined}
          onClick={() => onSelect?.(i)}
          onKeyDown={(e) => {
            if (interactive && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onSelect?.(i);
            }
          }}
          className={cn(
            'relative min-w-0 border border-r-0 border-border px-3.5 pb-3 pt-[13px] first:rounded-l-lg last:rounded-r-lg last:border-r',
            interactive && 'cursor-pointer',
            selected && 'bg-primary/[0.06] shadow-[inset_0_-2px_0_hsl(var(--primary))]'
          )}
        >
          <div className="mb-2 flex items-center gap-[7px]">
            <span
              aria-hidden
              className="size-[9px] shrink-0 rounded-full"
              style={{ background: s.dotColor ?? 'hsl(var(--primary))' }}
            />
            <span className="text-xs font-semibold">{s.name}</span>
            {s.prob && (
              <span className="ml-auto text-[11px] font-bold text-muted-foreground">{s.prob}</span>
            )}
          </div>
          <div className="text-[17px] font-bold leading-none tracking-[-0.02em] tabular">
            {s.value}
          </div>
          {s.weighted && (
            <div className="mt-[7px] text-[11px] text-muted-foreground">{s.weighted}</div>
          )}
          {s.barPct !== undefined && (
            <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-secondary">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, s.barPct))}%`,
                  background: s.barColor ?? 'hsl(var(--primary))',
                }}
              />
            </div>
          )}
        </div>
      );
    })}
  </div>
);
