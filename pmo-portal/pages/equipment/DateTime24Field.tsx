import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@/src/components/ui';
import { DateField } from '@/src/components/ui/DateField';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: pad(h), label: pad(h) }));
const MINUTES = Array.from({ length: 60 }, (_, m) => ({ value: pad(m), label: pad(m) }));

/**
 * A day and a time on the 24-hour clock ("14:30"), whatever the device's own clock setting. The value is the same
 * `YYYY-MM-DDTHH:mm` text a `datetime-local` input holds, '' when no day is chosen.
 */
export const DateTime24Field: React.FC<{ label: string; value: string; onChange: (value: string) => void; required?: boolean }> = ({ label, value, onChange, required }) => {
  const { t } = useTranslation();
  const [day = '', time = ''] = value.split('T');
  const [hour = '00', minute = '00'] = time.split(':');
  const emit = (d: string, h: string, m: string) => onChange(d ? `${d}T${h}:${m}` : '');
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{label}{required ? ' *' : ''}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <DateField label={t('equipment:vendorResponse.day', 'Day')} value={day} onChange={(d) => emit(d, hour, minute)} required={required} />
        <SelectField label={t('equipment:vendorResponse.hour', 'Hour (00–23)')} value={hour} onChange={(h) => emit(day, h, minute)} options={HOURS} />
        <SelectField label={t('equipment:vendorResponse.minute', 'Minute')} value={minute} onChange={(m) => emit(day, hour, m)} options={MINUTES} />
      </div>
    </fieldset>
  );
};
