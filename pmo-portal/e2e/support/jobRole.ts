import { expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { baseLevelOf } from '../../src/auth/builtInRoles';
import { ORG_ID, need, ok, serviceClient, sqlAsOwner } from './jobFixtures';
import { execFileSync } from 'node:child_process';

type JobRoleOptions = {
  jobRole: string;
  role?: string;
  org?: string;
  service?: SupabaseClient;
  run?: string;
};

/** Create a disposable login and its job-role profile for a journey. */
export async function jobRoleUser({
  jobRole, role, org = ORG_ID, service = serviceClient('job-role fixture'), run,
}: JobRoleOptions) {
  const email = `${run ?? `journey-${crypto.randomUUID()}`}@example.test`;
  const password = `${crypto.randomUUID()}-Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error('No user created');
  const id = created.data.user.id;
  try {
    need('job profile', await service.from('profiles').upsert({
      id,
      org_id: org,
      email,
      full_name: run ?? 'Journey worker',
      role: role ?? baseLevelOf(jobRole) ?? 'Engineer',
      status: 'active',
      built_in_role: jobRole,
      locale: 'en',
      number_locale: 'en-US',
    }).select('id').single());
  } catch (error) { await service.auth.admin.deleteUser(id); throw error; }
  return {
    id,
    email,
    password,
    removeLogin: async () => ok('login cleanup', await service.auth.admin.deleteUser(id)),
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
      // Approvals and other journey steps notify the user; the notification would block the profile delete.
      ok('notification cleanup', await service.from('notifications').delete().eq('owner_id', id));
      releaseProfileReferences(id);
      ok('profile cleanup', await service.from('profiles').delete().eq('id', id));
      ok('login cleanup', await service.auth.admin.deleteUser(id));
    },
  };
}

/** Rows the disposable user created (a project it managed, a request it raised, a warehouse it kept) still point at its profile.
 *  Nullable references are cleared (the row is deleted where its state requires the person) and required ones deleted, so the profile can go whatever a journey did. Scoped to this one id.
 *  Cascading deletes are tried first; if an append-only rule blocks them, the same pass runs with triggers off. */
function releaseProfileReferences(id: string): void {
  const body = `do $$ declare r record; begin
    for r in select c.conrelid::regclass as tbl, a.attname as col, a.attnotnull as req
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.confdeltype not in ('c', 'n')
        and c.conrelid <> 'public.profiles'::regclass loop
      if r.req then execute format('delete from %s where %I = %L', r.tbl, r.col, '${id}');
      else
        begin execute format('update %s set %I = null where %I = %L', r.tbl, r.col, r.col, '${id}');
        exception when check_violation then execute format('delete from %s where %I = %L', r.tbl, r.col, '${id}'); end;
      end if;
    end loop;
    update public.profiles set manager_id = null where manager_id = '${id}';
  end $$;`;
  try {
    execFileSync('docker', ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], { input: body, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    sqlAsOwner(body);
  }
}
