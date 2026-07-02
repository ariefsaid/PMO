/**
 * Fixtures for the deputy-invariant gate test.
 *
 * Mirrors supabase/tests/agent_write_create_activity_rls.test.sql (lines 22-44):
 * we need TWO orgs, a user per org, and a company + contact per org, so that:
 *   - User A (seeded Admin in org 1) can be driven to read companies / write a
 *     crm_activity, and
 *   - User B (provisioned here in org 2) provides the cross-org contact_id that
 *     the cross-tenant write assertion targets.
 *
 * Provisioning uses the postgres SUPERUSER (bypasses RLS) and the service_role
 * Admin API — this is test setup, NOT the system under test. Everything is
 * cleaned up in `teardownFixtures` so the run is idempotent / repeatable.
 */
import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const ORG_A_ID = "00000000-0000-0000-0000-000000000001";
export const ORG_B_ID = "00ff0009-0000-0000-0000-000000000002";
export const USER_B_ID = "00ff0009-0000-0000-0000-0000000000b2";
export const USER_B_EMAIL = "step5-gate-userb@example.com";
export const USER_B_PASSWORD = "Passw0rd!gate";
export const CO_B_ID = "00ff0009-0000-0000-0000-000000000051";
export const CONTACT_B_ID = "00ff0009-0000-0000-0000-000000000061";
export const PROJECT_A_ID = "00ff0009-0000-0000-0000-000000000071";
export const TASK_A_ID = "00ff0009-0000-0000-0000-000000000081";
export const PROJECT_B_ID = "00ff0009-0000-0000-0000-000000000072";
export const TASK_B_ID = "00ff0009-0000-0000-0000-000000000082";
export const ORG_A_EXTRA_COMPANY_IDS = Array.from({ length: 60 }, (_, index) =>
  `00ff0009-0000-0000-0000-${String(900100 + index).padStart(12, "0")}`,
);

// User A is the seeded Admin in org 1 (admin@acme.test) — its contact for the
// intra-tenant positive control.
export const USER_A_EMAIL = "admin@acme.test";
export const USER_A_PASSWORD = "Passw0rd!dev";
// A known org-1 contact (seeded). Verified present at probe time.
export const CONTACT_A_ID = "ce000000-0000-0000-0000-000000000001";

export interface Fixtures {
  /** Direct superuser postgres connection (bypasses RLS) for setup/teardown. */
  sql: ReturnType<typeof postgres>;
  /** service_role Admin client for auth user provisioning. */
  admin: SupabaseClient;
}

export function supabaseUrl(): string {
  return process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
}
export function anonKey(): string {
  const k = process.env.SUPABASE_ANON_KEY;
  if (!k) throw new Error("SUPABASE_ANON_KEY not set");
  return k;
}
export function serviceRoleKey(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return k;
}

export async function setupFixtures(): Promise<Fixtures> {
  const sql = postgres({
    host: "127.0.0.1",
    port: 54322,
    user: "postgres",
    database: "postgres",
    password: "postgres",
    idle_timeout: 5,
  });
  const admin = createClient(supabaseUrl(), serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 1. Organization B ───────────────────────────────────────────────────
  await sql`
    insert into organizations (id, name)
    values (${ORG_B_ID}, 'Step5 Gate Org B')
    on conflict (id) do nothing`;

  // ── 2. auth.users row for user B (Admin API) ────────────────────────────
  const { error: createErr } = await admin.auth.admin.createUser({
    id: USER_B_ID,
    email: USER_B_EMAIL,
    password: USER_B_PASSWORD,
    email_confirm: true,
  });
  if (createErr && !/already been registered/i.test(createErr.message)) {
    const { error: updErr } = await admin.auth.admin.updateUserById(USER_B_ID, {
      password: USER_B_PASSWORD,
      email: USER_B_EMAIL,
      email_confirm: true,
    });
    if (updErr) throw new Error(`could not (re)provision user B: ${createErr.message} / ${updErr.message}`);
  }

  // ── 3. profiles row tying user B to org B ───────────────────────────────
  await sql`
    insert into profiles (id, org_id, email, full_name, role)
    values (${USER_B_ID}, ${ORG_B_ID}, ${USER_B_EMAIL}, 'Step5 Gate User B', 'Project Manager')
    on conflict (id) do update set org_id = excluded.org_id, role = excluded.role, email = excluded.email`;

  // ── 4. org-2 company + contact (the cross-tenant write target) ──────────
  await sql`
    insert into companies (id, org_id, name, type)
    values (${CO_B_ID}, ${ORG_B_ID}, 'Step5 Gate Co B', 'Client')
    on conflict (id) do nothing`;
  await sql`
    insert into contacts (id, org_id, company_id, full_name)
    values (${CONTACT_B_ID}, ${ORG_B_ID}, ${CO_B_ID}, 'Step5 Gate Contact B')
    on conflict (id) do nothing`;

  // ── 5. org-1 bulk companies (caller-scope + row-cap proof for AC-404) ───
  for (const [index, companyId] of ORG_A_EXTRA_COMPANY_IDS.entries()) {
    await sql`
      insert into companies (id, org_id, name, type)
      values (${companyId}, ${ORG_A_ID}, ${`AC404 Org A Company ${index + 1}`}, 'Client')
      on conflict (id) do nothing`;
  }

  // ── 6. task fixtures for update_task_status ──────────────────────────────
  await sql`
    insert into projects (id, org_id, code, name, status)
    values (${PROJECT_A_ID}, ${ORG_A_ID}, 'AN-E2-A', 'Agent Native E2 Org A Project', 'Ongoing Project')
    on conflict (id) do nothing`;
  await sql`
    insert into tasks (id, org_id, project_id, name, status)
    values (${TASK_A_ID}, ${ORG_A_ID}, ${PROJECT_A_ID}, 'Agent Native E2 Org A Task', 'To Do')
    on conflict (id) do nothing`;

  await sql`
    insert into projects (id, org_id, code, name, status, project_manager_id)
    values (${PROJECT_B_ID}, ${ORG_B_ID}, 'AN-E2-B', 'Agent Native E2 Org B Project', 'Ongoing Project', ${USER_B_ID})
    on conflict (id) do nothing`;
  await sql`
    insert into tasks (id, org_id, project_id, name, status, assignee_id)
    values (${TASK_B_ID}, ${ORG_B_ID}, ${PROJECT_B_ID}, 'Agent Native E2 Org B Task', 'To Do', ${USER_B_ID})
    on conflict (id) do nothing`;

  return { sql, admin };
}

export async function teardownFixtures(f: Fixtures): Promise<void> {
  await f.sql`delete from crm_activities where subject like 'Step5 gate%' or subject like 'AC-405 %'`;
  await f.sql`delete from tasks where id in (${TASK_A_ID}, ${TASK_B_ID})`;
  await f.sql`delete from projects where id in (${PROJECT_A_ID}, ${PROJECT_B_ID})`;
  await f.sql`delete from contacts where id = ${CONTACT_B_ID}`;
  await f.sql`delete from companies where id = any(${[CO_B_ID, ...ORG_A_EXTRA_COMPANY_IDS] as unknown as string[]})`;
  await f.sql`delete from profiles where id = ${USER_B_ID}`;
  await f.admin.auth.admin.deleteUser(USER_B_ID);
  await f.sql`delete from organizations where id = ${ORG_B_ID}`;
  await f.sql.end({ timeout: 5 });
}

/**
 * Mint a real JWT for a user via the password grant. This is exactly the path
 * the deputy middleware sees: a Supabase-issued `access_token`.
 */
export async function mintJwt(email: string, password: string): Promise<string> {
  const res = await fetch(
    `${supabaseUrl()}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: anonKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!res.ok) {
    throw new Error(`password grant failed for ${email}: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`no access_token for ${email}`);
  return body.access_token;
}

/**
 * Query the DB for cross-tenant READ evidence: the companies that user A (org 1)
 * SHOULD be able to see, vs the org-2 company that MUST be invisible.
 */
export async function readAllCompanyIds(
  sql: ReturnType<typeof postgres>,
): Promise<{ org1: string[]; org2: string[] }> {
  const org1 = (
    await sql`select id from companies where org_id = ${ORG_A_ID}`
  ).map((r) => String(r.id));
  const org2 = (await sql`select id from companies where org_id = ${ORG_B_ID}`).map((r) =>
    String(r.id),
  );
  return { org1, org2 };
}

export async function readActivityBySubject(
  sql: ReturnType<typeof postgres>,
  subject: string,
): Promise<{ id: string; org_id: string | null; contact_id: string } | null> {
  const rows = await sql`
    select id, org_id, contact_id
    from crm_activities
    where subject = ${subject}
    limit 1`;

  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    org_id: row.org_id ? String(row.org_id) : null,
    contact_id: String(row.contact_id),
  };
}

export async function readTaskStatus(
  sql: ReturnType<typeof postgres>,
  taskId: string,
): Promise<string | null> {
  const rows = await sql`select status from tasks where id = ${taskId} limit 1`;
  return rows[0]?.status ? String(rows[0].status) : null;
}

export const AGENT_READ_ROW_CAP = 50;
