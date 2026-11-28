import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase/client';
import { rowsToOrgTerms, type OrgTermRow } from '@/src/lib/i18n/orgTerms';
import { rowsToRoleNames, type RoleNameRow } from '@/src/lib/db/orgRoleNames';
import { projectResolvedFeatures, type ResolvedFeatureRow } from '@/src/lib/db/orgFeatures';
import { toOrgPlan } from '@/src/lib/db/orgPlan';
import type { StageNameRow } from '@/src/lib/status/orgStageNames';
import { ORG_TERMINOLOGY_KEY } from '@/src/hooks/useOrgTerminology';
import { ORG_ROLE_NAMES_KEY } from '@/src/hooks/useOrgRoleNames';
import { ORG_STAGE_NAMES_KEY } from '@/src/hooks/useOrgStageNames';
import { orgFeatureQueryKey, orgPlanGroupQueryKey } from '@/src/hooks/useOrgFeatures';
import { HIDE_PRICES_ENABLED_KEY, MAY_SEE_PRICES_KEY } from '@/src/hooks/useHidePrices';

/**
 * `shell_bootstrap()` (migration 2810): the signed-in shell's start-up reads in ONE request. Security invoker,
 * so row-level security and each called function still decide every answer. A section the server leaves out
 * (an inactive member's features and plan; the price answer while hiding is off) is not seeded, so its own
 * hook makes that request exactly as before.
 */
export interface ShellBootstrap {
  profile: { id: string; org_id: string | null } & Record<string, unknown> | null;
  org?: { default_locale: string | null; default_number_locale: string | null; default_timezone: string | null } | null;
  terminology?: OrgTermRow[];
  role_names?: RoleNameRow[];
  stage_names?: StageNameRow[];
  features?: ResolvedFeatureRow[];
  plan?: unknown;
  is_operator?: boolean;
  hide_prices_enabled?: boolean;
  may_see_prices?: boolean;
}

/** `null` when the call fails or is not deployed yet: the caller then reads the profile on its own. */
export async function readShellBootstrap(): Promise<ShellBootstrap | null> {
  try {
    const { data, error } = await supabase.rpc('shell_bootstrap');
    if (error || !data || typeof data !== 'object' || !('profile' in data)) return null;
    return data as unknown as ShellBootstrap;
  } catch {
    return null;
  }
}

/** Put each answer under the key (and in the shape) its own hook reads, so no hook re-requests it. */
export function seedShellQueries(qc: QueryClient, boot: ShellBootstrap): void {
  const profile = boot.profile;
  if (!profile?.org_id) return;
  const org = profile.org_id;
  const set = (key: readonly unknown[], value: unknown) => qc.setQueryData(key, value);
  if (boot.org !== undefined) {
    set(['org-locale-defaults', org], {
      defaultLocale: boot.org?.default_locale ?? null,
      defaultNumberLocale: boot.org?.default_number_locale ?? null,
      defaultTimezone: boot.org?.default_timezone ?? null,
    });
  }
  if (boot.terminology) set([...ORG_TERMINOLOGY_KEY, org], rowsToOrgTerms(boot.terminology));
  if (boot.role_names) set([ORG_ROLE_NAMES_KEY[0], org], rowsToRoleNames(boot.role_names));
  if (boot.stage_names) set([ORG_STAGE_NAMES_KEY[0], org], boot.stage_names);
  if (boot.features) set(orgFeatureQueryKey(org), projectResolvedFeatures(boot.features));
  if (boot.plan !== undefined) set(orgPlanGroupQueryKey(org), toOrgPlan(boot.plan));
  if (typeof boot.is_operator === 'boolean') set(['operator', 'isOperator'], boot.is_operator);
  if (typeof boot.hide_prices_enabled === 'boolean') set([HIDE_PRICES_ENABLED_KEY, org], boot.hide_prices_enabled);
  if (typeof boot.may_see_prices === 'boolean') set([MAY_SEE_PRICES_KEY, org, profile.id], boot.may_see_prices);
}
