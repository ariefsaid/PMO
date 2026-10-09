import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, MobileToolbarDisclosure, SelectField, TextField } from '@/src/components/ui';
import { activeClassificationCount, AWARD_TYPES, BIDDING_ENTITIES, CLASSIFICATION_FILTER_KEYS, classificationValueLabel, classificationValueOptions } from '@/src/lib/projectClassification';
import type { AwardType, BiddingEntity, ProjectClassification, ProjectClassificationFilters as FilterValues } from '@/src/lib/projectClassification';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';

const LOCATION_DEBOUNCE_MS = 300;
export default function ProjectClassificationFilters({ rows, value, onChange, open, onOpenChange, inlineTrigger = false, closeOnMobileSelect = false }: {
  rows: readonly ProjectClassification[];
  value: FilterValues;
  onChange: (patch: FilterValues) => void;
  /** Optional coordination with sibling mobile toolbar disclosures. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Let the trigger share a flex toolbar row; the panel/summary still take a full row. */
  inlineTrigger?: boolean;
  /** Preserve Projects' phone selection-and-return-to-trigger behavior. */
  closeOnMobileSelect?: boolean;
}) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const rootRef = useRef<HTMLDivElement>(null);
  const focusTrigger = () => rootRef.current?.querySelector<HTMLButtonElement>('[data-mobile-toolbar-disclosure-trigger]')?.focus();
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const pointerGesture = useRef(false);
  const closeAfterClick = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);
  const commitOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };
  // A pointer-down outside the inline panel must not move a record row before its click
  // activates. Keep the shared disclosure's focus/Escape semantics, but commit this
  // consumer's outside dismissal only after that gesture has completed.
  useEffect(() => {
    if (!isOpen) return;
    const start = () => { pointerGesture.current = true; };
    const finish = () => {
      pointerGesture.current = false;
      if (closeAfterClick.current) {
        closeAfterClick.current = false;
        setInternalOpen(false);
        onOpenChangeRef.current?.(false);
      }
    };
    document.addEventListener('pointerdown', start, true);
    document.addEventListener('click', finish);
    document.addEventListener('pointercancel', finish);
    return () => {
      pointerGesture.current = false;
      closeAfterClick.current = false;
      document.removeEventListener('pointerdown', start, true);
      document.removeEventListener('click', finish);
      document.removeEventListener('pointercancel', finish);
    };
  }, [isOpen]);
  // Typing updates the box at once; the URL (and so the working set) follows after a pause.
  const [locationText, setLocationText] = useState(value.location ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Any outside change to the working set (e.g. Clear filters) drops a pending typed value, so the
  // stale timer cannot re-apply it. The timer also cancels if its disclosure unmounts on return.
  useEffect(() => { clearTimeout(timer.current); setLocationText(value.location ?? ''); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const all = t('projectClassification.all', 'All');
  const optionsFor = (field: 'service_line' | 'sector', selected?: string) =>
    [{ value: '', label: all }, ...[...new Set([...rows.map((row) => row[field]), selected])]
      .filter((option): option is string => Boolean(option))
      .sort((a, b) => a.localeCompare(b))
      .map((option) => ({ value: option, label: option }))];
  const labels: Record<keyof FilterValues, string> = {
    serviceLine: t('projectClassification.serviceLine', 'Service line'),
    sector: t('projectClassification.sector', 'Sector'),
    awardType: t('projectClassification.awardType', 'Award type'),
    biddingEntity: t('projectClassification.biddingEntity', 'Bidding entity'),
    location: t('projectClassification.location', 'Location'),
  };
  const activeKeys = CLASSIFICATION_FILTER_KEYS.filter((key) => Boolean(value[key]));
  return (
    <div ref={rootRef} className={inlineTrigger ? 'contents' : 'w-full min-w-0'} data-testid="project-classification-filters">
      <MobileToolbarDisclosure label={t('projectClassification.title', 'Classification')}
        count={activeClassificationCount(value)} open={isOpen} onOpenChange={(next) => {
          if (!next && pointerGesture.current) closeAfterClick.current = true;
          else commitOpen(next);
        }}
        className={inlineTrigger ? 'contents' : undefined} closeOnSelectChange={closeOnMobileSelect && !isDesktop}>
        <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
        </div>
      </MobileToolbarDisclosure>
      {activeKeys.length > 0 && (
        <div className="mt-2 flex w-full min-w-0 flex-wrap items-center gap-2">
          <ul aria-label={t('projectClassification.applied', 'Applied classifications')} className="flex min-w-0 flex-wrap gap-2">
            {activeKeys.map((key) => {
              const selection = `${labels[key]}: ${classificationValueLabel(t, value[key]!)}`;
              return (
                <li key={key} className="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">
                  <span className="min-w-0 break-words">{selection}</span>
                  <Button variant="ghost" size="icon" className="shrink-0" aria-label={t('projectClassification.remove', 'Remove classification: {{selection}}', { selection })}
                    onClick={() => { focusTrigger(); onChange({ [key]: '' }); }}>
                    <Icon name="x" />
                  </Button>
                </li>
              );
            })}
          </ul>
          <Button variant="ghost" className="text-primary-text" onClick={() => {
            focusTrigger();
            clearTimeout(timer.current);
            setLocationText('');
            onChange({ serviceLine: '', sector: '', awardType: undefined, biddingEntity: undefined, location: '' });
          }}>
            {t('projectClassification.clear', 'Clear classifications')}
          </Button>
        </div>
      )}
    </div>
  );
}
