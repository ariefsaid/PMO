import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, TextField } from '@/src/components/ui';
import type { ProjectClassification, ProjectClassificationFilters as FilterValues } from '@/src/lib/projectClassification';

export default function ProjectClassificationFilters({ rows, value, onChange }: {
  rows: readonly ProjectClassification[];
  value: FilterValues;
  onChange: (patch: FilterValues) => void;
}) {
  const { t } = useTranslation();
  const all = t('projectClassification.all', 'All');
  const optionsFor = (field: 'service_line' | 'sector', selected?: string) =>
    [{ value: '', label: all }, ...[...new Set([...rows.map((row) => row[field]), selected])]
      .filter((option): option is string => Boolean(option))
      .sort((a, b) => a.localeCompare(b))
      .map((option) => ({ value: option, label: option }))];
  return <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="project-classification-filters">
    <SelectField label={t('projectClassification.filterServiceLine', 'Filter by service line')} value={value.serviceLine ?? ''}
      onChange={(serviceLine) => onChange({ serviceLine })} options={optionsFor('service_line', value.serviceLine)} />
    <SelectField label={t('projectClassification.filterSector', 'Filter by sector')} value={value.sector ?? ''}
      onChange={(sector) => onChange({ sector })} options={optionsFor('sector', value.sector)} />
    <SelectField label={t('projectClassification.filterAwardType', 'Filter by award type')} value={value.awardType ?? ''}
      onChange={(awardType) => onChange({ awardType })} options={[{ value: '', label: all }, { value: 'tender', label: t('projectClassification.tender', 'Tender') }, { value: 'direct', label: t('projectClassification.direct', 'Direct award') }]} />
    <SelectField label={t('projectClassification.filterBiddingEntity', 'Filter by bidding entity')} value={value.biddingEntity ?? ''}
      onChange={(biddingEntity) => onChange({ biddingEntity })} options={[{ value: '', label: all }, { value: 'alone', label: t('projectClassification.alone', 'Alone') }, { value: 'consortium', label: t('projectClassification.consortium', 'Consortium') }]} />
    <TextField label={t('projectClassification.filterLocation', 'Filter by location')} value={value.location ?? ''}
      onChange={(location) => onChange({ location })} />
  </div>;
}
