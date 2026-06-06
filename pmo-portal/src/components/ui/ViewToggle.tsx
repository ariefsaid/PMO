import React from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';
import { Badge } from './StatusPill';

export interface ViewOption<V extends string = string> {
  value: V;
  label: string;
  icon?: IconName;
  /** Optional trailing count badge (e.g. an Approvals queue size). */
  count?: number;
}

export interface ViewToggleProps<V extends string = string> {
  options: ViewOption<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * Inline segmented control (DESIGN.md `seg`): 32px secondary track, 28px
 * buttons, "on" = white pill + pressed lift. ARIA tablist with roving arrow-key
 * selection. Used for view switchers and stage/queue filters.
 */
export function ViewToggle<V extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: ViewToggleProps<V>) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = options.findIndex((o) => o.value === value);
    const next =
      e.key === 'ArrowRight'
        ? options[(idx + 1) % options.length]
        : options[(idx - 1 + options.length) % options.length];
    onChange(next.value);
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn('inline-flex h-8 items-center gap-0.5 rounded-lg bg-secondary p-0.5', className)}
    >
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[5px] px-[11px] text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-100',
              '[&_svg]:size-[14px]',
              on
                ? 'bg-background font-semibold text-foreground shadow-[0_1px_2px_hsl(240_6%_10%/0.1)]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.icon && <Icon name={opt.icon} />}
            {opt.label}
            {opt.count !== undefined && (
              <Badge active={on} className="min-w-0 px-1.5">
                {opt.count}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
