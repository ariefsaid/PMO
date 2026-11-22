import type {
  ManpowerLinkRow, ManpowerNeedInput, ManpowerNeedPatch, ManpowerNeedRow, ManpowerProgressRow, ManpowerToFillRow,
} from '@/src/lib/db/manpowerNeeds';

/** Manpower need contract (ADR-0017). */
export interface ManpowerNeedRepository {
  list(): Promise<ManpowerNeedRow[]>;
  progress(): Promise<ManpowerProgressRow[]>;
  links(): Promise<ManpowerLinkRow[]>;
  create(input: ManpowerNeedInput): Promise<void>;
  update(id: string, patch: ManpowerNeedPatch): Promise<void>;
  link(needId: string, personId: string): Promise<void>;
  unlink(linkId: string): Promise<void>;
  toFill(): Promise<ManpowerToFillRow[]>;
  canManage(): Promise<boolean>;
}
