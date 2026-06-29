// rls-parity.mjs — THROWAWAY SPIKE (delete after the gate decision is recorded).
//
// Purpose: prove ADR-0036 §9 spike gate, claim #1 — Drizzle ORM's `.rls()`
// transaction wrapper enforces Supabase Row-Level Security IDENTICALLY to the
// app's normal supabase-js / PostgREST path.
//
// How it proves it: Drizzle's `createDrizzle(...).rls(tx => ...)` simply opens a
// transaction and runs `set local role authenticated` + `set_config('request.jwt.claims', …, true)`
// before the query — the exact same binding PMO's pgTAP suite uses
// (supabase/tests/0002_tenant_isolation.test.sql). So we replicate that wrapper
// directly on the raw `postgres` (porsager) driver; no agent-native framework needed.
//
// The connecting role is the superuser `postgres`:
//   - WITHOUT the wrapper  -> queries BYPASS RLS (superuser) — the failure mode.
//   - WITH the wrapper     -> effective role is non-superuser `authenticated`, RLS applies.
// That asymmetry is the whole point of assertion #5.
//
// Run (handled by the runner script, which exports SPIKE_DB_URL from `npx supabase status`):
//   node spike/agent-native-rls/rls-parity.mjs
// Do NOT point this at production.

import postgres from 'postgres';

// --- connection (privileged superuser; the wrapper drops to `authenticated`) ---
const sql = postgres(process.env.SPIKE_DB_URL, { max: 1, onnotice: () => {} });

// --- fixture constants (exact UUIDs) ---
const ORG_A = '00000000-0000-0000-0000-000000000001'; // canonical/default org
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const USER_A = 'a0000000-0000-0000-0000-0000000000a1'; // profile in ORG_A, 'Project Manager'
const USER_B = 'b0000000-0000-0000-0000-0000000000b1'; // profile in ORG_B, 'Project Manager'
const PROJ_A = 'a1111111-0000-0000-0000-000000000001'; // project in ORG_A
const PROJ_B = 'b1111111-0000-0000-0000-000000000002'; // project in ORG_B

// --- setup: seed fixtures as superuser (bypasses RLS, like the pgTAP fixtures) ---
async function setup() {
  await sql`
    insert into organizations (id, name) values
      (${ORG_A}, 'Org A Spike'),
      (${ORG_B}, 'Org B Spike')
    on conflict (id) do nothing
  `;

  await sql`
    insert into auth.users (id, email) values
      (${USER_A}, 'spike-user-a@example.com'),
      (${USER_B}, 'spike-user-b@example.com')
    on conflict (id) do nothing
  `;

  await sql`
    insert into profiles (id, org_id, full_name, email, role) values
      (${USER_A}, ${ORG_A}, 'Spike User A', 'spike-user-a@example.com', 'Project Manager'),
      (${USER_B}, ${ORG_B}, 'Spike User B', 'spike-user-b@example.com', 'Project Manager')
    on conflict (id) do nothing
  `;

  await sql`
    insert into projects (id, org_id, name, status) values
      (${PROJ_A}, ${ORG_A}, 'Spike Project A', 'Ongoing Project'),
      (${PROJ_B}, ${ORG_B}, 'Spike Project B', 'Ongoing Project')
    on conflict (id) do nothing
  `;
}

// --- teardown: remove only what we created; leave canonical ORG_A alone ---
async function teardown() {
  try {
    await sql`delete from projects where id in (${PROJ_A}, ${PROJ_B})`;
    await sql`delete from projects where org_id = ${ORG_B}`; // any spike spawn in ORG_B
    // self-heal: sweep the named rows #3/#4 may create in ORG_A if a prior run was interrupted
    await sql`delete from projects where name in ('Spike default-org', 'Spike spoof')`;
    await sql`delete from profiles where id in (${USER_A}, ${USER_B})`;
    await sql`delete from auth.users where id in (${USER_A}, ${USER_B})`;
    await sql`delete from organizations where id = ${ORG_B}`;
    // ORG_A is the canonical/default org — referenced elsewhere — never delete.
  } catch (err) {
    console.error('teardown error (ignored):', err.message);
  }
}

// --- THE rls wrapper — faithfully mirrors Drizzle `.rls()` ---
// Opens a tx, drops to `authenticated`, sets the JWT claims, runs the query.
function asUser(claimsSub, fn) {
  const claims = JSON.stringify({ sub: claimsSub, role: 'authenticated' });
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated`);
    // bound parameter (not string-interpolated) — safer, and a closer match to how
    // Drizzle `.rls()` actually binds the claim.
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    return await fn(tx);
  });
}

// --- tiny assert harness (no test framework) ---
const results = [];
function record(name, pass, detail) {
  // guard: a duplicate name would let summarize()'s last-write-wins silently hide an
  // earlier failure under the same key. Fail loud instead.
  if (results.some((r) => r.name === name)) throw new Error(`duplicate assertion name: ${name}`);
  results.push({ name, pass, detail });
}

async function run(name, fn) {
  try {
    await fn();
  } catch (err) {
    record(name, false, `unexpected error: ${err.code ? err.code + ' ' : ''}${err.message}`);
  }
}

async function main() {
  await setup();

  // #1 own-org read — A sees its own row.
  await run('#1 own-org read', async () => {
    const [{ count }] = await asUser(USER_A, (tx) =>
      tx`select count(*)::int as count from projects where id = ${PROJ_A}`
    );
    record('#1 own-org read', count === 1, `count=${count} (expected 1)`);
  });

  // #2 cross-org read isolation (THE killer) — RLS hides B from A.
  await run('#2 cross-org read isolation', async () => {
    const [{ count }] = await asUser(USER_A, (tx) =>
      tx`select count(*)::int as count from projects where id = ${PROJ_B}`
    );
    record('#2 cross-org read isolation', count === 0, `count=${count} (expected 0 — B hidden from A)`);
  });

  // #3 in-org write via column default — insert WITHOUT org_id; default = ORG_A = caller org.
  await run('#3 in-org write via default', async () => {
    const rows = await asUser(USER_A, (tx) =>
      tx`insert into projects (name, status) values ('Spike default-org', 'Leads') returning id, org_id`
    );
    const ok = rows.length === 1 && rows[0].org_id === ORG_A;
    record('#3 in-org write via default', ok, `inserted org_id=${rows[0]?.org_id} (expected ${ORG_A})`);
    // clean up the inserted row (superuser).
    if (rows[0]?.id) await sql`delete from projects where id = ${rows[0].id}`;
  });

  // #4 cross-org write blocked — WITH CHECK rejects spoofed org_id with SQLSTATE 42501.
  // NOTE: 'Project Manager' IS in the projects writer role-set (0002_rls.sql), so the only
  // path to 42501 here is the cross-org WITH CHECK — not the coarse role gate. (If the role
  // set ever changes, re-stamp this test the way 0002_tenant_isolation.test.sql isolates the cause.)
  await run('#4 cross-org write blocked', async () => {
    let threw = null;
    try {
      await asUser(USER_A, (tx) =>
        tx`insert into projects (org_id, name, status) values (${ORG_B}, 'Spike spoof', 'Leads')`
      );
    } catch (err) {
      threw = err;
    }
    const ok = threw != null && threw.code === '42501';
    record(
      '#4 cross-org write blocked',
      ok,
      threw ? `threw SQLSTATE ${threw.code} (expected 42501)` : 'no error thrown (expected 42501 reject)'
    );
  });

  // #5 KILL TEST — same query as #2 but WITHOUT the wrapper (bare superuser).
  // Passes when the bypass IS observed (count===1): proves a privileged / non-.rls()
  // connection leaks cross-org, justifying ADR-0036's "never hand the agent
  // service_role / always use .rls()" rule.
  await run('#5 kill test (bypass risk)', async () => {
    const [{ count }] = await sql`select count(*)::int as count from projects where id = ${PROJ_B}`;
    const bypassed = count === 1;
    record(
      '#5 kill test (bypass risk)',
      bypassed,
      bypassed
        ? `count=${count} — bypass confirmed — this is the failure mode the guard prevents`
        : `count=${count} (expected 1 bypass; superuser did NOT bypass — unexpected)`
    );
  });
}

// --- summary + gate verdict ---
function summarize() {
  console.log('\n=== RLS parity spike (ADR-0036 §9, claim #1) ===\n');
  for (const r of results) {
    console.log(`${r.pass ? '✓' : '✗'} ${r.name} — ${r.detail}`);
  }

  const byName = Object.fromEntries(results.map((r) => [r.name, r.pass]));
  const enforced =
    byName['#1 own-org read'] &&
    byName['#2 cross-org read isolation'] &&
    byName['#3 in-org write via default'] &&
    byName['#4 cross-org write blocked'];
  const bypassConfirmed = byName['#5 kill test (bypass risk)'] === true;
  const passed = enforced && bypassConfirmed;

  console.log('');
  console.log(`SPIKE CLAIM #1: ${passed ? 'PASS' : 'FAIL'}`);
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
  await teardown();
  await sql.end();
}

process.exit(passed ? 0 : 1);
