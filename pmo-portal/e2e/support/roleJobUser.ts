import { expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, need, ok } from './jobFixtures';

/** Disposable real job-role login: parallel journeys never change a shared user's role. */
export async function roleJobUser(service: SupabaseClient, key: string, run: string) {
  const email = `${run}@example.test`;
  const password = `${crypto.randomUUID()}-Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error('No user created');
  const id = created.data.user.id;
  try {
    need('job profile', await service.from('profiles').insert({ id, org_id: ORG_ID, email, full_name: run, role: 'Engineer', status: 'active', built_in_role: key, locale: 'en', number_locale: 'en-US' }).select('id').single());
  } catch (error) { await service.auth.admin.deleteUser(id); throw error; }
  return {
    id,
    async signIn(page: Page) {
      await page.context().clearCookies();
      await page.goto('/login');
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await page.reload();
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
    },
    async cleanup() {
      ok('profile cleanup', await service.from('profiles').delete().eq('id', id));
      ok('login cleanup', await service.auth.admin.deleteUser(id));
    },
  };
}
