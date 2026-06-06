import React from 'react';
import { cn } from './cn';

export interface TabItem<V extends string = string> {
  value: V;
  label: string;
}

export interface TabsProps<V extends string = string> {
  items: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
  className?: string;
}

/** In-page tabs (`ptabs`): underlined active tab, arrow-key navigation. */
export function Tabs<V extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: TabsProps<V>) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = items.findIndex((t) => t.value === value);
    const next =
      e.key === 'ArrowRight'
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
    onChange(next.value);
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn('mb-4 flex gap-0.5 border-b border-border', className)}
    >
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative h-[38px] px-3.5 text-[13.5px] font-medium',
              active ? 'ptab-active font-semibold text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
