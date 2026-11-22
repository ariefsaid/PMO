import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { BUILT_IN_ROLES, type RoleNameOverrides } from '@/src/auth/builtInRoles';

/**
 * org_role_names DAL (#2712). One row per (role, language) in the caller's org; `org_id` is never sent
 * (RLS + stamp trigger, ADR-0017). Read = every member; write = Admin (RLS is the authority).
 */
export const ROLE_NAME_LOCALES = ['en', 'id'] as const;
export type RoleNameLocale = (typeof ROLE_NAME_LOCALES)[number];
export const ROLE_NAME_MAX = 60;

export interface RoleNameRow {
  role_key: string;
  locale: string;
  name: string;
}

export function rowsToRoleNames(rows: RoleNameRow[]): RoleNameOverrides {
  const known = new Set(BUILT_IN_ROLES.map((r) => r.key));
  const out: RoleNameOverrides = {};
  for (const r of rows) {
    if (!known.has(r.role_key) || !(ROLE_NAME_LOCALES as readonly string[]).includes(r.locale)) continue;
    (out[r.locale as RoleNameLocale] ??= {})[r.role_key] = r.name;
  }
  return out;
}

export async function listOrgRoleNames(): Promise<RoleNameOverrides> {
  const { data, error } = await supabase
    .from('org_role_names')
    .select('role_key, locale, name')
    .limit(100); // bounded: 28 roles x 2 languages = 56
  if (error) throw new AppError(error.message, error.code);
  return rowsToRoleNames((data ?? []) as RoleNameRow[]);
}

export interface RoleNameInput {
  roleKey: string;
  locale: RoleNameLocale;
  name: string;
}

export function validateRoleName(input: RoleNameInput): string | null {
  if (!BUILT_IN_ROLES.some((r) => r.key === input.roleKey)) return 'unknownRole';
  if (!(ROLE_NAME_LOCALES as readonly string[]).includes(input.locale)) return 'unknownLocale';
  const n = input.name.trim();
  if (!n) return 'required';
  if (n.length > ROLE_NAME_MAX) return 'tooLong';
  return null;
}

export async function saveOrgRoleName(input: RoleNameInput): Promise<void> {
  const invalid = validateRoleName(input);
  if (invalid) throw new AppError(invalid, 'validation');
  const { error } = await supabase.from('org_role_names').upsert(
    { role_key: input.roleKey, locale: input.locale, name: input.name.trim(), updated_at: new Date().toISOString() },
    { onConflict: 'org_id,role_key,locale' },
  );
  if (error) throw new AppError(error.message, error.code);
}

/** Back to the catalogue default name. */
export async function resetOrgRoleName(roleKey: string, locale: RoleNameLocale): Promise<void> {
  const { error } = await supabase.from('org_role_names').delete().eq('role_key', roleKey).eq('locale', locale);
  if (error) throw new AppError(error.message, error.code);
}
