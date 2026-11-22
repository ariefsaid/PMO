import { useModuleOn } from '@/src/hooks/useOrgSwitch';
import type { OrgModuleKey } from '@/src/lib/repositories/orgSwitches';

/**
 * A feature setting that lives in a module reads as off while its module is off (#2746). UI only: the stored value is untouched and
 * no database guard reads the module. A read that has not landed stays as it is, so a loading page does not flash.
 */
export function useOffWhenModuleOff<Q extends { data: boolean | undefined }>(module: OrgModuleKey, q: Q): Q {
  const on = useModuleOn(module);
  return on || q.data === undefined ? q : { ...q, data: false };
}

/** The same for a settings read shaped `{ enabled, ... }`. */
export function useEnabledOffWhenModuleOff<Q extends { data: { enabled: boolean } | null | undefined }>(module: OrgModuleKey, q: Q): Q {
  const on = useModuleOn(module);
  return on || !q.data ? q : { ...q, data: { ...q.data, enabled: false } };
}
