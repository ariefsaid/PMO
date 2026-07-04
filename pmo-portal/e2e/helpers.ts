import { expect, request as pwRequest, type Locator, type Page } from '@playwright/test';

export const SEED_PASSWORD = 'Passw0rd!dev';

/** Sign in via the /login form and wait for the dashboard. */
export async function signIn(page: Page, email: string, password = SEED_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
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
