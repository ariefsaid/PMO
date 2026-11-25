import type { CheckTemplateInput, CheckTemplateItem } from '@/src/lib/db/workOrderCheckTemplate';

/** #2898 the organisation's standard checks for a new work order (ADR-0017). Saved whole by an Admin RPC. */
export interface WorkOrderCheckTemplateRepository {
  list(): Promise<CheckTemplateItem[]>;
  save(items: CheckTemplateInput[]): Promise<number>;
}
