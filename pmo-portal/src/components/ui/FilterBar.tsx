import React, { useState } from 'react';
import { Drawer } from './Drawer';
import { SearchMini } from './TableControls';
import { useIsNarrow } from './useIsNarrow';
import { ViewToggle } from './ViewToggle';

export interface FilterBarFilter {
  key: string;
  label: string;
  kind: 'select' | 'segment';
  options: { value: string; label: string }[];
  semantics?: 'tabs' | 'toggle';
}
export interface FilterBarProps {
  searchKey: string;
  searchLabel: string;
  searchPlaceholder?: string;
  filters: FilterBarFilter[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
  shown: number;
  total: number;
  labels?: { all?: string; clear?: string; filters?: string; count?: (shown: number, total: number) => string };
  searchSurface?: string;
  module?: string;
  className?: string;
}

export function FilterBar({ searchKey, searchLabel, searchPlaceholder, filters, values, onChange, onClear, shown, total, labels, searchSurface, module, className }: FilterBarProps) {
  const narrow = useIsNarrow();
  const [open, setOpen] = useState(false);
  const all = labels?.all ?? 'All';
  const filterLabel = labels?.filters ?? 'Filters';
  const active = Boolean(values[searchKey]) || filters.some(({ key }) => Boolean(values[key]));
  const controls = <div className="flex flex-wrap items-center gap-2">
    <SearchMini
      aria-label={searchLabel}
      placeholder={searchPlaceholder ?? searchLabel}
      value={values[searchKey] ?? ''}
      onChange={(event) => onChange(searchKey, event.target.value)}
      containerClassName="max-sm:min-h-11"
      searchSurface={searchSurface}
      module={module}
      resultCount={shown}
    />
    {filters.map((filter) => filter.kind === 'segment' ?
      <div key={filter.key} data-testid="status-filter-scroll" className="overflow-x-auto scroll-fade-x [&_button]:whitespace-nowrap">
        <ViewToggle semantics={filter.semantics ?? "toggle"} ariaLabel={filter.label} value={values[filter.key] ?? ''} onChange={(value) => onChange(filter.key, value)} options={[{ value: '', label: all }, ...filter.options]} />
      </div> :
      <label key={filter.key} className="flex items-center gap-2 text-control text-foreground">
        <span>{filter.label}</span>
        <select value={values[filter.key] ?? ''} onChange={(event) => onChange(filter.key, event.target.value)} className="h-11 rounded-md border border-input bg-background px-3 text-control text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8">
          <option value="">{all}</option>{filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>)}
    <button type="button" disabled={!active} onClick={onClear} className="min-h-11 rounded-md px-3 text-control text-primary-text disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8">{labels?.clear ?? 'Clear all'}</button>
  </div>;
  return <div className={`flex flex-wrap items-center justify-between gap-2 w-full ${className ?? ''}`}>
    {narrow ? <><button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-md border border-input bg-background px-3 text-control text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{filterLabel}</button><Drawer open={open} onClose={() => setOpen(false)} title={filterLabel}>{controls}</Drawer></> : controls}
    <span aria-live="polite" className="text-control text-muted-foreground">{labels?.count?.(shown, total) ?? `Showing ${shown} of ${total}`}</span>
  </div>;
}
