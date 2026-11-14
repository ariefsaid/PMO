import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, TextField } from '@/src/components/ui/FormFields';
import type { DashboardPeriod, PeriodKey } from './usePeriod';

export interface PeriodPickerProps {
  period: DashboardPeriod;
  selectPeriod: (key: PeriodKey) => void;
  setCustomMonth: (edge: 'from' | 'to', value: string) => void;
  compact?: boolean;
}

export const PeriodPicker: React.FC<PeriodPickerProps> = ({ period, selectPeriod, setCustomMonth, compact = false }) => {
  const { t } = useTranslation('dashboard');
  const options = [
    { value: 'month', label: t('period.month', 'This month') },
    { value: 'quarter', label: t('period.quarter', 'This quarter') },
    { value: 'ytd', label: t('period.ytd', 'Year to date') },
    { value: '12m', label: t('period.12m', 'Last 12 months') },
    { value: 'custom', label: t('period.custom', 'Pick months') },
  ];

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="period-picker">
      <SelectField
        label={t('period.label', 'Period')}
        hideLabel
        compact={compact}
        value={period.key}
        options={options}
        onChange={(value) => selectPeriod(value as PeriodKey)}
        className={compact ? 'min-w-[10rem]' : 'h-11 min-w-[10rem] text-[16px] min-[1180px]:h-8 min-[1180px]:text-control'}
        aria-label={t('period.label', 'Period')}
      />
      {period.key === 'custom' && (
        <div className="flex flex-wrap items-end gap-2" aria-label={t('period.customRange', 'Custom month range')}>
          <TextField
            label={t('period.from', 'From month')}
            type="month"
            value={period.from ?? ''}
            onChange={(value) => setCustomMonth('from', value)}
            className="h-11 min-w-[9.5rem] text-[16px] min-[1180px]:h-8 min-[1180px]:text-control"
          />
          <TextField
            label={t('period.to', 'To month')}
            type="month"
            value={period.to ?? ''}
            onChange={(value) => setCustomMonth('to', value)}
            className="h-11 min-w-[9.5rem] text-[16px] min-[1180px]:h-8 min-[1180px]:text-control"
          />
        </div>
      )}
    </div>
  );
};
