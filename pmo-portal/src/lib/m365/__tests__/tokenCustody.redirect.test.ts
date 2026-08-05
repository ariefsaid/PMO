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
function callbackRedirectPaths(): URL[] {
  const results: HandlerResult[] = [
    redirectToFeError({ siteUrl: '' }, 'sample connection error'),
    redirectToFeSuccess({ siteUrl: '' }),
    redirectToFeOrgApprovalSuccess({ siteUrl: '' }),
  ];
  expect(results).toHaveLength(3);
  return results.map((result) => {
    const location = result.headers?.Location;
    expect(location, 'every callback redirect must include a Location header').toEqual(expect.any(String));
    return new URL(location as string, 'http://test.local');
  });
}

describe('AC-M365SEP-018 — every callback redirect target resolves to a real route (not the catch-all)', () => {
  it('AC-M365SEP-018: emits exactly the error, connection-success, and approval-success targets', () => {
    const targets = callbackRedirectPaths();

    expect(targets).toHaveLength(3);
    expect(targets.some((target) => target.searchParams.has('m365_error'))).toBe(true);
    expect(targets.some((target) => target.searchParams.get('m365_connected') === 'true')).toBe(true);
    expect(targets.some((target) => target.searchParams.get('m365_org_approved') === 'true')).toBe(true);
  });

  it('AC-M365SEP-018: no redirect target falls through to the `*` catch-all', () => {
    const targets = callbackRedirectPaths();

    for (const target of targets) {
      const matches = matchRoutes(appRouteConfig, target.pathname);
      const leaf = matches?.[matches.length - 1]?.route;
      // The target must match a concrete route…
      expect(leaf, `redirect target ${target.pathname} matched no route in the real route table`).toBeTruthy();
      // …and that route must NOT be the `*` catch-all (the §1.3 defect: a target the app does not
      // serve silently 404s in prod while every lower test stays green).
      expect(
        leaf!.path,
        `redirect target ${target.pathname} fell through to the \`*\` catch-all — the app does not serve this route`,
      ).not.toBe('*');
    }
  });
});
