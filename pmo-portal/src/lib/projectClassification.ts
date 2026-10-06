import type { TFunction } from 'i18next';

/** Closed value sets mirrored by the `projects` CHECK constraints (0234). */
export const AWARD_TYPES = ['tender', 'direct'] as const;
export type AwardType = (typeof AWARD_TYPES)[number];
export const BIDDING_ENTITIES = ['alone', 'consortium'] as const;
export type BiddingEntity = (typeof BIDDING_ENTITIES)[number];
/** Matches the DB CHECK on `projects.location` and the option-list length rule. */
export const CLASSIFICATION_MAX_LENGTH = 140;

/** The value's own label; an unknown stored value is shown as stored, never relabelled. */
export function classificationValueLabel(t: TFunction, value: string): string {
  switch (value) {
    case 'tender': return t('projectClassification.tender', 'Tender');
    case 'direct': return t('projectClassification.direct', 'Direct award');
    case 'alone': return t('projectClassification.alone', 'Alone');
    case 'consortium': return t('projectClassification.consortium', 'Consortium');
    default: return value;
  }
}
/** Select options (value + translated label) for a closed value set. */
export function classificationValueOptions(t: TFunction, values: readonly (AwardType | BiddingEntity)[]) {
  return values.map((value) => ({ value, label: classificationValueLabel(t, value) }));
}

/** Optional PMO-owned classification; historical rows carry no invented defaults. */
export interface ProjectClassification {
  service_line?: string | null;
  sector?: string | null;
  location?: string | null;
  award_type?: string | null;
  bidding_entity?: string | null;
}
export interface ProjectClassificationFilters {
  serviceLine?: string;
  sector?: string;
  location?: string;
  awardType?: AwardType;
  biddingEntity?: BiddingEntity;
}
export const CLASSIFICATION_FILTER_KEYS = ['serviceLine', 'sector', 'location', 'awardType', 'biddingEntity'] as const;
/** How many classification filters are set — one definition for Projects and Sales Pipeline. */
export function activeClassificationCount(filters: ProjectClassificationFilters): number {
  return CLASSIFICATION_FILTER_KEYS.filter((key) => Boolean(filters[key])).length;
}
/** The five classification fields only, for seeding an edit form from a full row. */
export function pickClassification(row: ProjectClassification): ProjectClassification {
  return {
    service_line: row.service_line, sector: row.sector, location: row.location,
    award_type: row.award_type, bidding_entity: row.bidding_entity,
  };
}
export function matchesProjectClassification(project: ProjectClassification, filters: ProjectClassificationFilters): boolean {
  return (!filters.serviceLine || project.service_line === filters.serviceLine)
    && (!filters.sector || project.sector === filters.sector)
    && (!filters.location || (project.location ?? '').toLocaleLowerCase().includes(filters.location.toLocaleLowerCase()))
    && (!filters.awardType || project.award_type === filters.awardType)
    && (!filters.biddingEntity || project.bidding_entity === filters.biddingEntity);
}
export function parseClassificationOptions(value: string): string[] {
  return [...new Set(value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean))];
}
