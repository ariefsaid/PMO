// @e2e-isolation: read-only — pure navigation + assertions. No DB writes, no shared-user mutation.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-M365SEP-018 — the Microsoft callback's redirect targets resolve to REAL pages.
//
// Why this exists as an e2e rather than a unit test. A shipped defect had the token-custody
// callback redirecting to `/admin/integrations`, a route the application never served, so every
// completed Microsoft connect landed on Not Found — the connection row was written, then the user
// saw a 404 and never received the success or error message the card exists to display.
//
// It survived because the card's unit test set `initialEntry: '/admin/integrations'` inside a
// MemoryRouter: the test INVENTED the missing route and then proved the card worked on it. A
// component test can never catch this class, because it supplies the router. Only the real app,
// with its real route table, can. `tokenCustody.redirect.test.ts` now matches against the app's
// actual `appRouteConfig`, which closes the gap at the unit layer; this spec closes it at the
// layer where the router is genuinely the app's.
//
// Also the M365 journey the Phase-0 spec (§5) promised would "graduate to one e2e in Phase 1
// when the live connect ships" — backlog TBD-5. It deliberately stops short of a live Microsoft
// connection (that needs real tenant credentials and is tracked separately as TBD-3): what is
// proven here is that every URL Microsoft can send a user back to lands on a real page.

// A Project Manager — deliberately NOT an Admin and NOT an Operator. Before the operator/client
// separation, only a platform Operator could reach any M365 surface; this user proves the de-gate.
const PM = 'pm@acme.test';

test('AC-M365SEP-018: /integrations resolves for a non-Admin member (not Not Found)', async ({
  page,
}) => {
  await login(page, PM);
  await page.goto('/integrations');

  // The page must render. The old defect rendered the catch-all instead.
  await expect(page.getByText('Page not found')).toHaveCount(0);
  await expect(page).toHaveURL(/\/integrations$/);
});

// Every parameter Microsoft can hand back. Each previously would have — or in the approval case
// did — land the user somewhere broken.
for (const [param, label] of [
  ['m365_connected=true', 'personal connect success'],
  ['m365_error=connection_failed', 'personal connect failure'],
  ['m365_org_approved=true', 'organisation approval success'],
] as const) {
  test(`AC-M365SEP-018: callback return ?${param} resolves on a real page (${label})`, async ({
    page,
  }) => {
    await login(page, PM);
    await page.goto(`/integrations?${param}`);

    await expect(page.getByText('Page not found')).toHaveCount(0);

    // No secret may reach the DOM on any callback path (NFR-M365SEP-007). These are the exact
    // shapes the token-custody spec forbids: a bearer token, a Microsoft object id, a tenant GUID.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('eyj'); // a JWT's base64 header prefix
    expect(body).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/);
  });
}

test('AC-M365SEP-018: the old /admin/integrations target is genuinely not a route', async ({
  page,
}) => {
  await login(page, PM);
  await page.goto('/admin/integrations');

  // This is the inverse assertion, and it is the one that would have caught the original bug:
  // the path the callback used to redirect to must resolve to the catch-all, proving it was never
  // a real destination. If a future change makes this a real page, that is fine — but then the
  // callback's target must be re-examined, and this test failing is the prompt to do so.
  await expect(page.getByText('Page not found')).toBeVisible();
});
