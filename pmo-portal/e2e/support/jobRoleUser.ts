import { expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pinEnglishLocale } from '../helpers';
import { baseLevelOf } from '../../src/auth/builtInRoles';
import { sqlAsOwner } from './jobFixtures';

/** Only for a newly created disposable tenant: approved records and audit rows need owner cleanup. */
export function removeJobOrganization(orgId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new Error('Expected a fixture organisation UUID');
  sqlAsOwner(`do $$ declare r record; begin
    for r in select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
      where c.table_schema='public' and c.column_name='org_id' and t.table_type='BASE TABLE'
    loop execute format('delete from public.%I where org_id = %L::uuid', r.table_name, '${orgId}'); end loop;
    delete from public.organizations where id='${orgId}';
  end $$;`);
}

/** Own disposable login: never edits a shared seed person's job role. */
export async function createJobRoleUser(db: SupabaseClient, orgId: string, jobRole: string) {
  const role = baseLevelOf(jobRole);
  if (!role) throw new Error('Unknown job role: ' + jobRole);
  const email = `journey-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID() + 'Aa1!';
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  const profile = await db.from('profiles').upsert({ id, org_id: orgId, email, full_name: `Journey ${jobRole}`, role, built_in_role: jobRole, status: 'active' });
  if (profile.error) { await db.auth.admin.deleteUser(id); throw profile.error; }
  return {
    id,
    async signIn(page: Page) {
      await pinEnglishLocale(page);
      await page.goto('/login');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.locator('#email').fill(email);
      await page.locator('#password').fill(password);
      await page.locator('form button[type=submit]').click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
    },
    async remove() {
      const deleted = await db.auth.admin.deleteUser(id);
      if (deleted.error) throw deleted.error;
    },
  };
}
