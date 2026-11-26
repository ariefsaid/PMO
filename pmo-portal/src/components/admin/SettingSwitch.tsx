import React, { useId } from 'react';
import { Switch } from '@/src/components/ui';

/**
 * The one look for an organisation setting that is on or off and saves as it is flipped (#1126): the switch, the setting's
 * name, and under it what turning it on changes. Presentational only; the caller owns the read, the write and the permission.
 */
export function SettingSwitch({ label, consequence, checked, onChange, disabled = false, controlPosition = 'start' }: {
  label: string;
  /** What turning it on changes, in one or two short sentences. */
  consequence?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  controlPosition?: 'start' | 'end';
}) {
  const labelId = useId();
  const helperId = useId();
  return (
    <label className={`flex min-h-11 max-w-xl items-start gap-3 py-1.5 text-control ${controlPosition === 'end' ? 'flex-row-reverse justify-between' : ''}`}>
      <Switch checked={checked} onChange={onChange} labelledBy={labelId} describedBy={consequence ? helperId : undefined}
        disabled={disabled} className="mt-0.5" />
      <span className="min-w-0">
        <span id={labelId} className="block font-medium">{label}</span>
        {consequence && <span id={helperId} className="block text-muted-foreground">{consequence}</span>}
      </span>
    </label>
  );
}
