import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { listOrgRoleNames } from '@/src/lib/db/orgRoleNames';
import { builtInRoleName, type RoleNameOverrides } from '@/src/auth/builtInRoles';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

export const ORG_ROLE_NAMES_KEY = ['org-role-names'] as const;

/**
 * The active org's role-name overrides live in a small module store (like the term overrides), loaded once per
 * session by `useApplyOrgRoleNames`. Readers need no query provider and fall back to the catalogue defaults
 * until (or unless) the overrides load.
 */
let active: RoleNameOverrides = {};
const listeners = new Set<() => void>();
export function setOrgRoleNames(next: RoleNameOverrides): void {
  if (JSON.stringify(next) === JSON.stringify(active)) return;
  active = next;
  listeners.forEach((l) => l());
}
export const getOrgRoleNames = (): RoleNameOverrides => active;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useOrgRoleNames() {
  return useOrgQuery([...ORG_ROLE_NAMES_KEY], listOrgRoleNames, { staleness: 'session' });
}

/** Mount once under the auth + query providers, beside `useApplyOrgTerminology`. */
export function useApplyOrgRoleNames(): void {
  const { data } = useOrgRoleNames();
  useEffect(() => {
    setOrgRoleNames(data ?? {});
  }, [data]);
}

/** `(key) => display name` in the viewer's language with the organisation's overrides; catalogue defaults otherwise. */
export function useBuiltInRoleName(): (key: string) => string {
  const { i18n } = useTranslation();
  const overrides = useSyncExternalStore(subscribe, getOrgRoleNames, getOrgRoleNames);
  const language = i18n.language;
  return useCallback((key: string) => builtInRoleName(key, language, overrides), [language, overrides]);
}
