import { expect, request as pwRequest, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEED_PASSWORD = 'Passw0rd!dev';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Directory the `setup` Playwright project (e2e/auth.setup.ts) writes captured sessions to. */
export const AUTH_DIR = path.join(__dirname, '.auth');

interface CapturedStorageState {
  origins: { origin: string; localStorage?: { name: string; value: string }[] }[];
}

/**
 * Require SUPABASE_SERVICE_ROLE_KEY for specs that need service-role admin access.
 * Fails loudly in CI (throws) but skips gracefully in local development.
 *
 * Pattern: in a beforeAll or at the top of a spec file:
 *   const svcKey = requireServiceRoleKey();
 *   if (!svcKey) test.skip(true, 'SERVICE_ROLE_KEY not set (local) — skipping');
 */
export function requireServiceRoleKey(): string | undefined {
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;
  if (!svcKey && process.env.CI) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY missing in CI — this spec cannot silently skip');
  }
  return svcKey;
}

/**
 * Sign in as `email` by injecting a pre-captured session rather than driving the /login form.
 *
 * #306: the `setup` Playwright project (e2e/auth.setup.ts) runs once per test run and, for
 * each seed role, does ONE real form sign-in and saves the resulting `storageState` (the
 * localStorage the Supabase browser client persists its session in — `persistSession: true`,
 * src/lib/supabase/client.ts) to `e2e/.auth/<email>.json`. This function reads that fixture and
 * replays it directly, so specs land authenticated without paying a real bcrypt verification per
 * call. That per-spec bcrypt cost was the root cause of the old retry/backoff loop (a shared
 * CI GoTrue instance intermittently rejecting valid creds under concurrent-login load) — with
 * no real per-call sign-in, that flake's precondition is gone, so the retry loop is removed.
 *
 * Any prior session is cleared before injecting, so calling this multiple times within one spec
 * (to switch users mid-test) fully replaces the active session each time.
 *
 * The goal-oracle is UNCHANGED: the final assertion is still a hard `toHaveURL(/\/$/)`.
 *
 * @param password unused for injection (the captured session already encodes a successful
 *   sign-in) — kept so the call signature is unchanged for the 70+ existing call sites.
 */
export async function signIn(page: Page, email: string, password = SEED_PASSWORD) {
  void password;

  const statePath = path.join(AUTH_DIR, `${email}.json`);
  let state: CapturedStorageState;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf-8')) as CapturedStorageState;
  } catch {
    throw new Error(
      `signIn: no captured session fixture for "${email}" at ${statePath}. ` +
        `Run the Playwright "setup" project first (e2e/auth.setup.ts), or — if "${email}" is a ` +
        'new seed user — add it to the SEED_EMAILS list in e2e/auth.setup.ts.'
    );
  }

  // Iterate ALL origins' localStorage rather than matching a single expected origin: the app
  // is captured and replayed against the same baseURL in practice, but this stays robust to
  // any origin variance between the setup run and the spec run.
  const entries = state.origins.flatMap((origin) => origin.localStorage ?? []);
  if (entries.length === 0) {
    throw new Error(`signIn: captured session fixture for "${email}" at ${statePath} has no localStorage entries.`);
  }

  // First nav may land on /login (localStorage still empty on the first signIn of a fresh
  // context) — that's fine, it just gives us the app origin to write localStorage against.
  await page.goto('/');
  await page.evaluate((items: { name: string; value: string }[]) => {
    localStorage.clear();
    for (const { name, value } of items) localStorage.setItem(name, value);
  }, entries);
  // Re-navigate to '/' rather than reload(): reload() reloads the CURRENT url, which — if the
  // app's async unauth-redirect already bounced us to /login — would reload /login (no
  // already-authed guard there) and hang the assertion. An explicit goto('/') boots the app
  // authenticated (session now in localStorage) and lands deterministically on '/'.
  await page.goto('/');

  await expect(page).toHaveURL(/\/$/);
}

/** Alias for signIn — used by data-layer e2e specs (AC-4xx). */
export const login = signIn;

/**
 * Robustly pick an option from one of the app's async FK Comboboxes (src/components/ui/Combobox.tsx).
 *
 * The Combobox lazy-loads its options on open: it renders a `combo-loading` skeleton first, and the
 * underlying FK source (e.g. useClientCompanies) can resolve to `[]` then repopulate — so the option
 * `<li>`s are *replaced* during the load→ready transition. A naive
 * `getByRole('listbox').getByRole('option').first().click()` races that transition: Playwright can
 * resolve a `<li>` in the skeleton/empty window, the list then re-renders, and the click lands on a
 * detached node — the selection is silently lost, and the create form then blocks on the
 * "Select a company" validation error with the dialog stuck open. This was the dominant cross-stack
 * flake in the New-deal / Raise-request create flows under the single-DB parallel suite.
 *
 * This helper closes the race deterministically by asserting the REAL goal of the step — the
 * selection landed on the trigger — rather than a proxy. (Note: the listbox closing is NOT a valid
 * oracle: the Combobox also closes on an outside-click, so a click that misses the option closes the
 * list WITHOUT selecting.) It: opens the picker, waits for the loading skeleton to clear and the
 * option list to settle, reads the chosen option's label, clicks it, then asserts the trigger now
 * shows that label. If the click missed (trigger still on its placeholder), it reopens and retries.
 * The journey is unchanged — only the mechanical "wait for the list to settle / confirm the pick"
 * step is made non-flaky.
 *
 * @param scope    the dialog/page scope that contains the combobox trigger
 * @param page     the Page (the listbox is portal-rendered to document.body, outside `scope`)
 * @param name     the combobox's accessible name (its label), e.g. /client company/i
 * @param option   which option to select: a name matcher, or 'first' for the first option
 */
export async function pickComboboxOption(
  scope: Locator | Page,
  page: Page,
  name: RegExp,
  option: RegExp | 'first' = 'first',
) {
  const trigger = scope.getByRole('combobox', { name });
  // The unselected trigger shows its placeholder; on a successful select it re-renders to the chosen
  // option's chip. Capturing the placeholder text up front lets us confirm the trigger actually
  // CHANGED (a real selection), which a closed-listbox check cannot (an off-target click closes the
  // list via the outside-click handler WITHOUT selecting — the exact silent miss behind the flake).
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  const placeholder = ((await trigger.textContent()) ?? '').trim();

  for (let attempt = 0; attempt < 3; attempt++) {
    await trigger.click();

    // The portal listbox only renders once the lazy load reaches `ready` (the skeleton is gone).
    // Generous timeout: the FK options come from a real Supabase fetch (useClientCompanies etc.)
    // which can be slow when the single local DB is saturated by the parallel suite — the data
    // does arrive, so we wait it out rather than fail a load that would have succeeded.
    await expect(page.getByTestId('combo-loading')).toHaveCount(0, { timeout: 30_000 });
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 30_000 });

    const target =
      option === 'first'
        ? listbox.getByRole('option').first()
        : listbox.getByRole('option', { name: option });
    // Wait for the option to be present AND stable (the load→ready re-render has settled) before
    // clicking, so the click can't land on a node that the repopulating list is about to replace.
    await expect(target).toBeVisible({ timeout: 30_000 });
    await target.click();

    // REAL oracle: the selection landed → the trigger's chip is no longer its placeholder AND the
    // picker has closed (a clean select does both; an off-target click only closes the list). Both
    // conditions confirm the onChange committed before the caller submits.
    try {
      await expect(trigger).not.toHaveText(placeholder, { timeout: 5_000 });
      await expect(listbox).toBeHidden({ timeout: 5_000 });
      return; // pick confirmed
    } catch {
      // The click missed the option (list closed without selecting). Reopen and retry.
    }
  }
  throw new Error(`pickComboboxOption: could not confirm a selection on combobox "${name}"`);
}

// -----------------------------------------------------------------------
// Mailpit helpers (auth-production-floor Slice 6, D6). Split into two so
// each spec controls clear-ordering explicitly (mirrors the canonical
// e2e/AC-AUTH-005.spec.ts, which does api.delete(...) BEFORE the
// magic-link trigger, then polls): clear → trigger → poll.
// -----------------------------------------------------------------------

export const MAILPIT = 'http://127.0.0.1:54324';

/** Clear the Mailpit inbox so the next poll reads the freshest message. Call this BEFORE the
 *  send/trigger action (button click / service-role invite), mirroring AC-AUTH-005.spec.ts. */
export async function clearMailpit(): Promise<void> {
  const api = await pwRequest.newContext();
  try {
    await api.delete(`${MAILPIT}/api/v1/messages`);
  } catch {
    /* mailbox may already be empty */
  }
}

/** Poll Mailpit for the most recent auth email to `email` and return the first http(s) link in the
 *  body. Does NOT clear the inbox — call clearMailpit() before the trigger action. */
export async function pollMailpitForAuthLink(email: string, timeout = 15_000): Promise<string> {
  const api = await pwRequest.newContext();
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        const listRes = await api.get(`${MAILPIT}/api/v1/messages`);
        const list = await listRes.json();
        const msg = (list.messages ?? []).find((m: { To: { Address: string }[] }) =>
          m.To?.some((t) => t.Address === email)
        );
        if (!msg) return false;
        const bodyRes = await api.get(`${MAILPIT}/api/v1/message/${msg.ID}`);
        const body = await bodyRes.json();
        const text: string = `${body.Text ?? ''}\n${body.HTML ?? ''}`;
        const match = text.match(/https?:\/\/[^\s"'<>]*(?:verify|token|magiclink|otp|recovery|reset)[^\s"'<>]*/i);
        link = match ? match[0].replace(/&amp;/g, '&') : null;
        return Boolean(link);
      },
      { timeout, intervals: [500, 1000, 1500] }
    )
    .toBeTruthy();
  return link!;
}

/**
 * Click a Sales-Pipeline card/row (matched by its deal name) and wait until it has navigated to the
 * canonical project detail route (Model B: /projects/:id).
 *
 * Why a retry loop: the Kanban card's click→navigate is a React onClick that is wired on hydration.
 * Under the single-DB parallel suite a `getByText(name).click()` can fire on the painted-but-not-yet
 * interactive card — the click is swallowed and navigation never starts, so a following
 * `waitForURL('**\/projects/**')` times out (a recurring full-suite flake on AC-SP-207/208 and the
 * canonical-record drilldowns). Re-issuing the click until the URL actually changes makes the open
 * deterministic. The journey is unchanged — only the "click really opened it" wait is hardened.
 *
 * @param page       the Page
 * @param dealName   the deal's visible name (exact-ish; uses getByText(...).first())
 * @param within     optional scope locator (e.g. a specific Kanban column) to disambiguate the card
 */
export async function openPipelineCard(page: Page, dealName: string, within?: Locator) {
  const card = (within ?? page).getByText(dealName).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(async () => {
    await card.click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}
