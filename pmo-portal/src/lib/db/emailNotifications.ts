import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Email channel settings DAL (#2711; migrations 1220-1223). Reads are RLS-scoped (Admin: the org's event settings and
 * language; any user: their own opt-out). Every write is a SECURITY DEFINER RPC that re-checks the role. org_id is never sent.
 */
export const EMAIL_EVENTS = ['approval_request', 'billing_step', 'overdue_item', 'document_expiry'] as const;
export type EmailEvent = (typeof EMAIL_EVENTS)[number];
export type EmailLocale = 'en' | 'id';
export interface EmailEventSetting { event: EmailEvent; enabled: boolean; extraRoles: string[] }
export interface EmailSettings { events: EmailEventSetting[]; locale: EmailLocale }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: string): any => supabase.from(name as never);
type RpcResult = PromiseLike<{ error: { message: string; code?: string } | null }>;
const rpc = (fn: string, args: Record<string, unknown>): RpcResult =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => RpcResult).call(supabase, fn, args);
function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }

/** Every event is listed; an event with no stored row is OFF with no extra recipients (the shipped default). */
export async function getEmailSettings(): Promise<EmailSettings> {
  const ev = await table('email_event_settings').select('event_key, enabled, extra_roles');
  if (ev.error) fail(ev.error);
  const loc = await table('email_org_settings').select('locale').maybeSingle();
  if (loc.error) fail(loc.error);
  const rows = (ev.data ?? []) as Array<{ event_key: EmailEvent; enabled: boolean; extra_roles: string[] }>;
  return {
    events: EMAIL_EVENTS.map((event) => {
      const r = rows.find((x) => x.event_key === event);
      return { event, enabled: r?.enabled ?? false, extraRoles: r?.extra_roles ?? [] };
    }),
    locale: ((loc.data as { locale?: EmailLocale } | null)?.locale) ?? 'en',
  };
}

export async function setEmailEvent(event: EmailEvent, enabled: boolean, extraRoles: string[]): Promise<void> {
  const { error } = await rpc('set_email_event_setting', { p_event: event, p_enabled: enabled, p_extra_roles: extraRoles });
  if (error) fail(error);
}

export async function setEmailLocale(locale: EmailLocale): Promise<void> {
  const { error } = await rpc('set_email_locale', { p_locale: locale });
  if (error) fail(error);
}

export async function getMyEmailOptOut(): Promise<boolean> {
  const { data, error } = await table('email_user_prefs').select('opted_out').maybeSingle();
  if (error) fail(error);
  return Boolean((data as { opted_out?: boolean } | null)?.opted_out);
}

export async function setMyEmailOptOut(optedOut: boolean): Promise<void> {
  const { error } = await rpc('set_my_email_opt_out', { p_opted_out: optedOut });
  if (error) fail(error);
}
