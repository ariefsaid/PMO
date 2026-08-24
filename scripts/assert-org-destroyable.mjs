#!/usr/bin/env node
/**
 * Fail-fast operator guard for org-wholesale maintenance commands.
 * The database function remains authoritative; this check only avoids starting
 * a long reseed/wipe command when the target is protected.
 */
import process from 'node:process';

export async function assertOrgDestroyable(client, orgId) {
  if (!orgId) throw new Error('An org id is required for wholesale operations.');
  try {
    await client.query('select public.assert_org_destroyable($1::uuid)', [orgId]);
  } catch (error) {
    throw new Error(`Refusing wholesale operation for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const orgId = process.argv[2];
  const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error('DATABASE_URL or SUPABASE_DB_URL is required.');
    process.exitCode = 2;
  } else {
    const { Client } = await import('pg');
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await assertOrgDestroyable(client, orgId);
      console.log(`Org ${orgId} is explicitly destroyable (demo/test).`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
