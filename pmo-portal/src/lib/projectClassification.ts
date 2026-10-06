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
  awardType?: string;
  biddingEntity?: string;
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
