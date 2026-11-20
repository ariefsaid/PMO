import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { rowsToOrgTerms, TERM_KEYS, TERM_LOCALES, type OrgTerms, type OrgTermRow, type TermKey, type TermLocale } from '@/src/lib/i18n/orgTerms';

/**
 * org_terminology DAL (#2529). One row per (term, language) in the caller's org; `org_id` is never
 * sent (RLS + stamp trigger, ADR-0017). Read = every member; write = Admin (RLS is the authority).
 */
export async function listOrgTerminology(): Promise<OrgTerms> {
  const { data, error } = await supabase
    .from('org_terminology')
    .select('term_key, locale, singular, plural')
    .limit(50); // bounded: 5 terms x 2 languages
  if (error) throw new AppError(error.message, error.code);
  return rowsToOrgTerms((data ?? []) as OrgTermRow[]);
}

export interface TermOverrideInput {
  key: TermKey;
  locale: TermLocale;
  singular: string;
  plural: string;
}

export function validateOverride(input: TermOverrideInput): string | null {
  if (!(TERM_KEYS as readonly string[]).includes(input.key)) return 'unknownTerm';
  if (!(TERM_LOCALES as readonly string[]).includes(input.locale)) return 'unknownLocale';
  const s = input.singular.trim();
  const p = input.plural.trim();
  if (!s || !p) return 'required';
  if (s.length > 60 || p.length > 60) return 'tooLong';
  return null;
}

export async function saveOrgTerm(input: TermOverrideInput): Promise<void> {
  const invalid = validateOverride(input);
  if (invalid) throw new AppError(invalid, 'validation');
  const { error } = await supabase.from('org_terminology').upsert(
    { term_key: input.key, locale: input.locale, singular: input.singular.trim(), plural: input.plural.trim(), updated_at: new Date().toISOString() },
    { onConflict: 'org_id,term_key,locale' },
  );
  if (error) throw new AppError(error.message, error.code);
}

/** Back to the shipped wording. */
export async function resetOrgTerm(key: TermKey, locale: TermLocale): Promise<void> {
  const { error } = await supabase.from('org_terminology').delete().eq('term_key', key).eq('locale', locale);
  if (error) throw new AppError(error.message, error.code);
}
