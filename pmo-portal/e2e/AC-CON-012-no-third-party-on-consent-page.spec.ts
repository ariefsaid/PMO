// @e2e-isolation: read-only — public /privacy nav; a localStorage flag + network trace only, no DB reads/writes.
import { test, expect, type Page } from '@playwright/test';

/**
 * AC-CON-012 (Discover-pass IMPORTANT-7): Given a browser that has opted out of analytics, When it
 * loads /privacy, Then it contacts ZERO third-party origins — not PostHog (AC-CON-003 already
 * covers that), and not any other undisclosed third party either (the defect this AC closes: Inter
 * was loaded from fonts.googleapis.com/fonts.gstatic.com on every page, including /privacy itself,
 * before any consent choice, and even for a fully opted-out session — the opt-out only ever gated
 * PostHog capture, never the font fetch).
 *
 * ⚑ This is an ABSENCE assertion. Per docs/specs/observability-analytics.spec.md §9 amendment 1
 * ("any AC asserting the absence of a behaviour must be paired with a control proving the assertion
 * can fail") and AC-CON-003's own precedent, the CONTROL below proves the detection mechanism is not
 * silently vacuous: it shows that in THIS SAME lane, an opted-IN session (or any injected
 * cross-origin request) is actually observed by the exact listener the main test relies on.
 *
 * Runs against the 'consent' Playwright project (port 3100, analytics genuinely ENABLED with an
 * unroutable host) — see playwright.config.ts. Without that lane, "analytics enabled" is
 * unreachable in e2e (no valid phc_ key elsewhere) and the control would have nothing to prove.
 */

// "First-party" = the app's own origin (any port on localhost/127.0.0.1 — dev server + local
// Supabase, both loopback-only, never leave the machine) or data:/blob:/about: URLs (never a
// network request). Everything else is a genuine third party for this test's purposes.
function isThirdParty(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return false;
  return u.hostname !== 'localhost' && u.hostname !== '127.0.0.1';
}

async function collectThirdPartyRequests(
  page: Page,
  run: (hits: string[]) => Promise<void>,
): Promise<string[]> {
  const hits: string[] = [];
  page.on('request', (req) => {
    if (isThirdParty(req.url())) hits.push(req.url());
  });
  await run(hits);
  return hits;
}

test('AC-CON-012 CONTROL: the listener actually captures a real cross-origin request (proves the main test can fail)', async ({ page }) => {
  const hits = await collectThirdPartyRequests(page, async (hits) => {
    await page.goto('/privacy');
    // Inject a definitively-external resource request and confirm our own listener sees it —
    // the same "prove the mechanism works" shape as AC-CON-003's opted-in control.
    await page.evaluate(() => {
      const img = document.createElement('img');
      img.src = 'https://example.com/ac-con-012-control-probe.png';
      document.body.appendChild(img);
    });
    await expect
      .poll(() => hits.some((h) => h.includes('example.com/ac-con-012-control-probe.png')), {
        message: 'the control must fail if the third-party request listener is not actually working',
      })
      .toBe(true);
  });
  expect(hits.some((h) => h.includes('example.com'))).toBe(true);
});

test('AC-CON-012 CONTROL: an opted-IN session on this lane DOES attempt a third-party (PostHog) request', async ({ page }) => {
  const hits = await collectThirdPartyRequests(page, async (hits) => {
    await page.goto('/privacy');
    await expect
      .poll(() => hits.length, { message: 'the control must fail if analytics is not actually enabled in this lane' })
      .toBeGreaterThan(0);
  });
  expect(hits.length, 'the control must fail if analytics is not actually enabled in this lane').toBeGreaterThan(0);
});

test('AC-CON-012: for an opted-out browser, /privacy contacts ZERO third-party origins (no PostHog, no Google Fonts, nothing undisclosed)', async ({ page }) => {
  // Opt out BEFORE the page ever loads — an already-opted-out browser, matching the finding's
  // "on a fully opted-out session" framing, and also proving the font request (which fires from
  // the HTML head before any app JS runs) isn't somehow gated on opt-out timing either.
  await page.addInitScript(() => {
    window.localStorage.setItem('pmo.analyticsOptOut', 'true');
  });

  const hits = await collectThirdPartyRequests(page, async () => {
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('checkbox', { name: /usage analytics/i })).toBeChecked();
    // Give any deferred/async request (a stray remote-config fetch, a delayed font load, etc.) a
    // window to appear — matching AC-CON-003's own 2s settle wait.
    await page.waitForTimeout(2000);
  });

  expect(hits, `expected no third-party requests, got: ${hits.join(', ')}`).toEqual([]);
});
