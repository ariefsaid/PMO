import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, TextField } from '@/src/components/ui';
import { AWARD_TYPES, BIDDING_ENTITIES, classificationValueOptions } from '@/src/lib/projectClassification';
import type { AwardType, BiddingEntity, ProjectClassification, ProjectClassificationFilters as FilterValues } from '@/src/lib/projectClassification';

const LOCATION_DEBOUNCE_MS = 300;
export default function ProjectClassificationFilters({ rows, value, onChange }: {
  rows: readonly ProjectClassification[];
  value: FilterValues;
  onChange: (patch: FilterValues) => void;
}) {
  const { t } = useTranslation();
  // Typing updates the box at once; the URL (and so the working set) follows after a pause.
  const [locationText, setLocationText] = useState(value.location ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setLocationText(value.location ?? ''); }, [value.location]);
  useEffect(() => () => clearTimeout(timer.current), []);
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
      onChange={(awardType) => onChange({ awardType: (awardType || undefined) as AwardType | undefined })} options={[{ value: '', label: all }, ...classificationValueOptions(t, AWARD_TYPES)]} />
    <SelectField label={t('projectClassification.filterBiddingEntity', 'Filter by bidding entity')} value={value.biddingEntity ?? ''}
      onChange={(biddingEntity) => onChange({ biddingEntity: (biddingEntity || undefined) as BiddingEntity | undefined })} options={[{ value: '', label: all }, ...classificationValueOptions(t, BIDDING_ENTITIES)]} />
    <TextField label={t('projectClassification.filterLocation', 'Filter by location')} value={locationText}
      onChange={(location) => {
        setLocationText(location);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onChange({ location }), LOCATION_DEBOUNCE_MS);
      }} />
  </div>;
}
