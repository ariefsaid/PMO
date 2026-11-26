import { useEffect } from 'react';
import { i18next } from '@/src/lib/i18n';
import { listStageNames } from '@/src/lib/db/stageNames';
import { setOrgStageNames } from '@/src/lib/status/orgStageNames';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

export const ORG_STAGE_NAMES_KEY = ['org-stage-names'] as const;

export function useOrgStageNames() {
  return useOrgQuery([...ORG_STAGE_NAMES_KEY], listStageNames, { staleness: 'session' });
}

/** Mount once in I18nProvider, beside useApplyOrgRoleNames. Re-renders the tree when the names change,
 *  the same way the terminology setting does (#2529). */
export function useApplyOrgStageNames(locale: string): void {
  const { data } = useOrgStageNames();
  useEffect(() => {
    if (setOrgStageNames(data ?? [], locale) && i18next.isInitialized) void i18next.changeLanguage(i18next.language);
  }, [data, locale]);
}
