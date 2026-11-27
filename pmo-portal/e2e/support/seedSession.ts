import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { SEED_PASSWORD } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';
import { expect, type Page } from '@playwright/test';

/** Setup follows the same authenticated API and transition rules as the named actor. */
export async function seedSession(email: string, password = SEED_PASSWORD) {
  const env = loadEnv('development', process.cwd(), 'VITE_');
  const client = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

/** Disposable job actors use the same session replay as seed actors, without a login-screen redirect race. */
export async function signInJourneyActor(page: Page, email: string, password: string) {
  const client = await seedSession(email, password);
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw error ?? new Error('Journey actor has no session');
  const storageKey = `sb-${new URL(requireMatchingLocalSupabaseUrls(undefined, undefined)).hostname.split('.')[0]}-auth-token`;
  const path = '**/__journey_session';
  await page.route(path, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
  try { await page.goto('/__journey_session'); } finally { await page.unroute(path); }
  await page.evaluate(({ key, session }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(key, JSON.stringify(session));
  }, { key: storageKey, session: data.session });
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
}
