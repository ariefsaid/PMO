// @e2e-isolation: serial — shared helpers for the P3c budget served-fn e2e lane.
// Flips the shared org's external_domain_ownership + org bindings (org-global state).
/**
 * Shared seed + cleanup for AC-BUD-030/031 (P3c, ADR-0055 §6 + ADR-0059 Posture B).
 *
 * Seeds, per run:
 *  - A FRESH ERPNext `Project` + a PMO `projects` row whose start/end dates sit inside ONE ERPNext
 *    `Fiscal Year` (the gate resolves the year from the client's own Fiscal Year doctype and fails
 *    closed on a multi-FY span — FR-BUD-124).
 *  - A pre-activated `external_org_bindings` row carrying `company` + `project_map`.
 *  - The `external_domain_ownership` flip (`domain:'budget'`).
 *  - The Admin-administered `budget_category_account_map` bijection (FR-BUD-111) — PMO's
 *    `budget_category` → the client's own ERP account. Without it the push fails closed.
 *  - A Draft `budget_versions` row + its `budget_line_items`.
 *
 * ⚑ The fresh ERP Project is what makes "how many Budgets exist for this (company, FY, project)" a
 * meaningful, run-scoped question: ERP enforces at most one `Budget` per (company, fiscal_year,
 * project, account), so a duplicate is only ever visible on the bench — never in PMO.
 */
import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const ORG_ID = '00000000-0000-0000-0000-000000000001';
/** The local seed password every e2e user shares (`supabase/seed.sql`). */
export const SEED_PASSWORD = 'Passw0rd!dev';
export const ERPNEXT_SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
export const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
export const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
export const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';

export const ERP_COMPANY = 'PMO Smoke Co';
/** Two REAL leaf expense accounts on the bench chart (never a group node, never a suspense default). */
export const LABOR_ACCOUNT = 'Administrative Expenses - PSC';
export const MATERIALS_ACCOUNT = 'Commission on Sales - PSC';

/** A Finance user may activate a budget version (OD-BUDGET-3 write roles). */
export const ACTIVATOR_EMAIL = 'finance@acme.test';

const benchHeaders = (): Record<string, string> => ({
  Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`,
  'Content-Type': 'application/json',
});

export async function benchGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BENCH_URL}${path}`, { headers: benchHeaders() });
  const body = (await res.json()) as { data?: T };
  if (!res.ok) throw new Error(`bench GET ${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body.data as T;
}

export async function benchPost<T = unknown>(doctype: string, body: unknown): Promise<T> {
  // Frappe's naming-series counter (`tabSeries`) can raise a QueryDeadlockError under back-to-back
  // inserts. That is bench plumbing, not product behaviour — retry it rather than let it masquerade as
  // a failed AC. Any other non-2xx throws immediately.
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BENCH_URL}/api/resource/${encodeURIComponent(doctype)}`, {
      method: 'POST',
      headers: benchHeaders(),
      body: JSON.stringify(body),
    });
    const parsed = (await res.json()) as { data?: T; exc_type?: string };
    if (res.ok) return parsed.data as T;
    last = `bench POST ${doctype} -> ${res.status} ${JSON.stringify(parsed).slice(0, 400)}`;
    if (parsed.exc_type !== 'QueryDeadlockError') throw new Error(last);
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(last);
}

export interface ErpBudgetSummary {
  name: string;
  docstatus: number;
  fiscal_year: string;
  budget_against: string;
  project: string | null;
}

/**
 * Every ERPNext `Budget` for this project — EXCLUDING cancelled ones (docstatus 2), because a
 * cancel+amend upsert legitimately leaves the superseded document behind as a tombstone. What must
 * never exceed one is the number of LIVE budgets enforcing controls on (company, FY, project).
 */
export async function listLiveErpBudgets(erpProject: string): Promise<ErpBudgetSummary[]> {
  const filters = encodeURIComponent(JSON.stringify([['project', '=', erpProject], ['docstatus', '<', 2]]));
  const fields = encodeURIComponent(JSON.stringify(['name', 'docstatus', 'fiscal_year', 'budget_against', 'project']));
  return (await benchGet(`/api/resource/Budget?limit_page_length=0&filters=${filters}&fields=${fields}`)) as ErpBudgetSummary[];
}

/** EVERY Budget for the project, cancelled included — used to prove a revision did not simply
 *  abandon the old object and create a parallel live one. */
export async function listAllErpBudgets(erpProject: string): Promise<ErpBudgetSummary[]> {
  const filters = encodeURIComponent(JSON.stringify([['project', '=', erpProject]]));
  const fields = encodeURIComponent(JSON.stringify(['name', 'docstatus', 'fiscal_year', 'budget_against', 'project']));
  return (await benchGet(`/api/resource/Budget?limit_page_length=0&filters=${filters}&fields=${fields}`)) as ErpBudgetSummary[];
}

export interface ErpBudgetDoc extends ErpBudgetSummary {
  company: string;
  action_if_annual_budget_exceeded: string;
  action_if_annual_budget_exceeded_on_po: string;
  action_if_accumulated_monthly_budget_exceeded: string;
  accounts: Array<{ account: string; budget_amount: number }>;
}

/** The per-document read — the ONLY way to see a Budget's `accounts` child rows (the list endpoint
 *  silently drops child tables; budget-write spike §10(b)). */
export async function readErpBudget(name: string): Promise<ErpBudgetDoc> {
  return (await benchGet(`/api/resource/Budget/${encodeURIComponent(name)}`)) as ErpBudgetDoc;
}

/** The budgeted amount ERP is enforcing for one account on one Budget. */
export function accountAmount(doc: ErpBudgetDoc, account: string): number | undefined {
  return doc.accounts.find((a) => a.account === account)?.budget_amount;
}

export interface BudSeed {
  suffix: string;
  projectId: string;
  erpProject: string;
  /** Every `budget_versions.id` this run created — cleanup deletes each (line items cascade). */
  versionIds: string[];
  /**
   * ⚑ MEDIUM-2 (money-safety audit round 7) — THE ORG-GLOBAL STATE THIS RUN TOUCHED, AS IT WAS FOUND.
   *
   * `external_org_bindings`, `external_domain_ownership` and `budget_category_account_map` are keyed on
   * the ORG, not on this run's project, so every budget spec mutates state it shares with the whole
   * suite AND with `supabase/seed.sql`. Cleanup used to DELETE those rows unconditionally, which meant a
   * budget spec silently stripped the seeded org's ERPNext tier for every spec that ran after it — and
   * the symptom is a later spec quietly taking a different branch, not a failure pointing here. (Same
   * family as the shared-auth-mutation trap that only surfaced at a promote.)
   *
   * So the run snapshots what it found and PUTS IT BACK. Only rows this run itself created are deleted.
   */
  prior: {
    /** The org's whole erpnext binding row before this run, or `null` if there was none. */
    binding: Record<string, unknown> | null;
    /** Did `(org, erpnext, budget)` domain ownership already exist? */
    ownsBudgetDomain: boolean;
    /** The category→account rows this run overwrites, exactly as they were. */
    categoryMap: Array<{ org_id: string; category: string; erp_account: string }>;
  };
}

/** The ERPNext `Fiscal Year` covering `date`, read from the client's OWN calendar (never derived). */
export async function fiscalYearContaining(date: string): Promise<string> {
  const fields = encodeURIComponent(JSON.stringify(['name', 'year_start_date', 'year_end_date']));
  const years = (await benchGet(`/api/resource/Fiscal Year?limit_page_length=0&fields=${fields}`)) as Array<{
    name: string;
    year_start_date: string;
    year_end_date: string;
  }>;
  const match = years.filter((y) => date >= y.year_start_date && date <= y.year_end_date);
  if (match.length !== 1) throw new Error(`the bench has ${match.length} Fiscal Years containing ${date} — the fixture needs exactly one`);
  return match[0].name;
}

/** Seed the org for a budget e2e. `projectStart`/`projectEnd` must sit inside ONE Fiscal Year. */
export async function seedBud(
  admin: SupabaseClient,
  suffix: string,
  opts: { projectStart: string; projectEnd: string },
): Promise<BudSeed> {
  const projectId = crypto.randomUUID();
  const erpProject = ((await benchPost('Project', { project_name: `PMO-E2E-BUD-${suffix}`, company: ERP_COMPANY })) as { name: string }).name;

  const { error: projErr } = await admin.from('projects').insert({
    id: projectId,
    org_id: ORG_ID,
    name: `BUD-PROJ-${suffix}`,
    status: 'Ongoing Project',
    start_date: opts.projectStart,
    end_date: opts.projectEnd,
  });
  if (projErr) throw new Error(`seed projects failed: ${projErr.message}`);

  // ⚑ MERGE into the org's single erpnext binding rather than clobbering it — the timesheets lane
  // shares this one `(org_id, external_tier)` row, and overwriting its config makes an unrelated spec
  // fail with a bogus `activity-type-unconfigured`.
  const { data: existingBinding } = await admin
    .from('external_org_bindings').select('*')
    .eq('org_id', ORG_ID).eq('external_tier', 'erpnext').maybeSingle();
  const priorBinding = (existingBinding as Record<string, unknown> | null) ?? null;
  const priorConfig = ((priorBinding?.config as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const priorMap = (priorConfig.project_map as Record<string, string> | undefined) ?? {};
  const { error: bindingErr } = await admin.from('external_org_bindings').upsert(
    {
      org_id: ORG_ID,
      external_tier: 'erpnext',
      site_url: ERPNEXT_SITE_URL,
      secret_ref: 'local-bench',
      webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET',
      version_major: 15,
      // ⚑ `budget_overspend_action` is DELIBERATELY unset: FR-BUD-131 says the default must be 'Warn',
      // never 'Stop' (which would start BLOCKING the client's purchase orders org-wide as a side effect
      // of an integration). The spec asserts the default that results.
      config: { ...priorConfig, company: ERP_COMPANY, project_map: { ...priorMap, [projectId]: erpProject } },
      activated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,external_tier' },
  );
  if (bindingErr) throw new Error(`seed external_org_bindings failed: ${bindingErr.message}`);

  // Snapshot BEFORE the flip — cleanup restores exactly this.
  const { data: priorOwnRow } = await admin
    .from('external_domain_ownership').select('id')
    .eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'budget').maybeSingle();
  const ownsBudgetDomain = Boolean(priorOwnRow);
  const { error: flipErr } = await admin
    .from('external_domain_ownership')
    .upsert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'budget' }, { onConflict: 'org_id,external_tier,domain' });
  if (flipErr) throw new Error(`seed external_domain_ownership failed: ${flipErr.message}`);

  // THE CRUX (FR-BUD-110..113): the Admin-administered category→account bijection.
  const { data: priorMapRows } = await admin
    .from('budget_category_account_map').select('org_id, category, erp_account')
    .eq('org_id', ORG_ID).in('category', ['Labor', 'Materials']);
  const { error: mapErr } = await admin.from('budget_category_account_map').upsert(
    [
      { org_id: ORG_ID, category: 'Labor', erp_account: LABOR_ACCOUNT },
      { org_id: ORG_ID, category: 'Materials', erp_account: MATERIALS_ACCOUNT },
    ],
    { onConflict: 'org_id,category' },
  );
  if (mapErr) throw new Error(`seed budget_category_account_map failed: ${mapErr.message}`);

  return {
    suffix,
    projectId,
    erpProject,
    versionIds: [],
    prior: {
      binding: priorBinding,
      ownsBudgetDomain,
      categoryMap: (priorMapRows as Array<{ org_id: string; category: string; erp_account: string }> | null) ?? [],
    },
  };
}

/** Seed a Draft budget version + its line items. */
export async function seedDraftVersion(
  admin: SupabaseClient,
  seed: BudSeed,
  input: { name: string; version: number; lines: Array<{ category: 'Labor' | 'Materials'; amount: string }> },
): Promise<string> {
  const versionId = crypto.randomUUID();
  const { error } = await admin.from('budget_versions').insert({
    id: versionId,
    org_id: ORG_ID,
    project_id: seed.projectId,
    version: input.version,
    name: input.name,
    status: 'Draft',
  });
  if (error) throw new Error(`seed budget_versions failed: ${error.message}`);
  const { error: lineErr } = await admin.from('budget_line_items').insert(
    input.lines.map((l) => ({ org_id: ORG_ID, budget_version_id: versionId, category: l.category, budgeted_amount: l.amount })),
  );
  if (lineErr) throw new Error(`seed budget_line_items failed: ${lineErr.message}`);
  seed.versionIds.push(versionId);
  return versionId;
}

export async function readBudgetMirror(
  admin: SupabaseClient,
  versionId: string,
): Promise<{ push_state: string; push_error: string | null; erp_budget_name: string | null; fiscal_year: string } | null> {
  const { data, error } = await admin
    .from('budget_version_erp_mirror')
    .select('push_state, push_error, erp_budget_name, fiscal_year')
    .eq('org_id', ORG_ID)
    .eq('budget_version_id', versionId)
    .maybeSingle();
  if (error) throw new Error(`budget mirror read failed: ${error.message}`);
  return data as never;
}

export async function cleanupBud(admin: SupabaseClient, seed: BudSeed): Promise<void> {
  for (const versionId of seed.versionIds) {
    await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'budget').eq('pmo_record_id', versionId);
    await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'budget').eq('pmo_record_id', versionId);
    await admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'budget').eq('pmo_record_id', versionId);
    await admin.from('budget_version_erp_mirror').delete().eq('budget_version_id', versionId);
    await admin.from('budget_line_items').delete().eq('budget_version_id', versionId);
    await admin.from('budget_versions').delete().eq('id', versionId);
  }
  // Any version the UI created (a clone) that the run did not register explicitly.
  await admin.from('budget_versions').delete().eq('project_id', seed.projectId);
  await admin.from('notifications').delete().eq('org_id', ORG_ID).contains('metadata', { action_required: 'budget-push-failed' });
  await admin.from('projects').delete().eq('id', seed.projectId);

  // ── ⚑ MEDIUM-2: ORG-GLOBAL STATE IS RESTORED, NEVER DELETED ─────────────────────────────────────
  // These three tables are keyed on the ORG, so they are shared with every other spec AND with
  // `supabase/seed.sql`. Deleting them (the previous behaviour) meant one budget spec stripped the
  // seeded org's ERPNext tier for the rest of the run — after which any surface gated on domain
  // ownership silently renders its not-employed branch, and the failure surfaces somewhere else
  // entirely, as flake. Put back exactly what was found; delete only what this run introduced.
  const priorMap = seed.prior?.categoryMap ?? [];
  const priorCategories = priorMap.map((r) => r.category);
  // Rows this run ADDED (a category with no prior row) go; rows it OVERWROTE are restored verbatim.
  const addedCategories = ['Labor', 'Materials'].filter((c) => !priorCategories.includes(c));
  if (addedCategories.length > 0) {
    await admin.from('budget_category_account_map').delete().eq('org_id', ORG_ID).in('category', addedCategories);
  }
  if (priorMap.length > 0) {
    await admin.from('budget_category_account_map').upsert(priorMap, { onConflict: 'org_id,category' });
  }

  if (!seed.prior?.ownsBudgetDomain) {
    await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'budget');
  }

  if (seed.prior?.binding) {
    // Restore the WHOLE row (site_url/secret_ref/config/activated_at) — `seedBud` merges into config,
    // and the timesheets lane shares this same `(org_id, external_tier)` row.
    await admin.from('external_org_bindings').upsert(seed.prior.binding, { onConflict: 'org_id,external_tier' });
  } else {
    await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  }
}

// ---------------------------------------------------------------------------
// The user's real journey through the Budget tab (no page.route, no forged commands).
// ---------------------------------------------------------------------------

/** Open a project's Budget tab and wait for it to settle. */
export async function openBudgetTab(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/budget`);
  await expect(page.getByTestId('budget-loading')).not.toBeVisible({ timeout: 20_000 });
}

/**
 * The page shows ONE version card at a time — pick the version by its name in the version select.
 *
 * ⚑ ONE definition of "the option for this version", used for BOTH the wait and the selection. A
 * separate `locator('option', { hasText })` wait explodes on Playwright strict mode once a CLONE of the
 * same version exists (`"<name> (copy)"` contains `"<name>"`), which is the normal state after a
 * revision — while the selection itself resolved the FIRST match. The dropdown lists versions in
 * ascending version order, so the first match is the original, which is the one the user is picking.
 */
export async function selectVersion(page: Page, versionName: string): Promise<void> {
  const versionSelect = page.getByLabel('Version');
  await expect(versionSelect).toBeVisible({ timeout: 20_000 });
  const optionValue = async (): Promise<string | null> =>
    page.evaluate((name: string) => {
      const sel = document.getElementById('budget-version-select') as HTMLSelectElement | null;
      return sel ? (Array.from(sel.options).find((o) => o.text.includes(name))?.value ?? null) : null;
    }, versionName);
  await expect
    .poll(optionValue, { timeout: 20_000, message: `version "${versionName}" is not offered in the version select` })
    .not.toBeNull();
  await versionSelect.selectOption((await optionValue())!);
  await expect(page.getByTestId('version-card')).toContainText(versionName, { timeout: 20_000 });
}

/**
 * Activate the selected version through the confirm-gated UI and assert the user is told it LANDED.
 *
 * ⚑ The success toast is a real oracle, not decoration: ADR-0059 §3.2 makes the ERP push a consequence
 * of activation, so PMO reports success either way — and the app deliberately says
 * "Version activated — but ERPNext was not updated" when the push did not land. Accepting any toast
 * would make this journey pass while the client's ERP kept enforcing the previous budget.
 */
export async function activateSelectedVersion(page: Page, diagnose?: () => Promise<string>): Promise<void> {
  const card = page.getByTestId('version-card');
  await card.getByRole('button', { name: 'Activate' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Activate version', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 60_000 });

  // PMO's transition always succeeds (ADR-0059 §3.2), so the app distinguishes the two outcomes in the
  // TOAST: 'Version activated' vs 'Version activated — but ERPNext was not updated'. Wait for whichever
  // arrives, then insist on the first — the second means the client's ERP is still enforcing the
  // previous budget, which is exactly the failure this journey exists to catch.
  const outcome = page.getByText(/^Version activated/);
  await expect(outcome.first()).toBeVisible({ timeout: 60_000 });
  const heading = (await outcome.first().innerText()).trim();
  if (heading !== 'Version activated') {
    const detail = diagnose ? await diagnose() : '(no push diagnostics available)';
    throw new Error(`the activation's ERP push did NOT land — the app reported "${heading}". Push state: ${detail}`);
  }
  await expect(page.getByTestId('version-card').getByTestId('version-status-active')).toBeVisible({ timeout: 20_000 });
}

/** "Clone to revise" the selected version; returns once the new Draft is the selected card. */
export async function cloneSelectedVersion(page: Page): Promise<void> {
  await page.getByTestId('version-card').getByRole('button', { name: 'Clone to revise' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Clone version', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('version-card').getByTestId('version-status-draft')).toBeVisible({ timeout: 20_000 });
}

/** Revise one line item's budgeted amount on the selected Draft card. */
export async function editLineItemAmount(page: Page, category: string, amount: string): Promise<void> {
  const card = page.getByTestId('version-card');
  await card.getByRole('button', { name: `Edit line item ${category}` }).click();
  const input = card.getByLabel('Amount', { exact: true });
  await input.fill(amount);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByRole('button', { name: `Edit line item ${category}` })).toBeVisible({ timeout: 20_000 });
}

/** Sign in and return the access token (the served `adapter-dispatch` needs a REAL caller JWT). */
export async function signInAsBud(authUrl: string, anonKey: string, email: string): Promise<string> {
  const authClient = createClient(authUrl, anonKey);
  const { data, error } = await authClient.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

/** The DETERMINISTIC budget push key (`src/lib/adapterSeam/erpnext/budgetPushKey.ts`), restated so a
 *  spec can predict what BOTH originators derive. */
export function budgetPushKeyFor(versionId: string, activatedAt: string): string {
  return `bud:${versionId}:${Date.parse(activatedAt)}`;
}

/** The version's server-stamped activation witness — the key's own input (0139). */
export async function readActivatedAtBud(admin: SupabaseClient, versionId: string): Promise<string> {
  const { data, error } = await admin.from('budget_versions').select('activated_at').eq('id', versionId).maybeSingle();
  if (error) throw new Error(`activated_at read failed: ${error.message}`);
  const stamp = (data as { activated_at: string | null } | null)?.activated_at;
  if (!stamp) throw new Error(`version ${versionId} has no activated_at stamp`);
  return stamp;
}

/** POST a budget push command at the REAL served `adapter-dispatch` — the SAME command
 *  `src/lib/db/budgets.ts` sends (`dispatchBudgetPush`), optionally with a named fault seam armed. */
export async function dispatchBudgetPushRaw(
  functionsUrl: string,
  anonKey: string,
  accessToken: string,
  versionId: string,
  idempotencyKey: string,
  faultSeam?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (faultSeam) headers['x-erpnext-test-fault'] = faultSeam;
  return fetch(`${functionsUrl}/functions/v1/adapter-dispatch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      domain: 'budget',
      operation: 'create',
      record: { id: versionId, erp_doc_kind: 'budget' },
      idempotencyKey,
    }),
  });
}

/** Drive the REAL `erpnext-sweep` tick (the budget push's SECOND originator). */
export async function runSweepBud(functionsUrl: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${functionsUrl}/functions/v1/erpnext-sweep`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.ERPNEXT_SWEEP_SECRET ?? 'e2e-erpnext-sweep-secret'}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return { status: res.status, body: await res.json() };
}

/** This version's outbox row, as the recovery machinery sees it. */
export async function readBudgetOutbox(
  admin: SupabaseClient,
  versionId: string,
): Promise<{ id: string; state: string; last_error: string | null; claim_generation: number } | null> {
  const { data, error } = await admin
    .from('external_command_outbox')
    .select('id, state, last_error, claim_generation')
    .eq('org_id', ORG_ID)
    .eq('domain', 'budget')
    .eq('pmo_record_id', versionId)
    .maybeSingle();
  if (error) throw new Error(`budget outbox read failed: ${error.message}`);
  return data as never;
}

/** Activate a Draft version through `activate_budget_version` AS A REAL USER. The RPC is
 *  SECURITY DEFINER and re-asserts `auth.uid()` + role internally, so a service-role client is
 *  refused 42501 — the activation authority is a person, never the machine. */
export async function activateVersionAs(
  authUrl: string,
  anonKey: string,
  email: string,
  versionId: string,
): Promise<void> {
  const client = createClient(authUrl, anonKey);
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (signInErr) throw new Error(`sign-in failed for ${email}: ${signInErr.message}`);
  const { error } = await client.rpc('activate_budget_version', { version_id: versionId });
  if (error) throw new Error(`activate_budget_version(${versionId}) failed: ${error.message}`);
}

/** Cancel a submitted bench document (`docstatus: 2`) — the accountant's own Desk action, done over
 *  the same stock REST surface PMO uses. */
export async function benchCancel(doctype: string, name: string): Promise<void> {
  const res = await fetch(`${BENCH_URL}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: benchHeaders(),
    body: JSON.stringify({ docstatus: 2 }),
  });
  if (!res.ok) throw new Error(`bench CANCEL ${doctype}/${name} -> ${res.status} ${(await res.text()).slice(0, 400)}`);
}
