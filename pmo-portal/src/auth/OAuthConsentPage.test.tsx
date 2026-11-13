/**
 * AC-CLI-006 — the OAuth consent screen (#728). Supabase Auth's OAuth 2.1 server sends the browser
 * to /oauth/consent?authorization_id=… (supabase/config.toml `[auth.oauth_server]`); this page shows
 * WHO is asking (the registered client name) and AS WHOM (the signed-in account), then relays the
 * user's Allow / Deny back to Supabase and follows the redirect it returns.
 *
 * The signed-out case is the sign-in guard's job (RequireAuth → /login with return-to, AC-CLI-012,
 * RequireAuth.test.tsx + LoginPage.test.tsx); the whole journey runs for real in
 * e2e/AC-CLI-001-cli-oauth-login.spec.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import authEn from '../../public/locales/en/auth.json';
import authId from '../../public/locales/id/auth.json';

const consent = vi.hoisted(() => ({ getConsentDetails: vi.fn(), decideConsent: vi.fn() }));
vi.mock('./oauthConsent', () => consent);

import OAuthConsentPage from './OAuthConsentPage';

const assign = vi.fn();

const DETAILS = {
  kind: 'consent' as const,
  authorizationId: 'auth-1',
  clientName: 'PMO CLI',
  userEmail: 'owner@example.test',
  redirectUri: 'http://127.0.0.1:53917/callback',
};

function consentTree(url: string) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/oauth/consent" element={<OAuthConsentPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderAt(url: string) {
  return render(consentTree(url));
}

async function renderInBahasa(url: string) {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: 'id',
    fallbackLng: false,
    defaultNS: 'auth',
    resources: { en: { auth: authEn }, id: { auth: authId } },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      {consentTree(url)}
    </I18nextProvider>,
  );
}

beforeEach(() => {
  consent.getConsentDetails.mockReset();
  consent.decideConsent.mockReset();
  assign.mockReset();
  // jsdom cannot navigate cross-origin; observe the hand-off instead (M365ConnectionCard.test.tsx pattern).
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
});

describe('OAuthConsentPage (AC-CLI-006)', () => {
  it('AC-CLI-006: shows a loading state while the request is fetched', () => {
    consent.getConsentDetails.mockReturnValue(new Promise(() => {}));
    renderAt('/oauth/consent?authorization_id=auth-1');
    expect(screen.getByRole('status')).toHaveTextContent('Loading the sign-in request…');
    expect(screen.getByRole('heading', { level: 1, name: 'Sign-in request incomplete' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('PMO Portal')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('AC-CLI-006: names the requesting client and the signed-in account, with Allow and Deny', async () => {
    consent.getConsentDetails.mockResolvedValue(DETAILS);
    renderAt('/oauth/consent?authorization_id=auth-1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Allow PMO CLI to access your PMO account?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Signed in as owner@example.test')).toBeInTheDocument();
    expect(screen.getByText(/PMO CLI will be able to read and change PMO records as you/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(consent.getConsentDetails).toHaveBeenCalledWith('auth-1');
  });

  it.each([
    'http://127.0.0.1:53917/callback',
    'http://localhost:8080/callback',
    'http://[::1]:53917/callback',
  ])('AC-CLI-006: says the answer returns to a program on this computer when the redirect is loopback (%s)', async (redirectUri) => {
    consent.getConsentDetails.mockResolvedValue({ ...DETAILS, redirectUri });
    renderAt('/oauth/consent?authorization_id=auth-1');
    expect(await screen.findByText('After you answer, you return to a program on this computer.')).toBeInTheDocument();
  });

  it.each(['https://app.example.test/callback', 'not a url'])(
    'AC-CLI-006: says nothing about this computer when the redirect is not loopback (%s)',
    async (redirectUri) => {
    consent.getConsentDetails.mockResolvedValue({ ...DETAILS, redirectUri });
    renderAt('/oauth/consent?authorization_id=auth-1');
    await screen.findByRole('button', { name: 'Allow' });
    expect(screen.queryByText(/program on this computer/)).toBeNull();
    },
  );

  it('AC-CLI-006: Allow approves THIS request and hands the browser to the redirect Supabase returns', async () => {
    consent.getConsentDetails.mockResolvedValue(DETAILS);
    consent.decideConsent.mockResolvedValue('http://127.0.0.1:53917/callback?code=c&state=s');
    renderAt('/oauth/consent?authorization_id=auth-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:53917/callback?code=c&state=s'));
    expect(consent.decideConsent).toHaveBeenCalledWith('auth-1', 'approve');
    expect(screen.getByRole('status')).toHaveTextContent('Returning you to the application…');
    expect(screen.getByRole('heading', { level: 1, name: 'Returning to the application' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });

  it('AC-CLI-006: Deny refuses THIS request and hands the browser back with the refusal', async () => {
    consent.getConsentDetails.mockResolvedValue(DETAILS);
    consent.decideConsent.mockResolvedValue('http://127.0.0.1:53917/callback?error=access_denied&state=s');
    renderAt('/oauth/consent?authorization_id=auth-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('http://127.0.0.1:53917/callback?error=access_denied&state=s'),
    );
    expect(consent.decideConsent).toHaveBeenCalledWith('auth-1', 'deny');
  });

  it('AC-CLI-006: both buttons are disabled while the answer is being sent (no double submit)', async () => {
    consent.getConsentDetails.mockResolvedValue(DETAILS);
    consent.decideConsent.mockReturnValue(new Promise(() => {}));
    renderAt('/oauth/consent?authorization_id=auth-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    expect(consent.decideConsent).toHaveBeenCalledTimes(1);
  });

  it('AC-CLI-006: a request the user already approved goes straight back, without asking again', async () => {
    consent.getConsentDetails.mockResolvedValue({
      kind: 'redirect',
      redirectUrl: 'http://127.0.0.1:53917/callback?code=c2&state=s',
    });
    renderAt('/oauth/consent?authorization_id=auth-1');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:53917/callback?code=c2&state=s'));
    expect(screen.getByRole('status')).toHaveTextContent('Returning you to the application…');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('AC-CLI-006: the request is read exactly ONCE, even when React runs the effect twice (StrictMode)', async () => {
    // Reading an already-approved request issues its code; a second read is refused by the auth
    // server ("authorization request cannot be processed"). Found by the e2e journey: under the dev
    // build's StrictMode the second read's error replaced the first read's redirect.
    consent.getConsentDetails.mockResolvedValueOnce({
      kind: 'redirect',
      redirectUrl: 'http://127.0.0.1:53917/callback?code=c3&state=s',
    });
    consent.getConsentDetails.mockRejectedValue(new Error('authorization request cannot be processed'));
    render(
      <React.StrictMode>
        <MemoryRouter initialEntries={['/oauth/consent?authorization_id=auth-1']}>
          <Routes>
            <Route path="/oauth/consent" element={<OAuthConsentPage />} />
          </Routes>
        </MemoryRouter>
      </React.StrictMode>,
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:53917/callback?code=c3&state=s'));
    expect(consent.getConsentDetails).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('AC-CLI-006: a request that cannot be loaded shows an error and no way to approve', async () => {
    consent.getConsentDetails.mockRejectedValue(new Error('authorization not found'));
    renderAt('/oauth/consent?authorization_id=auth-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('This sign-in request could not be loaded.');
    expect(screen.getByText('Start the sign-in again from the application that sent you here.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign-in request incomplete' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });

  it('AC-CLI-006: Retry re-runs only the same request read', async () => {
    consent.getConsentDetails
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValueOnce(DETAILS);
    renderAt('/oauth/consent?authorization_id=auth-1');
    await screen.findByRole('button', { name: 'Retry' });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: 'Allow' })).toBeEnabled();
    expect(consent.getConsentDetails).toHaveBeenNthCalledWith(1, 'auth-1');
    expect(consent.getConsentDetails).toHaveBeenNthCalledWith(2, 'auth-1');
    expect(consent.getConsentDetails).toHaveBeenCalledTimes(2);
    expect(consent.decideConsent).not.toHaveBeenCalled();
  });

  it('AC-CLI-006: Allow after Retry approves the authorization id returned by the second read', async () => {
    consent.getConsentDetails
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValueOnce({ ...DETAILS, authorizationId: 'auth-returned-by-retry' });
    consent.decideConsent.mockResolvedValue('http://127.0.0.1:53917/callback?code=retry&state=s');
    renderAt('/oauth/consent?authorization_id=auth-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));

    await waitFor(() =>
      expect(consent.decideConsent).toHaveBeenCalledWith('auth-returned-by-retry', 'approve'),
    );
    expect(consent.getConsentDetails).toHaveBeenNthCalledWith(1, 'auth-1');
    expect(consent.getConsentDetails).toHaveBeenNthCalledWith(2, 'auth-1');
    expect(consent.getConsentDetails).toHaveBeenCalledTimes(2);
  });

  it('AC-CLI-006: Deny after Retry refuses the authorization id returned by the second read', async () => {
    consent.getConsentDetails
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValueOnce({ ...DETAILS, authorizationId: 'auth-returned-by-retry' });
    consent.decideConsent.mockResolvedValue('http://127.0.0.1:53917/callback?error=access_denied&state=s');
    renderAt('/oauth/consent?authorization_id=auth-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));

    await waitFor(() =>
      expect(consent.decideConsent).toHaveBeenCalledWith('auth-returned-by-retry', 'deny'),
    );
    expect(consent.getConsentDetails).toHaveBeenNthCalledWith(1, 'auth-1');
    expect(consent.getConsentDetails).toHaveBeenNthCalledWith(2, 'auth-1');
    expect(consent.getConsentDetails).toHaveBeenCalledTimes(2);
  });

  it('AC-CLI-006: a failed Allow shows an error and lets the user try again', async () => {
    consent.getConsentDetails.mockResolvedValue(DETAILS);
    consent.decideConsent.mockRejectedValueOnce(new Error('network'));
    renderAt('/oauth/consent?authorization_id=auth-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your answer could not be sent.');
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  });

  it('AC-CLI-006: a link without an authorization_id is refused without calling Supabase', () => {
    renderAt('/oauth/consent');
    expect(screen.getByRole('alert')).toHaveTextContent('This sign-in request is incomplete.');
    expect(consent.getConsentDetails).not.toHaveBeenCalled();
  });

  it('AC-CLI-006: the consent screen reads in Bahasa Indonesia under the id catalogue', async () => {
    consent.getConsentDetails.mockResolvedValue(DETAILS);
    await renderInBahasa('/oauth/consent?authorization_id=auth-1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Izinkan PMO CLI mengakses akun PMO Anda?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Masuk sebagai owner@example.test')).toBeInTheDocument();
    expect(screen.getByText('Setelah Anda menjawab, Anda akan kembali ke program di komputer ini.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Izinkan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tolak' })).toBeInTheDocument();
    expect(screen.queryByText('Allow')).toBeNull();
  });

  it('AC-CLI-006: the incomplete-request view reads in Bahasa Indonesia', async () => {
    await renderInBahasa('/oauth/consent');
    expect(screen.getByRole('alert')).toHaveTextContent('Permintaan masuk ini tidak lengkap.');
    expect(screen.getByRole('heading', { level: 1, name: 'Permintaan masuk tidak lengkap' })).toBeInTheDocument();
    expect(screen.getByText('Mulai kembali proses masuk dari aplikasi yang mengirim Anda ke sini.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText(/Sign-in request incomplete/)).toBeNull();
  });

  it('AC-CLI-006: the failed-read Retry and remedy are in Bahasa Indonesia', async () => {
    consent.getConsentDetails.mockRejectedValue(new Error('temporary read failure'));
    await renderInBahasa('/oauth/consent?authorization_id=auth-1');
    expect(await screen.findByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
    expect(screen.getByText('Mulai kembali proses masuk dari aplikasi yang mengirim Anda ke sini.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText(/Sign-in request incomplete/)).toBeNull();
  });
});
