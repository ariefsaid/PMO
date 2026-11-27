import { getOrgLocaleDefaults, type OrgLocaleDefaultsRow } from '@/src/lib/db/orgs';
import { wrap } from './repositoryErrors';

export interface OrgDefaultsRepository {
  /** Boot-critical organisation locale and timezone defaults (own-org RLS read). */
  getLocaleDefaults(): Promise<OrgLocaleDefaultsRow>;
}

/**
 * Statically imported boot-critical organisation defaults repository.
 *
 * Kept out of the lazy `admin` repository chunk so `RequireAuth`'s org-defaults read
 * can fire as soon as the session is known without waiting for the broad admin module graph.
 */
export const orgDefaultsRepository: OrgDefaultsRepository = {
  getLocaleDefaults: () => wrap(() => getOrgLocaleDefaults()),
};
