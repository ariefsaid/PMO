/** repositories/medicalRelease.ts — the seam over medical releases (ADR-0017). Errors keep their Postgres code via `wrap`. */
import * as release from '@/src/lib/db/medicalRelease';
import { wrap } from './repositoryErrors';

export type { MedicalReleaseRow, ReleasePerson, ReleaseState, ReleaseStatus } from '@/src/lib/db/medicalRelease';

export const medicalReleaseRepository = {
  visible: () => wrap(() => release.listMedicalReleases()),
  canEnter: () => wrap(() => release.canEnterMedicalRelease()),
  people: () => wrap(() => release.listReleasePeople()),
  create: (personId: string, date: string, note: string | null) => wrap(() => release.createMedicalRelease(personId, date, note)),
  decide: (id: string, decision: 'Approved' | 'Deferred', note: string | null) => wrap(() => release.decideMedicalRelease(id, decision, note)),
  holds: (date: string) => wrap(() => release.listReleaseHolds(date)),
  withdraw: (id: string, reason: string) => wrap(() => release.withdrawMedicalRelease(id, reason)),
  reassign: (id: string) => wrap(() => release.reassignMedicalRelease(id)),
};
