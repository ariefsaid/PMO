import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from './Drawer';
import { SearchMini } from './TableControls';
import { useIsNarrow } from './useIsNarrow';
import { ViewToggle } from './ViewToggle';
import { Combobox, type ComboboxOption } from './Combobox';

export interface FilterBarFilter {
  key: string;
  label: string;
  kind: 'select' | 'segment';
  options: { value: string; label: string }[];
  semantics?: 'tabs' | 'toggle';
  /** The option set is not known yet: a segment holds its space as a placeholder (no chips to tap). */
  pending?: boolean;
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
  total?: number;
  labels?: { all?: string; clear?: string; filters?: string; count?: (shown: number, total: number) => string };
  searchSurface?: string;
  module?: string;
  className?: string;
  /**
   * A page whose own builder already offers one list-wide "Clear all" (which this bar cannot see
   * the state of, so it would sit there disabled) opts out of this bar's duplicate.
   */
  showClear?: boolean;
}

export function FilterBar({ searchKey, searchLabel, searchPlaceholder, filters, values, onChange, onClear, shown, total, labels, searchSurface, module, className, showClear = true }: FilterBarProps) {
  const { t } = useTranslation();
  const narrow = useIsNarrow();
  const [open, setOpen] = useState(false);
  const all = labels?.all ?? t('ui.filterBar.all', 'All');
  const filterLabel = labels?.filters ?? t('ui.filterBar.filters', 'Filters');
  const active = Boolean(values[searchKey]) || filters.some(({ key }) => Boolean(values[key]));
  const controls = <div className="flex flex-wrap items-center gap-2">
    <SearchMini
      aria-label={searchLabel}
      placeholder={searchPlaceholder ?? searchLabel}
      value={values[searchKey] ?? ''}
      onChange={(event) => onChange(searchKey, event.target.value)}
      containerClassName="h-[var(--control-height-sm)] max-sm:min-h-11"
      searchSurface={searchSurface}
      module={module}
      resultCount={shown}
    />
    {filters.map((filter) => filter.kind === 'segment' ?
      <div key={filter.key} data-testid="status-filter-scroll" className="w-full min-w-0 md:w-auto">
        {filter.pending ? <div data-testid="status-filters-pending" aria-busy="true" className="pointer-events-none"><ViewToggle className="w-full flex-wrap min-h-[var(--control-height-sm)] p-0 md:w-auto md:flex-nowrap" semantics={filter.semantics ?? "toggle"} ariaLabel={filter.label} value="" onChange={() => undefined} options={[{ value: '', label: all }]} /></div> : <ViewToggle className="w-full flex-wrap min-h-[var(--control-height-sm)] p-0 md:w-auto md:flex-nowrap" semantics={filter.semantics ?? "toggle"} ariaLabel={filter.label} value={values[filter.key] ?? ''} onChange={(value) => onChange(filter.key, value)} options={[{ value: '', label: all }, ...filter.options]} />}
      </div> :
      <FilterPick key={filter.key} filter={filter} all={all} value={values[filter.key] ?? ''} onChange={(value) => onChange(filter.key, value)} />)}
    {/* Nothing to clear means no button: a greyed "Clear all" beside untouched filters is noise. */}
    {showClear && active && <button type="button" onClick={onClear} className="min-h-11 rounded-md px-3 text-control text-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[var(--control-height-sm)]">{labels?.clear ?? t('ui.filterBar.clear', 'Clear all')}</button>}
  </div>;
  return <div className={`flex flex-wrap items-center justify-between gap-2 w-full ${className ?? ''}`}>
    {narrow ? <><button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-md border border-input bg-background px-3 text-control text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{filterLabel}</button><Drawer open={open} onClose={() => setOpen(false)} title={filterLabel}>{controls}</Drawer></> : controls}
    {/* #2345 row 11: the default reads the catalogue (`ui.listPage.showingOf`) — a hard-coded
        template here bypassed the id translation every caller without `labels.count` rendered. */}
    {total !== undefined && <span aria-live="polite" className="text-control text-muted-foreground">{labels?.count?.(shown, total) ?? t('ui.listPage.showingOf', 'Showing {{count}} of {{total}}', { count: shown, total })}</span>}
  </div>;
}

/** One filter: its caption beside the app's own picker (searchable, never the browser's select). */
function FilterPick({ filter, all, value, onChange }: { filter: FilterBarFilter; all: string; value: string; onChange: (value: string) => void }) {
  const options = useMemo<ComboboxOption[]>(() => [{ value: '', label: all }, ...filter.options], [all, filter.options]);
  const loadOptions = useCallback(() => Promise.resolve(options), [options]);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <div className="flex items-center gap-2 text-control text-foreground">
      <span aria-hidden="true">{filter.label}</span>
      <Combobox
        label={filter.label}
        hideLabel
        compact
        value={value}
        selectedOption={selected}
        loadOptions={loadOptions}
        onChange={(next) => onChange(next)}
        noun={filter.label.toLocaleLowerCase()}
        nounPlural={filter.label.toLocaleLowerCase()}
        className="w-auto max-w-60"
      />
    </div>
  );
}
