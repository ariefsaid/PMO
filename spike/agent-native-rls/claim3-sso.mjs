// claim3-sso.mjs — THROWAWAY SPIKE (delete after the gate decision is recorded).
//
// Purpose: ADR-0036 §9 claim #3 — "the agent panel shares PMO's session; no second login."
// The substantive, headless-testable core is SESSION PORTABILITY: a SECOND, independent
// supabase-js client (the agent-native "sidecar"), handed PMO's session tokens, authenticates
// as the SAME auth.uid() and gets the SAME RLS-scoped data with NO re-login.
//
// Handing tokens via setSession() is exactly what a cookie-Domain / postMessage / URL-hash bridge
// feeds the second app — so this proves the mechanism. The browser cookie-Domain *auto-share* UX
// (zero-code "no second login") remains the optional MANUAL check (see README) and needs a real
// parent domain (PMO prod is on *.pages.dev today).
//
// Env (exported by the runner from `supabase status -o env`):
//   SPIKE_SUPABASE_URL, SPIKE_ANON_KEY, SPIKE_SERVICE_ROLE_KEY, SPIKE_DB_URL
// Do NOT point this at production.

import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SPIKE_SUPABASE_URL;
const ANON = process.env.SPIKE_ANON_KEY;
const SERVICE = process.env.SPIKE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error('Missing SPIKE_SUPABASE_URL / SPIKE_ANON_KEY / SPIKE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sql = postgres(process.env.SPIKE_DB_URL, { max: 1, onnotice: () => {} });
const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, noPersist);

// --- fixtures ---
const ORG_A = '00000000-0000-0000-0000-000000000001'; // canonical/default org
const PROJ = 'c3000000-0000-0000-0000-0000000000c3';
const EMAIL = 'spike-claim3@example.com';
const PASSWORD = 'spike-Claim3-pw-123456';

async function findUserId() {
  // listUsers is paginated; the test DB is tiny, page 1 suffices.
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return data?.users?.find((u) => u.email === EMAIL)?.id ?? null;
}

async function setup() {
  // start clean (idempotent reruns)
  const existing = await findUserId();
  if (existing) await admin.auth.admin.deleteUser(existing);

  await sql`insert into organizations (id, name) values (${ORG_A}, 'Org A Spike') on conflict (id) do nothing`;

  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  const uid = data.user.id;

  // Stamp the profile into ORG_A with a writer/reader role (handle_new_user trigger, if any, may have
  // pre-created a row — UPSERT so we own org_id/role deterministically).
  await sql`
    insert into profiles (id, org_id, full_name, email, role)
    values (${uid}, ${ORG_A}, 'Spike Claim3', ${EMAIL}, 'Project Manager')
    on conflict (id) do update set org_id = excluded.org_id, role = excluded.role
  `;
  await sql`
    insert into projects (id, org_id, name, status)
    values (${PROJ}, ${ORG_A}, 'Spike Claim3 Project', 'Ongoing Project')
    on conflict (id) do nothing
  `;
  return uid;
}

async function teardown(uid) {
  try {
    await sql`delete from projects where id = ${PROJ}`;
    if (uid) await sql`delete from profiles where id = ${uid}`;
    if (uid) await admin.auth.admin.deleteUser(uid);
  } catch (err) {
    console.error('teardown error (ignored):', err.message);
  }
}

const results = [];
function record(name, pass, detail) {
  if (results.some((r) => r.name === name)) throw new Error(`duplicate assertion name: ${name}`);
  results.push({ name, pass, detail });
}

async function projectCount(client) {
  const { data, error } = await client.from('projects').select('id').eq('id', PROJ);
  if (error) throw new Error(`projects read failed: ${error.message}`);
  return data.length;
}

async function main() {
  const uid = await setup();
  try {
    // App #1 = "PMO": real login → real session tokens.
    const app1 = createClient(URL, ANON, noPersist);
    const { data: s1, error: e1 } = await app1.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (e1) throw new Error(`signInWithPassword failed: ${e1.message}`);
    const tokens = { access_token: s1.session.access_token, refresh_token: s1.session.refresh_token };
    const uid1 = s1.user.id;

    record('#1 PMO authenticated read', (await projectCount(app1)) === 1 && uid1 === uid,
      `uid=${uid1 === uid ? 'match' : 'MISMATCH'}, own-org project visible`);

    // App #2 = "sidecar": a SEPARATE, independent client handed PMO's tokens (the portability test).
    const app2 = createClient(URL, ANON, noPersist);
    const { error: e2 } = await app2.auth.setSession(tokens);
    if (e2) throw new Error(`setSession failed: ${e2.message}`);
    const { data: u2 } = await app2.auth.getUser();
    record('#2 sidecar same identity (no re-login)', u2?.user?.id === uid1,
      `sidecar uid=${u2?.user?.id ?? 'none'} (expected ${uid1})`);
    record('#3 sidecar same RLS-scoped data', (await projectCount(app2)) === 1,
      'sidecar sees exactly the user’s own-org project');

    // App #3 = negative control: no session → unauthenticated, RLS yields nothing.
    const app3 = createClient(URL, ANON, noPersist);
    const { data: u3 } = await app3.auth.getUser();
    record('#4 no-session control denied', !u3?.user && (await projectCount(app3)) === 0,
      `anon user=${u3?.user ? 'PRESENT?!' : 'none'}, rows=0`);
  } finally {
    await teardown(uid);
  }
}

function summarize() {
  console.log('\n=== Claim #3 — session portability (ADR-0036 §9) ===\n');
  for (const r of results) console.log(`${r.pass ? '✓' : '✗'} ${r.name} — ${r.detail}`);
  const passed = results.length === 4 && results.every((r) => r.pass);
  console.log('');
  console.log(`CLAIM #3 (session portability): ${passed ? 'PASS' : 'FAIL'}`);
  return passed;
}

let passed = false;
try {
  await main();
  passed = summarize();
} catch (err) {
  console.error('spike crashed:', err);
  passed = false;
} finally {
  await sql.end();
}
process.exit(passed ? 0 : 1);
