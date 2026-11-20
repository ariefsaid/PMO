import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { requireServiceRoleKey } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

/** Seed ids (supabase/seed.sql): the org, the Project Manager and the Engineer. */
export const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
export const PM_ID = '00000000-0000-0000-0000-0000000000a2';
export const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';

/** A service-role client for seeding and cleanup; the journeys themselves always act through the UI. */
export function serviceClient(who: string): SupabaseClient {
  const key = requireServiceRoleKey();
  if (!key) throw new Error(`${who} needs SUPABASE_SERVICE_ROLE_KEY: run it via scripts/e2e-local.sh, which exports it`);
  const env = loadEnv('development', process.cwd(), 'VITE_');
  const url = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL);
  return createClient(url, key, { auth: { persistSession: false } });
}

export const need = (who: string) => <D>(step: string, r: { data: D; error: { message: string } | null }): NonNullable<D> => {
  if (r.error) throw new Error(`${who} ${step}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`${who} ${step}: no row returned`);
  return r.data as NonNullable<D>;
};

export const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

/** Runs SQL as the database owner in the local container, for jobs no role may call (the scheduled jobs). */
export function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8' }).trim();
}
