import type {
  CheckpointTemplateItem, CrewPunctuality, DayCheckpoint, LostTimeResult, PunctualityFilter, PunctualityResult, RecordInput,
} from '@/src/lib/db/siteCheckpoints';

export type { CrewPunctuality };

/** #2594 timed checkpoints seam (ADR-0017). Every write is a server RPC; the recorded time and org_id never leave the server. */
export interface SiteCheckpointRepository {
  getList(): Promise<CheckpointTemplateItem[]>;
  setList(items: CheckpointTemplateItem[]): Promise<number>;
  day(workOrderId: string, date: string): Promise<DayCheckpoint[]>;
  flag(workOrderId: string, date?: string | null): Promise<boolean>;
  record(input: RecordInput): Promise<void>;
  recordRefs(id: string): Promise<RecordInput['checkpoint']>;
  photoUrl(path: string): Promise<string>;
  punctuality(filter: PunctualityFilter): Promise<PunctualityResult>;
  lostTime(filter: PunctualityFilter): Promise<LostTimeResult>;
}
