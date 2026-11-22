/** repositories/manpowerNeeds.ts — the seam over manpower needs (ADR-0017). Standalone module like `clearance.ts`: imported directly by its hooks. Errors keep their Postgres code via `wrap`. */
import * as needs from '@/src/lib/db/manpowerNeeds';
import { wrap } from './repositoryErrors';
import type { ManpowerNeedRepository } from './contracts/manpowerNeeds';

export type {
  ManpowerNeedRow, ManpowerNeedInput, ManpowerNeedPatch, ManpowerProgressRow, ManpowerLinkRow, ManpowerStatus,
} from '@/src/lib/db/manpowerNeeds';

export const manpowerNeedRepository: ManpowerNeedRepository = {
  list: () => wrap(() => needs.listManpowerNeeds()),
  progress: () => wrap(() => needs.listManpowerProgress()),
  links: () => wrap(() => needs.listManpowerLinks()),
  create: (input) => wrap(() => needs.createManpowerNeed(input)),
  update: (id, patch) => wrap(() => needs.updateManpowerNeed(id, patch)),
  link: (needId, personId) => wrap(() => needs.linkManpowerPerson(needId, personId)),
  unlink: (linkId) => wrap(() => needs.unlinkManpowerPerson(linkId)),
  canManage: () => wrap(() => needs.canManageManpower()),
};
