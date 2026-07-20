/**
 * M365ConnectionCard — Phase-1 FE wiring of the token-custody edge function.
 *
 *   AC-M365-012 — the two-switch gate (entitlement + Admin) still hides the card. (unchanged)
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
 *
 * The supabase.functions.invoke client is mocked (the edge fn is NOT deployed + has NO secrets);
 * window.location.assign is stubbed (jsdom cannot cross-origin navigate). Mirrors the
 * adapterSeam/dispatchClient test conventions.
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

const assignMock = vi.fn();

/** Render the card inside a MemoryRouter; optionally seed the initial URL (for callback params). */
function renderCard(opts: { isAdmin?: boolean; initialEntry?: string } = {}) {
  const isAdmin = opts.isAdmin ?? true;
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
      <M365ConnectionCard isAdmin={isAdmin} />
    </MemoryRouter>,
  );
  return { ...utils, isAdmin, locationSearch };
}

beforeEach(() => {
  featureState.value = false;
  invoke.mockReset();
  assignMock.mockClear();
  // jsdom's `window.location` is a non-configurable navigation stub — replace the whole object
  // (the chunkReload.test.ts pattern) so `window.location.assign` is observable + doesn't throw
  // a cross-origin navigation error when the card redirects to login.microsoftonline.com.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: assignMock, href: '' },
  });
});

describe('AC-M365-012 — activation card visibility (two-switch: entitlement + Admin)', () => {
  it('AC-M365-012: hidden when the org is NOT entitled', () => {
    featureState.value = false;
    const { container } = renderCard({ isAdmin: true });
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('AC-M365-012: hidden when entitled but the viewer is NOT Admin', () => {
    featureState.value = true;
    const { container } = renderCard({ isAdmin: false });
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('AC-M365-012: rendered when entitled AND Admin', () => {
    featureState.value = true;
    renderCard({ isAdmin: true });
    expect(screen.getByTestId('m365-connection-card')).toBeInTheDocument();
  });
});

describe('AC-M365-013 — Phase-1 wiring: the held stub is retired; Connect is live', () => {
  it('AC-M365-013: shows "Not connected" + an ENABLED Connect button (no longer a disabled stub)', () => {
    featureState.value = true;
    renderCard();
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /connect microsoft 365/i });
    expect(btn).not.toBeDisabled();
  });
});

describe('AC-M365-014 — Connect calls initiate_connect and redirects to authorizeUrl', () => {
  it('AC-M365-014: POSTs initiate_connect, then top-level-redirects to the returned URL', async () => {
    featureState.value = true;
    const authorizeUrl = 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize?client_id=x';
    invoke.mockResolvedValueOnce({
      data: { authorizeUrl, state: 'csrf-state-token' },
      error: null,
    });

    renderCard();
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
      invoke.mockResolvedValueOnce({
        data: null,
        error: httpError({ error: code, message: rawServerMessage }, status),
      });

      renderCard();
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
    // An invoke that never resolves synchronously — keeps the card in-flight across both clicks.
    let resolveInvoke!: (v: unknown) => void;
    invoke.mockImplementationOnce(
      () => new Promise((r) => { resolveInvoke = r; }),
    );

    renderCard();
    const btn = screen.getByRole('button', { name: /connect microsoft 365/i });
    fireEvent.click(btn);
    fireEvent.click(btn); // second click while the first is still in flight

    expect(invoke).toHaveBeenCalledTimes(1);

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
    invoke.mockResolvedValueOnce({
      data: { authorizeUrl: 'https://login.microsoftonline.com/x', state: secretState },
      error: null,
    });

    const { container } = renderCard();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /connect microsoft 365/i }));

    expect(assignMock).toHaveBeenCalled();
    expect(container.textContent).not.toContain(secretState);
    expect(container.textContent).not.toContain('oid');
    expect(container.textContent).not.toContain('code_verifier');

    // And a failed initiate carries no raw server message into the DOM either.
    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError({ error: 'TOKEN_EXCHANGE_FAILED', message: rawServerMessage }, 502),
    });
    await user.click(screen.getByRole('button', { name: /connect microsoft 365/i }));
    expect(container.textContent).not.toContain(rawServerMessage);
    expect(container.textContent).not.toContain('code_verifier');
  });
});
