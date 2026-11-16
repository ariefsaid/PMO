// @e2e-isolation: self-isolated — registers its OWN OAuth client; creates a run-scoped engineer whose line manager is the seeded PM and a project named "E2E CTM-017 <run>". Claims are immutable once signed off, so the project is archived and the run's users disabled at the end, never deleted.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ownedContextOptions, requireServiceRoleKey, SEED_PASSWORD } from './helpers';
import { ANON_KEY, SUPABASE_URL, createCliHarness } from './support/pmoCli';

/**
 * AC-CTM-017 (#1856) — one T&M month run from the command line against the real stack: Finance A keeps the rate card,
 * assigns the engineer, and (after the engineer's week is entered and approved through the app's own calls) assembles the
 * claim and prepares its sign-off. The CLI's logic is unit-tested in scripts/pmo-tm.test.mjs; this proves the guard,
 * RLS and the RPCs accept exactly what the CLI sends.
 */
test.describe.configure({ mode: 'default' });
test.setTimeout(240_000);

const SEED_ORG = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const FINANCE_A = 'finance@acme.test';
const MANAGER = 'pm@acme.test';
const HOURS = 8;
const RATE = 50_000;
const cli = createCliHarness('PMO CLI CTM e2e ');

let admin: SupabaseClient;
let projectId = '';
let documentId = '';
let weekStart = '';
const users = {} as Record<'engineer', { id: string; email: string }>;
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-ctm-a-'));

const day = (iso: string, add: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + add * 86_400_000).toISOString().slice(0, 10);
function writeJson(dir: string, name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}
/** A browser-equivalent session (no client_id): the app's own RPC calls, as the Timesheets screen makes them. */
async function appSession(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw new Error(`AC-CTM-017 sign-in ${email}: ${error.message}`);
  return client;
}
async function fixtureUser(role: 'Engineer', label: string, extra: Record<string, unknown> = {}) {
  const email = `e2e-ctm-017-${label}-${RUN}@acme.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`AC-CTM-017 fixture user: ${error?.message}`);
  const profile = await admin.from('profiles').upsert({ id: data.user.id, org_id: SEED_ORG, email, full_name: `CTM ${label}`, role, status: 'active', ...extra }, { onConflict: 'id' });
  if (profile.error) throw new Error(`AC-CTM-017 fixture profile: ${profile.error.message}`);
  return { id: data.user.id, email };
}

test.beforeAll(async () => {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('AC-CTM-017 requires the local Supabase stack');
  admin = createClient(SUPABASE_URL, requireServiceRoleKey() ?? '', { auth: { persistSession: false } });
  await cli.register(RUN);
  const manager = await admin.from('profiles').select('id').eq('email', MANAGER).single();
  if (manager.error) throw new Error(`AC-CTM-017 seeded manager: ${manager.error.message}`);
  users.engineer = await fixtureUser('Engineer', 'eng', { manager_id: manager.data.id });
  const today = new Date();
  weekStart = day(today.toISOString().slice(0, 10), -((today.getUTCDay() + 6) % 7));
  const company = await admin.from('companies').insert({ org_id: SEED_ORG, name: `E2E CTM-017 ${RUN} Client`, type: 'Client' }).select('id').single();
  if (company.error) throw new Error(`AC-CTM-017 client: ${company.error.message}`);
  const project = await admin.from('projects').insert({
    org_id: SEED_ORG, name: `E2E CTM-017 ${RUN}`, status: 'Ongoing Project', currency: 'IDR', client_id: company.data.id,
    project_manager_id: manager.data.id, contract_value: 10_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false,
    tax_rate: null, tax_base_numerator: 1, tax_base_denominator: 1, start_date: weekStart, end_date: day(weekStart, 365),
  }).select('id').single();
  if (project.error) throw new Error(`AC-CTM-017 project: ${project.error.message}`);
  projectId = project.data.id;
  documentId = randomUUID();
  const doc = await admin.from('project_documents').insert({
    id: documentId, org_id: SEED_ORG, project_id: projectId, category: 'Client sign-off', title: `Approved hours ${RUN}`,
    revision: 'A', status: 'Issued', file_path: `${SEED_ORG}/${projectId}/${documentId}/hours.pdf`, author_id: manager.data.id,
  });
  if (doc.error) throw new Error(`AC-CTM-017 document: ${doc.error.message}`);
});

test.afterAll(async () => {
  if (!admin) return;
  if (projectId) await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId);
  const ids = Object.values(users).map((u) => u.id);
  if (ids.length) await admin.from('profiles').update({ status: 'disabled' }).in('id', ids);
  await cli.sweepClients();
  fs.rmSync(dirA, { recursive: true, force: true });
});

test('AC-CTM-017 Finance runs the T&M month from the CLI: rates, assignment, assembly and sign-off preparation on approved hours', async ({ browser }, testInfo) => {
  const loginA = await cli.loginAs(browser, dirA, { email: FINANCE_A }, ownedContextOptions(testInfo));
  expect(loginA.code, loginA.stderr).toBe(0);

  // A keeps the rate card: the preview writes nothing, --apply saves the line.
  const rates = writeJson(dirA, 'rates.json', [{ project_id: projectId, kind: 'labour', label: 'Field engineer', unit: 'hour', rate: RATE, currency: 'IDR', effective_from: weekStart }]);
  const preview = await cli.pmo(dirA, ['tm', 'rates', 'set', rates]);
  expect(preview.code, preview.stderr).toBe(0);
  expect((await admin.from('contract_rate_lines').select('id').eq('project_id', projectId)).data).toEqual([]);
  const saved = await cli.pmo(dirA, ['tm', 'rates', 'set', rates, '--apply']);
  expect(saved.code, saved.stderr).toBe(0);
  const lineKey = (saved.json as { saved: { line_key: string }[] }).saved[0].line_key;
  const assign = writeJson(dirA, 'assign.json', [{ project_id: projectId, line_key: lineKey, user_id: users.engineer.id, effective_from: weekStart }]);
  const assigned = await cli.pmo(dirA, ['tm', 'assign', 'set', assign, '--apply']);
  expect(assigned.code, assigned.stderr).toBe(0);

  // The engineer enters the week and the line manager approves it: the app's own calls (no CLI).
  const engineer = await appSession(users.engineer.email);
  const sheet = await engineer.rpc('save_timesheet_week', { p_timesheet_id: null, p_week_start_date: weekStart, p_upserts: [{ project_id: projectId, entry_date: weekStart, hours: HOURS, notes: 'CTM-017' }], p_delete_ids: [] });
  expect(sheet.error).toBeNull();
  expect((await engineer.rpc('transition_timesheet', { p_timesheet_id: sheet.data, p_to: 'Submitted' })).error).toBeNull();
  const manager = await appSession(MANAGER);
  expect((await manager.rpc('transition_timesheet', { p_timesheet_id: sheet.data, p_to: 'Approved' })).error).toBeNull();

  // A assembles the approved hours at the contract rate; a rerun assembles nothing more.
  const window = ['--project', projectId, '--from', weekStart, '--to', day(weekStart, 6)];
  const assembled = await cli.pmo(dirA, ['tm', 'claim', 'assemble', ...window, '--apply']);
  expect(assembled.code, assembled.stderr).toBe(0);
  const claim = assembled.json as { claim_id: string; claim: { lines: { units: number; rate: number; amount: number }[] } };
  expect(claim.claim.lines).toEqual([expect.objectContaining({ units: HOURS, rate: RATE, amount: HOURS * RATE })]);
  const again = await cli.pmo(dirA, ['tm', 'claim', 'assemble', ...window, '--apply']);
  expect((again.json as { status: string }).status).toBe('already_assembled');

  // A prepares the sign-off against the Issued document.
  const prepared = await cli.pmo(dirA, ['tm', 'signoff', 'prepare', claim.claim_id, '--project', projectId, '--document', documentId, '--apply']);
  expect(prepared.code, prepared.stderr).toBe(0);
  expect(prepared.json).toMatchObject({ applied: true, document_id: documentId, signoff_is_current: true });
});
