/**
 * M365ConnectionCard — Phase-1 FE wiring of the token-custody edge function.
 *
 *   AC-M365-012 — the two-switch gate (entitlement + Admin) still hides the card AND suppresses
 *                 the status fetch (no edge-fn call when the card is hidden). (unchanged)
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
 *   AC-M365-018 — callback ?m365_error=<msg> renders the error state and the param is cleared.
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
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { featureState, invoke } = vi.hoisted(() => ({
  featureState: { value: false },
  invoke: vi.fn(),
}));

vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => featureState.value }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import { M365ConnectionCard } from '../M365ConnectionCard';

/** A not-connected connection_status response (the honest default for a fresh load). */
const STATUS_NOT_CONNECTED = {
  data: { connected: false, status: null, connected_at: null, last_refresh_at: null, scopes: [] },
  error: null,
};

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

/** Render the card inside a MemoryRouter; optionally seed the initial URL (for callback params). */
function renderCard(opts: { isOperator?: boolean; initialEntry?: string } = {}) {
  const isOperator = opts.isOperator ?? true;
  const initialEntry = opts.initialEntry ?? '/admin/integrations';
  const locationSearch: string[] = [];
  const Probe: React.FC = () => {
    const loc = useLocation();
    locationSearch.push(loc.search);
    return null;
  };
  const utils = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Probe />
      <M365ConnectionCard isOperator={isOperator} />
    </MemoryRouter>,
  );
  return { ...utils, isOperator, locationSearch };
}

beforeEach(() => {
  featureState.value = false;
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

/** Wait for the card to settle into the idle baseline (Connect button present), post status fetch. */
const settleIdle = () => screen.findByRole('button', { name: /connect microsoft 365/i });

describe('AC-M365-012 — activation card visibility (two-switch: entitlement + Admin)', () => {
  it('AC-M365-012: hidden when the org is NOT entitled (and the status fetch never fires)', () => {
    featureState.value = false;
    const { container } = renderCard({ isOperator: true });
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('AC-M365-012: hidden when entitled but the viewer is NOT Admin (and the status fetch never fires)', () => {
    featureState.value = true;
    const { container } = renderCard({ isOperator: false });
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('AC-M365-012: rendered when entitled AND Admin', async () => {
    featureState.value = true;
    renderCard();
    expect(screen.getByTestId('m365-connection-card')).toBeInTheDocument();
  });
});

describe('AC-M365-013 — Phase-1 wiring: the held stub is retired; Connect is live', () => {
  it('AC-M365-013: shows "Not connected" + an ENABLED Connect button (no longer a disabled stub)', async () => {
    featureState.value = true;
    renderCard();
    const btn = await settleIdle();
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });
});

describe('AC-M365-014 — Connect calls initiate_connect and redirects to authorizeUrl', () => {
  it('AC-M365-014: POSTs initiate_connect, then top-level-redirects to the returned URL', async () => {
    featureState.value = true;
    const authorizeUrl = 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize?client_id=x';
    renderCard();
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
      renderCard();
      await settleIdle();
      invoke.mockResolvedValueOnce({
        data: null,
        error: httpError({ error: code, message: rawServerMessage }, status),
      });

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /connect microsoft 365/i }));

      // The banner appears, the raw server message + code string never surface, no redirect.
      const banner = await screen.findByRole('alert');
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
    renderCard();
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
  it('AC-M365-017: shows Connected + Disconnect, and the param is removed from the URL', () => {
    featureState.value = true;
    const { locationSearch } = renderCard({ initialEntry: '/admin/integrations?m365_connected=true' });

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

describe('AC-M365-018 — callback ?m365_error=<msg> renders the error + clears the param', () => {
  it('AC-M365-018: shows the server-authored error banner and removes the param', () => {
    featureState.value = true;
    const msg = encodeURIComponent('Connection failed: identity mismatch. Please contact your administrator.');
    const { locationSearch } = renderCard({ initialEntry: `/admin/integrations?m365_error=${msg}` });

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Connection failed: identity mismatch');
    // Connect stays available for retry.
    expect(screen.getByRole('button', { name: /connect microsoft 365/i })).not.toBeDisabled();
    // Status fetch skipped (callback param drove the immediate state) — no invoke.
    expect(invoke).not.toHaveBeenCalled();
    const last = locationSearch[locationSearch.length - 1];
    expect(last).not.toContain('m365_error');
  });
});

describe('AC-M365-019 — Disconnect confirms first, then calls the fn', () => {
  it('AC-M365-019: confirming the destructive dialog calls disconnect and returns the card to idle', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    renderCard({ initialEntry: '/admin/integrations?m365_connected=true' });

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
    renderCard({ initialEntry: '/admin/integrations?m365_connected=true' });

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
    renderCard();
    await settleIdle();
    invoke.mockResolvedValueOnce({
      data: { authorizeUrl: 'https://login.microsoftonline.com/x', state: secretState },
      error: null,
    });

    const { container } = renderCard({ initialEntry: '/admin/integrations?m365_connected=true' });
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
      data: {
        connected: true,
        status: 'active',
        connected_at: '2026-07-15T10:00:00.000Z',
        last_refresh_at: '2026-07-20T09:00:00.000Z',
        scopes: ['Files.Read'],
      },
      error: null,
    });

    renderCard();
    const msg = await screen.findByTestId('m365-connected-msg');
    expect(msg).toHaveTextContent(/connected since/i);
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect microsoft 365/i })).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'connection_status' } });
  });

  it('AC-M365-022: a stale connection renders "Needs reconnect" + a Reconnect button (no Disconnect)', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({
      data: { connected: true, status: 'stale', connected_at: '2026-07-15T10:00:00.000Z', last_refresh_at: null, scopes: ['Files.Read'] },
      error: null,
    });

    renderCard();
    await screen.findByTestId('m365-reconnect-msg');
    expect(screen.getByRole('button', { name: /reconnect microsoft 365/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
  });

  it('AC-M365-022: a revoked connection renders the revoked state + a Reconnect button', async () => {
    featureState.value = true;
    invoke.mockResolvedValueOnce({
      data: { connected: true, status: 'revoked', connected_at: '2026-07-15T10:00:00.000Z', last_refresh_at: null, scopes: ['Files.Read'] },
      error: null,
    });

    renderCard();
    await screen.findByTestId('m365-revoked-msg');
    expect(screen.getByRole('button', { name: /reconnect microsoft 365/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
  });

  it('AC-M365-022: an absent connection renders "Not connected" + a Connect button (the default)', async () => {
    featureState.value = true;
    renderCard(); // default invoke → not-connected status

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

    renderCard();
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

    renderCard();
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

    const first = renderCard();
    await settleIdle();
    expect(invoke).toHaveBeenCalledTimes(1);

    // Unmount + remount — exactly what StrictMode does on every dev mount.
    first.unmount();
    renderCard();

    // The remounted card must fetch its own status; if the guard is never released it renders
    // "Checking…" forever with no request in flight.
    await settleIdle();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('m365-loading-msg')).not.toBeInTheDocument();
  });
});
