/**
 * repositories/builtInRoles.ts (#2709) — the seam over the built-in role set: the organization setting and giving a person
 * a role (ADR-0017). Standalone module (same shape as `crews.ts`): imported directly by its hooks. Errors keep their code via `wrap`.
 */
import { getOrgBuiltInRolesEnabled, setOrgBuiltInRolesEnabled } from '@/src/lib/db/orgs';
import { updateUserBuiltInRole } from '@/src/lib/db/adminUsers';
import { wrap } from './repositoryErrors';

export const builtInRolesRepository = {
  /** Has the organization turned the built-in role set on (default false)? Every member reads. */
  getEnabled: () => wrap(() => getOrgBuiltInRolesEnabled()),
  /** Admin-only (server). */
  setEnabled: (enabled: boolean) => wrap(() => setOrgBuiltInRolesEnabled(enabled)),
  /** Give a person a built-in role key, or clear it (null). The database applies the profile-administration rule. */
  assign: (id: string, key: string | null) => wrap(() => updateUserBuiltInRole(id, key)),
};
