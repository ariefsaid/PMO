/**
 * AC-M365SEP-018 — every redirect target the token-custody callback emits resolves to a REAL
 * application route, not the `*` catch-all.
 *
 * Context (m365-operator-client-separation spec §1.3): the callback redirected to
 * `/admin/integrations` on both success and failure. No such route exists (the real one was
 * `/administration`), so the catch-all swallowed it and EVERY completed Microsoft connect landed on
 * Not Found — the connection row was written before the redirect, so the connect succeeded while
 * the user saw a 404 and never got the success/error message.
 *
 * Why no test caught it: `M365ConnectionCard.test.tsx` set `initialEntry = '/admin/integrations'`
 * inside a MemoryRouter — the test INVENTED the missing route, so it proved the card's behaviour on
 * a path the application does not serve. Per NFR-M365SEP-008 this test does the opposite: it derives
 * each target from the callback's OWN redirect helpers (so it tracks the source), then resolves the
 * path against the application's REAL route table (`appRouteConfig`, the same array `AppRoutes`
 * renders from). A target that matches only the `*` catch-all fails here — exactly the §1.3 defect.
 */
import { describe, it, expect } from 'vitest';
import { matchRoutes } from 'react-router';
import { appRouteConfig } from '@/App';
import {
  redirectToFeError,
  redirectToFeSuccess,
  redirectToFeOrgApprovalSuccess,
} from '../../../../../supabase/functions/m365-token-custody/callback';
import type { HandlerResult } from '../../../../../supabase/functions/m365-token-custody/types';

/**
 * Derive every redirect target the callback emits, from the helpers themselves. `siteUrl: ''`
 * keeps the Location relative so `new URL(..., origin)` yields just the app path. Adding a helper
 * here is intentional: a new redirect path is a new contract this test must cover.
 */
function callbackRedirectPaths(): string[] {
  const results: HandlerResult[] = [
    redirectToFeError({ siteUrl: '' }, 'sample connection error'),
    redirectToFeSuccess({ siteUrl: '' }),
    redirectToFeOrgApprovalSuccess({ siteUrl: '' }),
  ];
  return results.map((r) => new URL(r.headers?.Location ?? '/', 'http://test.local').pathname);
}

describe('AC-M365SEP-018 — every callback redirect target resolves to a real route (not the catch-all)', () => {
  // Sanity check the test is actually exercising the helpers (guards against a future refactor
  // that silently no-ops them — an empty target list would make every assertion vacuously true).
  it('the callback emits at least one redirect target', () => {
    expect(callbackRedirectPaths().length).toBeGreaterThan(0);
  });

  it('AC-M365SEP-018: no redirect target falls through to the `*` catch-all', () => {
    const targets = callbackRedirectPaths();
    expect(targets.length).toBeGreaterThan(0);

    for (const pathname of targets) {
      const matches = matchRoutes(appRouteConfig, pathname);
      const leaf = matches?.[matches.length - 1]?.route;
      // The target must match a concrete route…
      expect(leaf, `redirect target ${pathname} matched no route in the real route table`).toBeTruthy();
      // …and that route must NOT be the `*` catch-all (the §1.3 defect: a target the app does not
      // serve silently 404s in prod while every lower test stays green).
      expect(
        leaf!.path,
        `redirect target ${pathname} fell through to the \`*\` catch-all — the app does not serve this route`,
      ).not.toBe('*');
    }
  });
});
