// @e2e-isolation: serial — turns the shared org's `stock` entitlement OFF (org-global state) and
// creates a second tenant for the cross-tenant arm; both restored in afterAll.
/**
 * AC-PLN-015 — one journey proves the whole switch (FR-PLN-005, FR-PLN-006, FR-PLN-015).
 *
 * Given the Operator turns `stock` OFF for org A (the seed org), when a user of org A opens the app
 * and asks the assistant about stock, then the warehouse is absent from navigation, `/stock` shows
 * not-available, and the assistant says it is not on the plan — while a user of a freshly created
 * org B still sees Stock and `/stock`.
 *
 * The Operator's own JWT does the switch (`operator_toggle_feature`, the S1 RPC the console calls):
 * the spec never impersonates the Operator through another org's session and never writes the
 * entitlement table directly. Org A's prior override is captured up front and restored in afterAll,
 * so a retry or a later run starts from the same state.
 *
 * Arms:
 *   (a) org A loses the rail item and `/stock` is unusable — runs in the ordinary serial lane.
 *   (b) org B (new tenant, no override) still has Stock and `/stock` — runs in the ordinary lane.
 *   (c) the assistant says stock is not on the plan — REQUIRES the served-functions lane
 *       (`scripts/serve-functions.sh`) AND the agent-assistant capability flag; when the lane is
 *       absent the arm is an explicit skip with an explainable allowlist entry (check-e2e-skips.mjs),
 *       never a silent drop and never asserted against a mocked reply.
 *
 * Run (ordinary): npm run e2e -- --project=serial --workers=1 e2e/serial/AC-PLN-015-switch-off-journey.spec.ts
 * Run (with the assistant arm): scripts/serve-functions.sh -- npx playwright test --project=serial \
 *   --workers=1 e2e/serial/AC-PLN-015-switch-off-journey.spec.ts (VITE_FEATURES_AGENT_ASSISTANT=true)
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { signIn, SEED_PASSWORD } from '../helpers';

const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AGENT_FLAG = process.env.VITE_FEATURES_AGENT_ASSISTANT === 'true';

/** The seed org (supabase/seed.sql §A) — org A in this journey. */
const ORG_A = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const OPERATOR_EMAIL = 'operator@pmo.test';
const ORG_A_ADMIN = 'admin@acme.test';

const ASSISTANT_READY = Boolean(FUNCTIONS_URL && AGENT_FLAG);
if (FUNCTIONS_URL && !AGENT_FLAG) {
  throw new Error(
    'AC-PLN-015: the served-functions lane is up but the agent-assistant capability flag is off — ' +
      'set VITE_FEATURES_AGENT_ASSISTANT=true for the lane rather than letting the assistant arm vanish.',
  );
}

test.setTimeout(180_000);

const STOCK_RAIL = /^stock$/i;
const stockRailItem = (page: Page) => page.getByRole('link', { name: STOCK_RAIL });

/** An org-B member created for this run only (org row + auth user + profile), torn down after. */
interface OrgB {
  orgId: string;
  userId: string;
  email: string;
}

let admin!: SupabaseClient;
let orgB!: OrgB;
/** What org A's stock override was before this journey, so afterAll can put it back exactly. */
let previousOverride: boolean | null = null;
let operator!: SupabaseClient;

/** Sign in through the real form — a just-created user has no captured storageState fixture. */
async function signInFresh(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

/** A Supabase client acting as the real Operator (his own JWT), never service role. */
async function operatorClient(): Promise<SupabaseClient> {
  const authClient = createClient(AUTH_URL, ANON_KEY);
  const { data, error } = await authClient.auth.signInWithPassword({ email: OPERATOR_EMAIL, password: SEED_PASSWORD });
  if (error || !data.session) throw new Error(`operator sign-in failed: ${error?.message}`);
  return createClient(AUTH_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

async function setStock(enabled: boolean) {
  const { error } = await operator.rpc('operator_toggle_feature', {
    p_org_id: ORG_A,
    p_key: 'stock',
    p_enabled: enabled,
  });
  if (error) throw new Error(`operator_toggle_feature(stock=${enabled}) failed: ${error.message}`);
}

async function clearStockOverride() {
  const { error } = await operator.rpc('operator_clear_feature_override', { p_org_id: ORG_A, p_key: 'stock' });
  if (error) throw new Error(`operator_clear_feature_override(stock) failed: ${error.message}`);
}

/**
 * The goal oracle for "the module is not available to this org": the app either states it plainly or
 * takes the user away from the module's URL. Both are the same user-visible outcome (the module is
 * unreachable), and asserting the outcome — not one particular S3 composition — keeps the journey
 * honest when S3 picks the exact not-available rendering.
 */
async function expectStockUnavailable(page: Page) {
  await expect
    .poll(
      async () => {
        const path = new URL(page.url()).pathname;
        if (path !== '/stock') return 'left-stock';
        const told = await page
          .getByRole('main')
          .getByText(/not (available|included)|isn'?t (on|included in) (your|the) plan|not on your plan/i)
          .first()
          .isVisible()
          .catch(() => false);
        return told ? 'told' : 'still-usable';
      },
      { timeout: 20_000, message: '/stock must be unusable (redirected or a not-available state) for an org without stock' },
    )
    .not.toBe('still-usable');
}

test.describe('AC-PLN-015 — the switch turns a module off for one org and leaves the other alone', () => {
  test.beforeAll(async () => {
    if (!SERVICE_KEY || !ANON_KEY) {
      throw new Error('AC-PLN-015 needs SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY — run through scripts/e2e-local.sh');
    }
    admin = createClient(AUTH_URL, SERVICE_KEY);
    operator = await operatorClient();

    // Capture the prior org-A override (service_role has SELECT only on the table), then start from
    // the plan/global default (ON) so "turn it off" is the only state change this journey measures.
    const { data: prior, error: priorError } = await admin
      .from('org_features')
      .select('enabled')
      .eq('org_id', ORG_A)
      .eq('feature_key', 'stock')
      .maybeSingle();
    if (priorError) throw new Error(`reading org A's stock override failed: ${priorError.message}`);
    previousOverride = prior ? Boolean(prior.enabled) : null;
    await clearStockOverride();
    await setStock(false);

    // Org B: a genuinely separate tenant with one active Admin member and no entitlement override.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const orgId = crypto.randomUUID();
    const email = `pln015-orgb-${suffix}@acme.test`;
    const { error: orgError } = await admin.from('organizations').insert({ id: orgId, name: `AC-PLN-015 Org B ${suffix}` });
    if (orgError) throw new Error(`seed org B failed: ${orgError.message}`);
    const { data: created, error: userError } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (userError || !created.user) throw new Error(`create org-B user failed: ${userError?.message}`);
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: created.user.id, org_id: orgId, email, full_name: 'Org B Admin', role: 'Admin', status: 'active' }, { onConflict: 'id' });
    if (profileError) throw new Error(`seed org-B profile failed: ${profileError.message}`);
    orgB = { orgId, userId: created.user.id, email };
  });

  test.afterAll(async () => {
    // Restore org A exactly: the prior explicit value, or no override at all.
    if (operator) {
      if (previousOverride === null) await clearStockOverride().catch(() => undefined);
      else await setStock(previousOverride).catch(() => undefined);
    }
    if (admin && orgB) {
      await admin.from('profiles').delete().eq('id', orgB.userId);
      await admin.auth.admin.deleteUser(orgB.userId).catch(() => undefined);
      await admin.from('organizations').delete().eq('id', orgB.orgId);
    }
  });

  test('AC-PLN-015 (a) with stock OFF, an org-A member loses the Stock nav item and /stock is unusable', async ({ page }) => {
    await signIn(page, ORG_A_ADMIN);

    // The rail renders on the dashboard: Stock is ABSENT for this org.
    await expect(stockRailItem(page)).toHaveCount(0, { timeout: 20_000 });

    // A deep link does not resurrect the module: no page, no data — unavailable.
    await page.goto('/stock');
    await expectStockUnavailable(page);
  });

  test('AC-PLN-015 (b) an org-B member (no override) still sees Stock and /stock', async ({ page }) => {
    await signInFresh(page, orgB.email);

    await expect(stockRailItem(page)).toBeVisible({ timeout: 20_000 });
    await page.goto('/stock');
    // Stock on hand is the module's own page title (public/locales/en/stock.json onHand.title).
    await expect(page.getByRole('heading', { name: /stock on hand/i })).toBeVisible({ timeout: 20_000 });
  });

  (ASSISTANT_READY ? test : test.skip)(
    'AC-PLN-015 (c) the assistant tells an org-A member that stock is not on the plan',
    { annotation: { type: 'requires', description: 'served-functions lane + agent-assistant capability flag' } },
    async ({ page }) => {
      await signIn(page, ORG_A_ADMIN);

      await page.getByRole('button', { name: /^assistant$/i }).click();
      const panel = page.getByRole('complementary', { name: /agent assistant/i });
      await expect(panel).toBeVisible({ timeout: 20_000 });

      await panel.getByRole('textbox', { name: /ask a question/i }).fill('What stock do we have right now?');
      await panel.getByRole('button', { name: /send message/i }).click();

      // The answer must name the real reason (the module is not on this org's plan / not available),
      // not an empty list that reads as "you have none".
      await expect(
        panel.getByText(/not (on|included in) (your|the) plan|isn'?t (on|included in) (your|the) plan|stock (module )?is (off|disabled)|not available/i).first(),
      ).toBeVisible({ timeout: 120_000 });
      await expect(panel.getByText(/no stock|you have none|0 items/i)).toHaveCount(0);
    },
  );
});
