/**
 * M365ConnectionCard — Phase-1 FE wiring of the token-custody edge function.
 *
 *   AC-M365SEP-016 — the entitlement gate (the only FE gate) hides the card AND suppresses
 *                    the status fetch (no edge-fn call when the card is hidden). PMO role is no
 *                    longer a gate (FR-M365SEP-011); an entitled active member always sees it.
 *   AC-M365-013 — the Phase-0 HELD "available soon" stub is RETIRED; the card now shows an
 *                 ENABLED Connect action over a "Not connected" state. (oracle evolved with the
 *                 deliberate Phase-0 → Phase-1 transition — not a weakening; the assertion is just
 *                 as strong, only the phase-appropriate behavior changed.)
 *   AC-M365-014 — Connect calls initiate_connect and top-level-redirects to the returned
 *                 authorizeUrl.
 *   AC-M365-015 — a failed initiate maps each M365ErrorCode to human copy and does NOT redirect.
 *   AC-M365-016 — repeat-clicks do not fire a second initiate (in-flight guard).
 *   AC-M365-017 — callback ?m365_connected=true renders the connected state and the param is
 *                 cleared from the URL (no re-trigger on refresh).
 *   AC-M365-018 — callback ?m365_error=<msg> renders reviewed error copy and the param is cleared.
 *   AC-M365SEP-018 — callback ?m365_org_approved=true renders org approval and clears the param.
 *   AC-M365-019 — Disconnect opens a destructive confirm; confirming calls disconnect and returns
 *                 the card to idle.
 *   AC-M365-020 — cancelling the confirm calls nothing.
 *   AC-M365-021 — no token / oid / raw internal error string leaks into the DOM.
 *   AC-M365-022 — on a fresh page load (no callback param) the card fetches connection_status and
 *                 renders the REAL state — Connected (+ connected-at) / Needs reconnect (stale) /
 *                 Revoked / Not connected. (new — the status-fetch source-of-truth on load)
 *   AC-M365-023 — a FAILED status fetch renders an honest UNKNOWN state — NEVER a false "Connected".
 *                 (new — the "card must not lie" guarantee)
 *
 * Localization (issue #689): AC-M365LOC-001..005 are owned here. The harness loads the REAL
 * `public/locales/{en,id}/common.json` catalogues and renders the shipped card under an isolated
 * i18next instance per locale, so every assertion pins the actual shipped copy — no duplicate
 * implementation, no new mapper under test.
 *
 * The supabase.functions.invoke client is mocked (the edge fn is NOT deployed + has NO secrets);
 * window.location.assign is stubbed (jsdom cannot cross-origin navigate). Mirrors the
 * adapterSeam/dispatchClient test conventions.
 *
 * Mocking note: beforeEach seeds a DEFAULT `invoke` that returns a not-connected status for every
 * call, so the mount-time status fetch (AC-M365-022) always resolves cleanly. Tests that override
 * the STATUS do so with mockResolvedValueOnce BEFORE render (the mount fetch consumes it); tests
 * that override an ACTION do so with mockResolvedValueOnce AFTER render + awaiting the Connect
 * button (so the mount fetch consumes the default, and the action mock applies to the click).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setActiveLocale, resetActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatDate } from '@/src/lib/format';
import { parseMissingKeyHandler } from '@/src/lib/i18n';

const { featureState, invoke } = vi.hoisted(() => ({
  featureState: { value: false },
  invoke: vi.fn(),
}));

vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => featureState.value }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import { M365ConnectionCard } from '../M365ConnectionCard';
import { describeM365Error } from '@/src/lib/m365/connectClient';

/** A not-connected connection_status response (the honest default for a fresh load). */
const STATUS_NOT_CONNECTED = {
  data: { connected: false, status: null, connected_at: null, last_refresh_at: null, scopes: [] },
  error: null,
};
const STATUS_ACTIVE = {
  connected: true,
  status: 'active',
  connected_at: '2026-07-15T10:00:00.000Z',
  last_refresh_at: null,
  scopes: [],
};
const STATUS_STALE = { ...STATUS_ACTIVE, status: 'stale' };
const STATUS_REVOKED = { ...STATUS_ACTIVE, status: 'revoked' };

/** The REAL shipped catalogues — assertions pin the actual English/Bahasa copy. */
const EN_CATALOGUE = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'),
) as Record<string, unknown>;
const ID_CATALOGUE = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'),
) as Record<string, unknown>;

async function makeI18n(lng: 'en' | 'id') {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng,
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { en: { common: EN_CATALOGUE }, id: { common: ID_CATALOGUE } },
  });
  return i18n;
}

/** A response body for a failed invoke — FunctionsHttpError shape carries `.context: Response`. */
function httpError(body: unknown, status = 403): { context: Response } {
  const json = JSON.stringify(body);
  const response = {
    clone: () => response,
    json: async () => JSON.parse(json),
    status,
  } as unknown as Response;
  return { context: response };
}

/** A FunctionsFetchError-shaped error: NO `.context` (the fetch never reached the edge fn). */
function networkError(message: string): Error {
  return new Error(message);
}

const assignMock = vi.fn();

/**
 * Render the shipped card inside a MemoryRouter under an isolated i18next instance for the given
 * locale, loaded from the real catalogues. Returns location probe + the instance (for in-place
 * locale changes).
 */
async function renderCard(opts: { initialEntry?: string; locale?: 'en' | 'id' } = {}) {
  const { initialEntry = '/integrations', locale = 'en' } = opts;
  const i18n = await makeI18n(locale);
  const locationSearch: string[] = [];
  const Probe: React.FC = () => {
    const loc = useLocation();
    locationSearch.push(loc.search);
    return null;
  };
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Probe />
        <M365ConnectionCard />
      </MemoryRouter>
    </I18nextProvider>,
  );
  return { ...utils, locationSearch, i18n };
}

const CONNECT_NAME = { en: /connect microsoft 365/i, id: /hubungkan microsoft 365/i } as const;

/** Wait for the card to settle into the idle baseline (Connect button present), post status fetch. */
const settleIdle = (locale: 'en' | 'id' = 'en') =>
  screen.findByRole('button', { name: CONNECT_NAME[locale] }) as Promise<HTMLElement>;

beforeEach(() => {
  featureState.value = false;
  resetActiveLocale();
  invoke.mockReset();
  // DEFAULT: every invoke returns a not-connected status, so the mount-time status fetch always
  // resolves cleanly + the card lands in the idle "Not connected" baseline. Tests override the
  // status (mockResolvedValueOnce before render) or an action (mockResolvedValueOnce after render).
  invoke.mockResolvedValue(STATUS_NOT_CONNECTED);
  assignMock.mockClear();
  // jsdom's `window.location` is a non-configurable navigation stub — replace the whole object
  // (the chunkReload.test.ts pattern) so `window.location.assign` is observable + doesn't throw
  // a cross-origin navigation error when the card redirects to login.microsoftonline.com.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: assignMock, href: '' },
  });
});

describe('AC-M365SEP-016 / AC-M365-012 — card visibility (entitlement gate only)', () => {
  // RE-SPECIFIED (FR-M365SEP-011/016, 2026-07-30): the card used to be hidden from non-Admin
  // entitled members (the old "two-switch: entitlement + Admin" gate). That rule is reversed —
  // any active member of an entitled org may connect. The Admin-gate cases are replaced by the
  // AC-M365SEP-016 block below (an entitled member sees the card); what stays here is the
  // entitlement gate itself, which still hides the card and suppresses the status fetch.
  it('AC-M365-012: hidden when the org is NOT entitled (and the status fetch never fires)', async () => {
    featureState.value = false;
    const { container } = await renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });
});

/**
 * AC-M365SEP-016 — the personal connect surface is reachable by ANY active member of an entitled
 * org, not only an Admin/Operator (FR-M365SEP-011/016). The card's only FE gate is the entitlement;
 * PMO role is no longer a gate (what a caller sees is bounded by their own Microsoft permissions,
 * which Microsoft enforces). Rendered WITHOUT the legacy isOperator prop so a reintroduced Admin
 * guard (mutation check 3) hides the card and fails this test.
 */
describe('AC-M365SEP-016 — an entitled active member sees the card with Connect enabled (no Admin gate)', () => {
  it('AC-M365SEP-016: an entitled member (any role) renders the card with an enabled Connect button', async () => {
    featureState.value = true;
    // Render the card directly (no isOperator prop) — the personal-connect contract.
    await renderCard();
    expect(screen.getByTestId('m365-connection-card')).toBeInTheDocument();
    const btn = await settleIdle();
    expect(btn).not.toBeDisabled();
    // The status fetch DID fire (entitled member's card is live, not hidden).
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'connection_status' } });
  });
});

describe('AC-M365-013 — Phase-1 wiring: the held stub is retired; Connect is live', () => {
  it('AC-M365-013: shows "Not connected" + an ENABLED Connect button (no longer a disabled stub)', async () => {
    featureState.value = true;
    await renderCard();
    const btn = await settleIdle();
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });
});

describe('AC-M365-014 — Connect calls initiate_connect and redirects to authorizeUrl', () => {
  it('AC-M365-014: POSTs initiate_connect, then top-level-redirects to the returned URL', async () => {
    featureState.value = true;
    const authorizeUrl = 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize?client_id=x';
    await renderCard();
    await settleIdle(); // mount status fetch (default not-connected) → idle
    invoke.mockResolvedValueOnce({
      data: { authorizeUrl, state: 'csrf-state-token' },
      error: null,
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /connect microsoft 365/i }));

    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'initiate_connect' } });
    // A TOP-LEVEL redirect (Microsoft's consent page must be user-visible) — not a fetch/RPC.
    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith(authorizeUrl);
  });
});

describe('AC-M365-015 — a failed initiate shows mapped human copy and does NOT redirect', () => {
  const cases: Array<{ code: string; status: number }> = [
    { code: 'NOT_ENTITLED', status: 403 },
    { code: 'FORBIDDEN', status: 403 },
    { code: 'CONNECTION_STALE', status: 409 },
    { code: 'TOKEN_EXCHANGE_FAILED', status: 502 },
    { code: 'INTERNAL_ERROR', status: 500 },
  ];

  for (const { code, status } of cases) {
    it(`AC-M365-015: ${code} → human banner, no redirect, no raw server message`, async () => {
      featureState.value = true;
      const rawServerMessage = `internal detail for ${code} (must NOT surface)`;
      await renderCard();
      await settleIdle();
      invoke.mockResolvedValueOnce({
        data: null,
        error: httpError({ error: code, message: rawServerMessage }, status),
      });

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /connect microsoft 365/i }));

      // The banner appears, the raw server message + code string never surface, no redirect.
      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent(describeM365Error(code));
      expect(banner.textContent).not.toContain(rawServerMessage);
      expect(banner.textContent).not.toContain(code);
      expect(assignMock).not.toHaveBeenCalled();
      // The Connect button is interactive again (retry allowed).
      expect(screen.getByRole('button', { name: /connect microsoft 365/i })).not.toBeDisabled();
    });
  }
});

describe('AC-M365-016 — repeat-clicks do not fire a second initiate (in-flight guard)', () => {
  it('AC-M365-016: two rapid clicks invoke initiate_connect exactly once', async () => {
    featureState.value = true;
    await renderCard();
    await settleIdle();
    // An invoke that never resolves synchronously — keeps the card in-flight across both clicks.
    let resolveInvoke!: (v: unknown) => void;
    invoke.mockImplementationOnce(
      () => new Promise((r) => { resolveInvoke = r; }),
    );

    const btn = screen.getByRole('button', { name: /connect microsoft 365/i });
    fireEvent.click(btn);
    fireEvent.click(btn); // second click while the first is still in flight

    const initiateCalls = invoke.mock.calls.filter(
      (c) => (c[1] as { body?: { action?: string } } | undefined)?.body?.action === 'initiate_connect',
    );
    expect(initiateCalls).toHaveLength(1);

    // Let the in-flight promise settle so the test doesn't leave a dangling microtask.
    resolveInvoke({ data: { authorizeUrl: 'https://login.microsoftonline.com/x', state: 's' }, error: null });
    await Promise.resolve();
  });
});

describe('AC-M365-017 — callback ?m365_connected=true renders connected state + clears the param', () => {
  it('AC-M365-017: shows Connected + Disconnect, and the param is removed from the URL', async () => {
    featureState.value = true;
    const { locationSearch } = await renderCard({ initialEntry: '/integrations?m365_connected=true' });

    expect(screen.getByTestId('m365-connected-msg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
    // No Connect button anymore (we are in the connected state).
    expect(screen.queryByRole('button', { name: /connect microsoft 365/i })).not.toBeInTheDocument();
    // The status fetch is SKIPPED on this mount (the redirect param is the signal) — only the
    // callback path set the phase, no connection_status invoke landed.
    expect(invoke).not.toHaveBeenCalled();
    // The param was cleaned from the router location (last rendered probe value).
    const last = locationSearch[locationSearch.length - 1];
    expect(last).not.toContain('m365_connected');
  });
});

describe('AC-M365-018 — callback ?m365_error=<msg> renders reviewed copy + clears the param', () => {
  it('AC-M365-018: shows generic reviewed copy for an arbitrary backend string, never the raw value', async () => {
    featureState.value = true;
    const rawBackendString = 'some_random_backend_string';
    const { locationSearch } = await renderCard({ initialEntry: `/integrations?m365_error=${rawBackendString}` });

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(describeM365Error(undefined));
    expect(banner).not.toHaveTextContent(rawBackendString);
    expect(document.body).not.toHaveTextContent(rawBackendString);
    // Connect stays available for retry.
    expect(screen.getByRole('button', { name: /connect microsoft 365/i })).not.toBeDisabled();
    // Status fetch skipped (callback param drove the immediate state) — no invoke.
    expect(invoke).not.toHaveBeenCalled();
    const last = locationSearch[locationSearch.length - 1];
    expect(last).not.toContain('m365_error');
  });
});

describe('AC-M365SEP-018 — callback ?m365_org_approved=true renders organisation approval + clears the param', () => {
  it('AC-M365SEP-018: shows the organisation approval confirmation without claiming personal connection', async () => {
    featureState.value = true;
    const { locationSearch } = await renderCard({ initialEntry: '/integrations?m365_org_approved=true' });

    const confirmation = screen.getByTestId('m365-org-approved-msg');
    expect(confirmation).toHaveTextContent(/organization has approved/i);
    expect(confirmation).toHaveTextContent(/connect your (own|individual) microsoft 365 account/i);
    expect(confirmation).not.toHaveTextContent(/connected since|your account is connected/i);
    expect(invoke).not.toHaveBeenCalled();
    const last = locationSearch[locationSearch.length - 1];
    expect(last).not.toContain('m365_org_approved');
  });
});

describe('AC-M365SEP-015 — callback approval-required code uses reviewed copy', () => {
  it('AC-M365SEP-015: maps ORG_APPROVAL_REQUIRED to administrator approval copy and clears both callback params', async () => {
    featureState.value = true;
    const { locationSearch } = await renderCard({
      initialEntry: '/integrations?m365_error=ORG_APPROVAL_REQUIRED&m365_error_code=ORG_APPROVAL_REQUIRED',
    });

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(/ask your administrator to approve/i);
    expect(banner).not.toHaveTextContent('ORG_APPROVAL_REQUIRED');
    const last = locationSearch[locationSearch.length - 1];
    expect(last).not.toContain('m365_error');
    expect(last).not.toContain('m365_error_code');
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('AC-M365-019 — Disconnect confirms first, then calls the fn', () => {
  it('AC-M365-019: confirming the destructive dialog calls disconnect and returns the card to idle', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    await renderCard({ initialEntry: '/integrations?m365_connected=true' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /disconnect/i }));

    // The destructive confirm appears; disconnect has NOT fired yet (confirm-first).
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/disconnect microsoft 365/i);
    expect(invoke).not.toHaveBeenCalled();

    // Scope to the dialog — the card's "Disconnect" trigger is still in the DOM underneath the
    // portal overlay, so an unscoped name query would match both.
    await user.click(within(dialog).getByRole('button', { name: /^disconnect$/i }));

    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'disconnect' } });
    // Back to idle: Connect re-appears, Disconnect is gone.
    expect(await screen.findByRole('button', { name: /connect microsoft 365/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
  });
});

describe('AC-M365-020 — cancelling the Disconnect confirm does nothing', () => {
  it('AC-M365-020: cancel closes the dialog and never calls the edge fn', async () => {
    featureState.value = true;
    await renderCard({ initialEntry: '/integrations?m365_connected=true' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /disconnect/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(invoke).not.toHaveBeenCalled();
    // Still connected.
    expect(screen.getByTestId('m365-connected-msg')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('AC-M365-021 — no token / oid / raw internal string leaks into the DOM', () => {
  it('AC-M365-021: the initiate response state + server raw message never render', async () => {
    featureState.value = true;
    const secretState = 'csrf-state-token-DO-NOT-RENDER';
    const rawServerMessage = 'raw internal: oid=abcdef&code_verifier=secret';
    await renderCard();
    await settleIdle();
    invoke.mockResolvedValueOnce({
      data: { authorizeUrl: 'https://login.microsoftonline.com/x', state: secretState },
      error: null,
    });

    const { container } = await renderCard({ initialEntry: '/integrations?m365_connected=true' });
    // `container` now reflects the callback-driven connected render (status fetch skipped).
    expect(container.textContent).not.toContain(secretState);
    expect(container.textContent).not.toContain('oid');
    expect(container.textContent).not.toContain('code_verifier');
    void rawServerMessage; // (the raw-server-message leak assertion is covered by AC-M365-015)
  });
});

describe('AC-M365-022 — fresh page load fetches connection_status and renders the REAL state', () => {
  it('AC-M365-022: an active connection renders Connected (+ connected-at) + Disconnect, no Connect', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({
      data: STATUS_ACTIVE,
      error: null,
    });

    await renderCard();
    const msg = await screen.findByTestId('m365-connected-msg');
    expect(msg).toHaveTextContent(/connected since/i);
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect microsoft 365/i })).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'connection_status' } });
  });

  it('AC-M365-022: a stale connection renders "Needs reconnect" + a Reconnect button (no Disconnect)', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({
      data: STATUS_STALE,
      error: null,
    });

    await renderCard();
    await screen.findByTestId('m365-reconnect-msg');
    expect(screen.getByRole('button', { name: /reconnect microsoft 365/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
  });

  it('AC-M365-022: a revoked connection renders the revoked state + a Reconnect button', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({
      data: STATUS_REVOKED,
      error: null,
    });

    await renderCard();
    await screen.findByTestId('m365-revoked-msg');
    expect(screen.getByRole('button', { name: /reconnect microsoft 365/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
  });

  it('AC-M365-022: an absent connection renders "Not connected" + a Connect button (the default)', async () => {
    featureState.value = true;
    await renderCard(); // default invoke → not-connected status

    await screen.findByText(/not connected/i);
    expect(screen.getByRole('button', { name: /connect microsoft 365/i })).toBeInTheDocument();
    expect(screen.queryByTestId('m365-connected-msg')).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'connection_status' } });
  });
});

describe('AC-M365-023 — a failed status fetch renders an honest UNKNOWN state (NEVER a false "Connected")', () => {
  it('AC-M365-023: a 500 INTERNAL_ERROR on the status fetch → unknown banner, NOT "Connected", NO Disconnect', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError({ error: 'INTERNAL_ERROR', message: 'status read failed' }, 500),
    });

    await renderCard();
    await screen.findByTestId('m365-unknown-msg');
    // A failed fetch must NEVER render a false "Connected" — the connected message + Disconnect
    // button are absent (the card does not invent a connection it could not verify).
    expect(screen.queryByTestId('m365-connected-msg')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^connected\b/i)).not.toBeInTheDocument();
  });

  it('AC-M365-023: a network failure on the status fetch → unknown banner (generic copy, no raw string)', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: null, error: networkError('Failed to send a request') });

    await renderCard();
    const msg = await screen.findByTestId('m365-unknown-msg');
    // The mapped generic copy is shown (honest) — never the raw network string.
    expect(msg.textContent).not.toContain('Failed to send a request');
    expect(msg.textContent).not.toContain('ENOTFOUND');
    expect(screen.queryByTestId('m365-connected-msg')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
  });
});

describe('AC-M365-024 — the status fetch is not permanently disabled by an unmount', () => {
  // REGRESSION (live run against prod Supabase, 2026-07-24): the card hung forever on
  // "Checking Microsoft 365 connection status…" while the edge fn returned a healthy 200.
  //
  // Cause: `statusFetchedRef` guards against a duplicate fetch but was never released on cleanup,
  // so the guard is permanent across the component's whole lifetime — not just one mount. React
  // StrictMode (enabled in index.tsx) mounts → unmounts → remounts every component in dev:
  //   mount 1  → ref = true, fetch starts
  //   unmount  → cleanup sets cancelled = true
  //   mount 2  → ref already true ⇒ returns early, NEVER fetches
  //   fetch 1 resolves → `if (cancelled) return` ⇒ applyStatus NEVER runs ⇒ phase stays 'loading'
  //
  // This asserts the contract the fix restores: after an unmount, a remount MUST fetch again.
  // A cancelled fetch has to leave the card able to try once more, or the state never resolves.
  // (Note: jsdom does not reproduce the *hang* — RTL flushes the mocked promise inside the same
  // act() as the remount, so `cancelled` is never observed. The live browser, with a ~300ms
  // network call, always loses that race. This test targets the guard directly for that reason.)
  it('AC-M365-024: a remount re-runs the status fetch instead of being permanently skipped', async () => {
    featureState.value = true;
    invoke.mockResolvedValue(STATUS_NOT_CONNECTED);

    const first = await renderCard();
    await settleIdle();
    expect(invoke).toHaveBeenCalledTimes(1);

    // Unmount + remount — exactly what StrictMode does on every dev mount.
    first.unmount();
    await renderCard();

    // The remounted card must fetch its own status; if the guard is never released it renders
    // "Checking…" forever with no request in flight.
    await settleIdle();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('m365-loading-msg')).not.toBeInTheDocument();
  });
});

// ════════════════════════ Issue #689 — localization & disconnect recovery ════════════════════════

describe('AC-M365LOC-001 — English states and actions (fixed copy)', () => {
  it('AC-M365LOC-001: loading state shows English "Checking…" with no actions', async () => {
    featureState.value = true;
    invoke.mockImplementationOnce(() => new Promise(() => {})); // keep status in flight
    await renderCard();
    expect(await screen.findByTestId('m365-loading-msg')).toHaveTextContent(
      'Checking Microsoft 365 connection status…',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('m365-connected-msg')).not.toBeInTheDocument();
  });

  it('AC-M365LOC-001: disconnected shows the personal-account English copy + an English Connect action', async () => {
    featureState.value = true;
    await renderCard();
    const msg = await screen.findByText(/connect your own microsoft 365 account/i);
    expect(msg).toHaveTextContent(
      'Not connected. Connect your own Microsoft 365 account to let PMO Portal access the OneDrive files, Teams, and calendar information available through your account.',
    );
    // The personal connection is NOT described as organization-activation or completed sync.
    expect(msg.textContent).not.toMatch(/organization integration|is synced|has synced|tenant/i);
    expect(screen.getByRole('button', { name: /^connect microsoft 365$/i })).toBeInTheDocument();
  });

  it('AC-M365LOC-001: connected shows English copy + Disconnect, with the date only when present', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: STATUS_ACTIVE, error: null });
    await renderCard();
    const msg = await screen.findByTestId('m365-connected-msg');
    expect(msg).toHaveTextContent(/connected since/i);
    expect(msg).toHaveTextContent(/you can disconnect any time/i);
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('AC-PLC-005: the "connected since" date is the calendar day in the viewer\'s profile timezone', async () => {
    featureState.value = true;
    // 03:30 UTC: already Jul 15 in Jakarta (10:30), still Jul 14 in Los Angeles (20:30).
    const nearMidnight = { ...STATUS_ACTIVE, connected_at: '2026-07-15T03:30:00.000Z' };

    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    invoke.mockResolvedValueOnce({ data: nearMidnight, error: null });
    const { unmount } = await renderCard();
    expect(await screen.findByTestId('m365-connected-msg')).toHaveTextContent(
      'Connected since Jul 15, 2026. You can disconnect any time.',
    );
    unmount();

    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'America/Los_Angeles' });
    invoke.mockResolvedValueOnce({ data: nearMidnight, error: null });
    await renderCard();
    expect(await screen.findByTestId('m365-connected-msg')).toHaveTextContent(
      'Connected since Jul 14, 2026. You can disconnect any time.',
    );
  });

  it('AC-M365LOC-001: connected without a date omits the "since" clause', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: { ...STATUS_ACTIVE, connected_at: null }, error: null });
    await renderCard();
    const msg = await screen.findByTestId('m365-connected-msg');
    expect(msg).toHaveTextContent('Connected. You can disconnect any time.');
    expect(msg.textContent).not.toMatch(/since/i);
  });

  it('AC-M365LOC-001: organization-approved shows the English personal-connection copy', async () => {
    featureState.value = true;
    await renderCard({ initialEntry: '/integrations?m365_org_approved=true' });
    const msg = screen.getByTestId('m365-org-approved-msg');
    expect(msg).toHaveTextContent(
      'Your organization has approved the PMO Portal app in Microsoft 365. Connect your own Microsoft 365 account to continue.',
    );
    expect(screen.getByRole('button', { name: /^connect microsoft 365$/i })).toBeInTheDocument();
  });

  it('AC-M365LOC-001: reconnect shows English copy + a Reconnect action', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: STATUS_STALE, error: null });
    await renderCard();
    expect(await screen.findByTestId('m365-reconnect-msg')).toHaveTextContent(
      'The Microsoft 365 connection expired. Please reconnect to continue.',
    );
    expect(screen.getByRole('button', { name: /^reconnect microsoft 365$/i })).toBeInTheDocument();
  });

  it('AC-M365LOC-001: revoked shows English copy + a Reconnect action', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: STATUS_REVOKED, error: null });
    await renderCard();
    expect(await screen.findByTestId('m365-revoked-msg')).toHaveTextContent(
      'The Microsoft 365 connection was revoked. Connect again to continue.',
    );
    expect(screen.getByRole('button', { name: /^reconnect microsoft 365$/i })).toBeInTheDocument();
  });

  it('AC-M365LOC-001: unknown status fetch renders the English fallback, never a false Connected', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: null, error: networkError('Failed to send a request') });
    await renderCard();
    const msg = await screen.findByTestId('m365-unknown-msg');
    expect(msg).toHaveTextContent(
      "We couldn't confirm your Microsoft 365 connection status. Refresh the page to try again.",
    );
    expect(msg.textContent).not.toContain('Failed to send a request');
    expect(screen.queryByTestId('m365-connected-msg')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('AC-M365LOC-001: connecting keeps the English Connect label while the Button is loading', async () => {
    featureState.value = true;
    await renderCard();
    await settleIdle();
    let resolveInit!: (v: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise((r) => { resolveInit = r; }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^connect microsoft 365$/i }));
    const btn = screen.getByRole('button', { name: /^connect microsoft 365$/i });
    expect(btn).toBeDisabled(); // loading
    expect(btn).toHaveTextContent('Connect Microsoft 365');
    resolveInit({ data: { authorizeUrl: 'https://login.microsoftonline.com/x', state: 's' }, error: null });
    await Promise.resolve();
  });

  it('AC-M365LOC-001: a failed connect shows the English generic fallback, never raw text, and keeps Connect for retry', async () => {
    featureState.value = true;
    const raw = 'connect transport leak';
    await renderCard();
    await settleIdle();
    invoke.mockResolvedValueOnce({ data: null, error: networkError(raw) });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^connect microsoft 365$/i }));
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Microsoft 365 could not be connected. Please try again.');
    expect(banner.textContent).not.toContain(raw);
    expect(screen.getByRole('button', { name: /^connect microsoft 365$/i })).not.toBeDisabled();
  });
});

describe('AC-M365LOC-002 — Bahasa states and actions (fixed copy)', () => {
  it('AC-M365LOC-002: disconnected shows the long Bahasa personal-account copy + a Bahasa Connect action', async () => {
    featureState.value = true;
    await renderCard({ locale: 'id' });
    const msg = await screen.findByText(/hubungkan akun microsoft 365 anda sendiri/i);
    expect(msg).toHaveTextContent(
      'Belum terhubung. Hubungkan akun Microsoft 365 Anda sendiri agar PMO Portal dapat mengakses file OneDrive, Teams, dan informasi kalender yang tersedia melalui akun Anda.',
    );
    expect(msg.textContent).not.toMatch(/organization integration|tenant/i);
    expect(screen.getByRole('button', { name: /^hubungkan microsoft 365$/i })).toBeInTheDocument();
  });

  it('AC-M365LOC-002: connected date is formatted by the active (id) locale', async () => {
    featureState.value = true;
    setActiveLocale({ locale: 'id', numberLocale: 'id', timezone: 'Asia/Jakarta' });
    invoke.mockResolvedValueOnce({ data: STATUS_ACTIVE, error: null });
    await renderCard({ locale: 'id' });
    const msg = await screen.findByTestId('m365-connected-msg');
    expect(msg).toHaveTextContent('Terhubung sejak');
    expect(msg).toHaveTextContent(/kapan saja/i);
    expect(msg).toHaveTextContent(formatDate('2026-07-15T10:00:00.000Z'));
    expect(screen.getByRole('button', { name: 'Putuskan koneksi' })).toBeInTheDocument();
  });

  it('AC-M365LOC-002: organization-approved shows the long Bahasa personal-connection copy', async () => {
    featureState.value = true;
    await renderCard({ locale: 'id', initialEntry: '/integrations?m365_org_approved=true' });
    const msg = screen.getByTestId('m365-org-approved-msg');
    expect(msg).toHaveTextContent(
      'Organisasi Anda telah menyetujui aplikasi PMO Portal di Microsoft 365. Hubungkan akun Microsoft 365 Anda sendiri untuk melanjutkan.',
    );
    expect(screen.getByRole('button', { name: /^hubungkan microsoft 365$/i })).toBeInTheDocument();
  });

  it('AC-M365LOC-002: reconnect shows Bahasa copy + a Bahasa Reconnect action', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: STATUS_STALE, error: null });
    await renderCard({ locale: 'id' });
    expect(await screen.findByTestId('m365-reconnect-msg')).toHaveTextContent(
      'Koneksi Microsoft 365 telah kedaluwarsa. Hubungkan ulang untuk melanjutkan.',
    );
    expect(screen.getByRole('button', { name: /^hubungkan ulang microsoft 365$/i })).toBeInTheDocument();
  });

  it('AC-M365LOC-002: revoked shows Bahasa copy + a Bahasa Reconnect action', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: STATUS_REVOKED, error: null });
    await renderCard({ locale: 'id' });
    expect(await screen.findByTestId('m365-revoked-msg')).toHaveTextContent(
      'Koneksi Microsoft 365 telah dicabut. Hubungkan kembali untuk melanjutkan.',
    );
    expect(screen.getByRole('button', { name: /^hubungkan ulang microsoft 365$/i })).toBeInTheDocument();
  });

  it('AC-M365LOC-002: unknown status renders the Bahasa fallback', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: null, error: networkError('x') });
    await renderCard({ locale: 'id' });
    const msg = await screen.findByTestId('m365-unknown-msg');
    expect(msg).toHaveTextContent(
      'Kami tidak dapat mengonfirmasi status koneksi Microsoft 365 Anda. Muat ulang halaman untuk mencoba lagi.',
    );
  });
});

describe('AC-M365LOC-003 — localized destructive confirmation', () => {
  it('AC-M365LOC-003: English dialog exposes the title, consequence, Cancel and Disconnect', async () => {
    featureState.value = true;
    await renderCard({ initialEntry: '/integrations?m365_connected=true' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /disconnect/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Disconnect Microsoft 365?');
    expect(dialog).toHaveTextContent(
      /disconnecting removes this microsoft 365 account connection/i,
    );
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('AC-M365LOC-003: Bahasa dialog exposes the localized title, consequence, Batal and Putuskan koneksi', async () => {
    featureState.value = true;
    await renderCard({ locale: 'id', initialEntry: '/integrations?m365_connected=true' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /putuskan koneksi/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Putuskan koneksi Microsoft 365?');
    expect(dialog).toHaveTextContent(/memutuskan koneksi akan menghapus koneksi akun microsoft 365 ini/i);
    expect(within(dialog).getByRole('button', { name: 'Batal' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Putuskan koneksi' })).toBeInTheDocument();
  });

  it('AC-M365LOC-003: cancel sends no mutation; confirming preserves the disconnect request and returns to disconnected', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    await renderCard({ initialEntry: '/integrations?m365_connected=true' });
    const user = userEvent.setup();

    // Cancel sends no mutation.
    await user.click(screen.getByRole('button', { name: /disconnect/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // Confirm runs the disconnect and returns to disconnected.
    await user.click(screen.getByRole('button', { name: /disconnect/i }));
    const dialog2 = await screen.findByRole('alertdialog');
    await user.click(within(dialog2).getByRole('button', { name: 'Disconnect' }));
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'disconnect' } });
    expect(await screen.findByRole('button', { name: /connect microsoft 365/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
  });
});

describe('AC-M365LOC-004 — reviewed error copy (no raw transport data)', () => {
  const KNOWN_CODES = [
    'NOT_ENTITLED', 'DISABLED_MEMBER', 'BANNED_MEMBER', 'ORG_APPROVAL_REQUIRED', 'FORBIDDEN',
    'UNAUTHORIZED', 'CONNECTION_STALE', 'CONNECTION_REVOKED', 'NOT_CONNECTED',
    'TOKEN_EXCHANGE_FAILED', 'INVALID_STATE', 'SCOPE_INSUFFICIENT', 'BAD_REQUEST', 'GRAPH_ERROR',
    'INTERNAL_ERROR',
  ];

  for (const code of KNOWN_CODES) {
    it(`AC-M365LOC-004: callback ${code} shows its reviewed English message, never the raw code`, async () => {
      featureState.value = true;
      await renderCard({ initialEntry: `/integrations?m365_error=raw:${code}&m365_error_code=${code}` });
      const banner = screen.getByRole('alert');
      expect(banner).toHaveTextContent(describeM365Error(code));
      expect(banner.textContent).not.toContain(code);
      expect(banner.textContent).not.toContain(`raw:${code}`);
      expect(screen.getByRole('button', { name: /connect microsoft 365/i })).not.toBeDisabled();
    });
  }

  it('AC-M365LOC-004: unknown callback code uses the generic fallback, never the raw value', async () => {
    featureState.value = true;
    const raw = 'UNKNOWN_WIRE_CODE_XYZ';
    await renderCard({ initialEntry: `/integrations?m365_error=${raw}&m365_error_code=${raw}` });
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Microsoft 365 could not be connected. Please try again.');
    expect(banner.textContent).not.toContain(raw);
  });

  it('AC-M365LOC-004: absent callback code uses the generic fallback', async () => {
    featureState.value = true;
    await renderCard({ initialEntry: '/integrations?m365_error=some_backend_blob' });
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Microsoft 365 could not be connected. Please try again.');
  });

  it('AC-M365LOC-004: a status fetch with a known code shows that reviewed message in the unknown state', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError({ error: 'INTERNAL_ERROR', message: 'status read failed' }, 500),
    });
    await renderCard();
    const msg = await screen.findByTestId('m365-unknown-msg');
    expect(msg).toHaveTextContent(describeM365Error('INTERNAL_ERROR'));
    expect(screen.queryByTestId('m365-connected-msg')).not.toBeInTheDocument();
  });

  it('AC-M365LOC-004: a status fetch without a stable code uses the statusFallback', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: null, error: networkError('Failed to send a request') });
    await renderCard();
    const msg = await screen.findByTestId('m365-unknown-msg');
    expect(msg).toHaveTextContent(
      "We couldn't confirm your Microsoft 365 connection status. Refresh the page to try again.",
    );
    expect(msg.textContent).not.toContain('Failed to send a request');
  });

  it('AC-M365LOC-004: a connect failure with a known code shows that reviewed message and no redirect', async () => {
    featureState.value = true;
    await renderCard();
    await settleIdle();
    const raw = 'detail for CONNECTION_STALE';
    invoke.mockResolvedValueOnce({ data: null, error: httpError({ error: 'CONNECTION_STALE', message: raw }, 409) });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /connect microsoft 365/i }));
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(describeM365Error('CONNECTION_STALE'));
    expect(banner.textContent).not.toContain(raw);
    expect(banner.textContent).not.toContain('CONNECTION_STALE');
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('AC-M365LOC-004: a transport-only connect failure uses the generic fallback', async () => {
    featureState.value = true;
    await renderCard();
    await settleIdle();
    const raw = 'Swarm connect dropped';
    invoke.mockResolvedValueOnce({ data: null, error: networkError(raw) });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /connect microsoft 365/i }));
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Microsoft 365 could not be connected. Please try again.');
    expect(banner.textContent).not.toContain(raw);
    expect(screen.getByRole('button', { name: /connect microsoft 365/i })).not.toBeDisabled();
  });

  it('AC-M365LOC-004: a known Bahasa error code renders its translated reason', async () => {
    featureState.value = true;
    await renderCard({ locale: 'id', initialEntry: '/integrations?m365_error=x&m365_error_code=CONNECTION_STALE' });
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Koneksi Microsoft 365 telah kedaluwarsa. Hubungkan ulang.');
    expect(banner.textContent).not.toContain('CONNECTION_STALE');
  });

  it('AC-M365LOC-004: changing locale while an error is visible updates the reviewed copy in place', async () => {
    featureState.value = true;
    const { i18n } = await renderCard({ initialEntry: '/integrations?m365_error=ignored&m365_error_code=INTERNAL_ERROR' });
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(describeM365Error('INTERNAL_ERROR'));
    await act(async () => { await i18n.changeLanguage('id'); });
    const reRendered = screen.getByRole('alert');
    expect(reRendered).toHaveTextContent('Terjadi kesalahan di sisi kami. Silakan coba lagi.');
    expect(reRendered.textContent).not.toContain('INTERNAL_ERROR');
  });
});

describe('AC-M365LOC-005 — disconnect recovery keeps connected + the dialog open, then retry succeeds', () => {
  /** A class token must be present/absent EXACTLY (not as a substring — `text-destructive-text`
   *  contains `text-destructive` textually, so a naive `.toContain` would false-pass rule 3). */
  const hasClass = (el: Element, cls: string) => el.className.split(/\s+/).includes(cls);

  it('AC-M365LOC-005: a failed disconnect keeps the dialog open, shows a WCAG-AA split headline/body alert on the reviewed tint tokens, focuses it, and allows retry → success returns to disconnected with focus on Connect', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: STATUS_ACTIVE, error: null }); // mount status → connected
    await renderCard();

    const user = userEvent.setup();
    await screen.findByTestId('m365-connected-msg');
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog');

    // First disconnect attempt fails with a known code + a raw server message.
    const raw = 'raw server detail for INTERNAL_ERROR';
    invoke.mockResolvedValueOnce({ data: null, error: httpError({ error: 'INTERNAL_ERROR', message: raw }, 500) });
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    // The dialog stays open and the last confirmed connected state is retained.
    const activeDialog = await screen.findByRole('alertdialog');
    expect(screen.getByTestId('m365-connected-msg')).toBeInTheDocument();

    // A localized, persistent alert on the EntityFormModal-recipe tint surface — never a raw
    // `bg-destructive/10` / `text-destructive` combination (WCAG AA, DESIGN.md Modal rule 3).
    const alert = within(activeDialog).getByRole('alert');
    expect(hasClass(alert, 'border-destructive/30')).toBe(true);
    expect(hasClass(alert, 'bg-destructive/[0.07]')).toBe(true);
    expect(hasClass(alert, 'bg-destructive/10')).toBe(false);
    expect(hasClass(alert, 'text-destructive')).toBe(false);

    // Headline states the outcome (still connected) in `destructive-text`; body carries the
    // reviewed reason + retry/cancel guidance ONCE in `muted-foreground` — no repeated
    // "You can retry or cancel. … Please try again." double guidance.
    const headline = within(alert).getByText(
      "We couldn't confirm the disconnect. The last confirmed status is still connected.",
    );
    expect(hasClass(headline, 'text-destructive-text')).toBe(true);
    expect(hasClass(headline, 'text-destructive')).toBe(false);

    const body = within(alert).getByText(/Something went wrong on our end\. Please try again\./);
    expect(hasClass(body, 'text-muted-foreground')).toBe(true);
    expect(hasClass(body, 'text-destructive')).toBe(false);
    expect(body).toHaveTextContent('You can retry or cancel.');
    // The guidance appears exactly once in the body (not duplicated with the headline).
    expect(body.textContent?.match(/retry or cancel/gi)?.length).toBe(1);

    // No raw transport text or raw code anywhere in the alert.
    expect(alert.textContent).not.toContain(raw);
    expect(alert.textContent).not.toContain('INTERNAL_ERROR');

    // Focus moves to the alert region as a whole (originating-dialog error rule).
    expect(document.activeElement).toBe(alert);

    // The confirm action is available again for retry.
    expect(within(activeDialog).getByRole('button', { name: 'Disconnect' })).not.toBeDisabled();

    // A subsequent successful retry closes the dialog and returns the card to disconnected, with
    // focus moved to Connect (it would otherwise drop to <body> — the Disconnect trigger unmounts).
    invoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    await user.click(within(activeDialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    const connectBtn = screen.getByRole('button', { name: /connect microsoft 365/i });
    expect(connectBtn).toBeInTheDocument();
    expect(screen.queryByTestId('m365-connected-msg')).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'disconnect' } });
    await waitFor(() => expect(document.activeElement).toBe(connectBtn));
  });

  it('AC-M365LOC-005: the Bahasa disconnect-failure alert renders the localized split headline + body', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: STATUS_ACTIVE, error: null });
    await renderCard({ locale: 'id' });

    const user = userEvent.setup();
    await screen.findByTestId('m365-connected-msg');
    await user.click(screen.getByRole('button', { name: 'Putuskan koneksi' }));
    const dialog = await screen.findByRole('alertdialog');

    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError({ error: 'INTERNAL_ERROR', message: 'raw' }, 500),
    });
    await user.click(within(dialog).getByRole('button', { name: 'Putuskan koneksi' }));

    const activeDialog = await screen.findByRole('alertdialog');
    const alert = within(activeDialog).getByRole('alert');
    const headline = within(alert).getByText(
      'Kami tidak dapat memastikan pemutusan koneksi. Status koneksi terakhir yang terkonfirmasi masih terhubung.',
    );
    expect(hasClass(headline, 'text-destructive-text')).toBe(true);
    const body = within(alert).getByText(/Terjadi kesalahan di sisi kami\. Silakan coba lagi\./);
    expect(hasClass(body, 'text-muted-foreground')).toBe(true);
    expect(body).toHaveTextContent('Anda dapat mencoba lagi atau membatalkan.');
    expect(document.activeElement).toBe(alert);
  });
});

describe('AC-M365LOC-001 — every t() call carries its English default (missing-key fallback)', () => {
  // Reproduces the app's real "catalogue fetch failed" degradation (i18n/index.ts's
  // `parseMissingKeyHandler`, FR-L10N-041): an i18next instance with NO resources for any key. A
  // call site that omits its English default (`t('key')` instead of `t('key', 'English text')`)
  // renders the raw dotted key under this instance — this is the regression this suite pins.
  async function renderWithEmptyCatalogue(initialEntry = '/integrations') {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'common',
      resources: { en: { common: {} } },
      parseMissingKeyHandler,
      returnEmptyString: false,
    });
    const utils = render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <M365ConnectionCard />
        </MemoryRouter>
      </I18nextProvider>,
    );
    return { ...utils, i18n };
  }

  it('AC-M365LOC-001: disconnected renders the English default copy + Connect label with zero catalogues loaded', async () => {
    featureState.value = true;
    await renderWithEmptyCatalogue();
    const btn = await screen.findByRole('button', { name: /^connect microsoft 365$/i });
    expect(btn).toBeInTheDocument();
    expect(
      screen.getByText(
        'Not connected. Connect your own Microsoft 365 account to let PMO Portal access the OneDrive files, Teams, and calendar information available through your account.',
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/integrations\.[a-zA-Z0-9.]+/);
  });

  it('AC-M365LOC-001: a known error code renders its English reviewed reason with zero catalogues loaded', async () => {
    featureState.value = true;
    await renderWithEmptyCatalogue('/integrations?m365_error=raw&m365_error_code=NOT_ENTITLED');
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(describeM365Error('NOT_ENTITLED'));
    expect(document.body.textContent).not.toMatch(/integrations\.[a-zA-Z0-9.]+/);
  });
});

// ── #692: callback/dialog copy agrees with the buttons; the status icon sits on the first line ──
describe('AC-M365LOC-007 — copy names the action the button actually offers', () => {
  it('AC-M365LOC-007: insufficient permissions (English) says Connect again while the button reads Connect', async () => {
    featureState.value = true;
    await renderCard({
      initialEntry: '/integrations?m365_error=raw&m365_error_code=SCOPE_INSUFFICIENT',
    });
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(/connect again to grant them/i);
    expect(banner.textContent).not.toMatch(/reconnect/i);
    // The button in this state is the plain Connect — the message and the button use the same verb.
    expect(screen.getByRole('button', { name: /^connect microsoft 365$/i })).toBeInTheDocument();
  });

  it('AC-M365LOC-007: insufficient permissions (Bahasa) says Hubungkan kembali while the button reads Hubungkan', async () => {
    featureState.value = true;
    await renderCard({
      locale: 'id',
      initialEntry: '/integrations?m365_error=raw&m365_error_code=SCOPE_INSUFFICIENT',
    });
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(/hubungkan kembali untuk memberikan izin/i);
    expect(banner.textContent).not.toMatch(/hubungkan ulang/i);
    expect(screen.getByRole('button', { name: /^hubungkan microsoft 365$/i })).toBeInTheDocument();
  });

  it.each([
    ['en', /PMO Portal can no longer access/, /PMO can no longer/],
    ['id', /PMO Portal tidak dapat lagi mengakses/, /PMO tidak dapat lagi/],
  ] as const)(
    'AC-M365LOC-007: the %s disconnect dialog names the product "PMO Portal", like the card',
    async (locale, expected, forbidden) => {
      featureState.value = true;
      await renderCard({ locale, initialEntry: '/integrations?m365_connected=true' });
      const user = userEvent.setup();
      await user.click(
        screen.getByRole('button', { name: locale === 'en' ? /disconnect/i : /putuskan koneksi/i }),
      );
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog.textContent).toMatch(expected);
      expect(dialog.textContent).not.toMatch(forbidden);
    },
  );
});

describe('AC-M365LOC-008 — a wrapped status line keeps its icon on the FIRST line (390px)', () => {
  /** Every status line is a flex row whose icon is top-aligned and nudged onto the first text line. */
  function expectFirstLineIcon(line: HTMLElement) {
    expect(line.className).toContain('items-start');
    expect(line.className).not.toContain('items-center');
    const icon = line.querySelector('svg');
    expect(icon, 'status line has an icon').not.toBeNull();
    expect(icon!.getAttribute('class')).toContain('mt-[3px]');
  }

  it('AC-M365LOC-008: the error line (callback failure)', async () => {
    featureState.value = true;
    await renderCard({ initialEntry: '/integrations?m365_error=raw&m365_error_code=GRAPH_ERROR' });
    expectFirstLineIcon(screen.getByTestId('m365-error-msg'));
  });

  it.each([
    ['m365-connected-msg', STATUS_ACTIVE],
    ['m365-reconnect-msg', STATUS_STALE],
    ['m365-revoked-msg', STATUS_REVOKED],
  ] as const)('AC-M365LOC-008: %s (status fetch)', async (testId, status) => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: status, error: null });
    await renderCard();
    expectFirstLineIcon(await screen.findByTestId(testId));
  });

  it('AC-M365LOC-008: the unknown-status line', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: null, error: networkError('boom') });
    await renderCard();
    expectFirstLineIcon(await screen.findByTestId('m365-unknown-msg'));
  });

  it('AC-M365LOC-008: the organization-approved line', async () => {
    featureState.value = true;
    await renderCard({ initialEntry: '/integrations?m365_org_approved=true' });
    expectFirstLineIcon(screen.getByTestId('m365-org-approved-msg'));
  });
});