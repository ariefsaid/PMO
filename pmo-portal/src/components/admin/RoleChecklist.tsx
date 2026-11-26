import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox } from '@/src/components/ui';

export interface RoleChecklistProps {
  /** The group's name ("May enter a second record"); visible unless `hideLegend`. */
  legend: string;
  hideLegend?: boolean;
  /** One line under the legend: who always may, or what empty means. */
  helper?: string;
  /** Extra ids that describe the group (a paragraph the caller already renders). */
  describedBy?: string;
  options: ReadonlyArray<{ key: string; name: string }>;
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Read-only: the chosen roles show, the picker does not open. */
  disabled?: boolean;
}

/**
 * "Which job roles may do this" (#1126): the one pattern for an organisation setting that names built-in roles. The chosen
 * roles read as one line of tags; "Choose roles" opens the full checklist in place, so a 28-role grid no longer fills the
 * screen when two or three are chosen. Saving stays with the caller (its own Save button and write).
 */
export function RoleChecklist({ legend, hideLegend, helper, describedBy, options, value, onChange, disabled = false }: RoleChecklistProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const helperId = useId();
  const listId = useId();
  const chosen = options.filter((o) => value.includes(o.key));
  const toggle = (key: string, on: boolean) => onChange(on ? [...value, key] : value.filter((k) => k !== key));
  const described = [helper ? helperId : null, describedBy].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset className="min-w-0" aria-describedby={described}>
      <legend className={hideLegend ? 'sr-only' : 'text-control font-medium text-foreground'}>{legend}</legend>
      {helper && <p id={helperId} className="text-control text-muted-foreground">{helper}</p>}
      <div className="mt-2 flex min-h-8 flex-wrap items-center gap-2">
        {chosen.length === 0
          ? <span className="text-control text-muted-foreground">{t('administration:roleChecklist.none', 'No role chosen')}</span>
          : chosen.map((o) => (
            <span key={o.key} className="inline-flex h-7 items-center rounded-full border border-border bg-secondary px-2.5 text-control">{o.name}</span>
          ))}
        {!disabled && (
          <Button variant="outline" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)}>
            {open ? t('administration:roleChecklist.done', 'Done') : t('administration:roleChecklist.choose', 'Choose roles')}
          </Button>
        )}
      </div>
      {open && !disabled && (
        <div id={listId} className="mt-3 grid grid-cols-1 gap-x-4 rounded-md border border-border p-3 sm:grid-cols-2 xl:grid-cols-3">
          {options.map((o) => (
            <Checkbox key={o.key} label={o.name} checked={value.includes(o.key)} onChange={(on) => toggle(o.key, on)} className="min-h-10">
              {o.name}
            </Checkbox>
          ))}
        </div>
      )}
    </fieldset>
  );
}
