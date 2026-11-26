import type { SupabaseClient } from '@supabase/supabase-js';
import { jobRoleUser } from './jobRole';
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

/** Compatibility entry point for journeys that own their whole organisation. */
export async function createJobRoleUser(db: SupabaseClient, orgId: string, jobRole: string) {
  const role = baseLevelOf(jobRole);
  if (!role) throw new Error('Unknown job role: ' + jobRole);
  const actor = await jobRoleUser({ service: db, org: orgId, jobRole, role, displayName: `Journey ${jobRole}` });
  return { id: actor.id, signIn: actor.signIn, remove: actor.removeLogin };
}
