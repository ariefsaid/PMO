import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMissingKeyHandler } from '@/src/lib/i18n';

// usePermission drives the FE Admin gate. Hoist a controllable boolean so each test can flip the
// caller between Admin (gate open) and non-Admin (gate closed).
const { canApprove } = vi.hoisted(() => ({ canApprove: { value: true } }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => canApprove.value,
}));

// Mock only the card transport while retaining the real error-copy mapping used by the edge
// transport. This keeps the UI assertion tied to the wire-code mapping rather than a frozen string.
vi.mock('@/src/lib/m365/connectClient', async () => {
  const actual = await vi.importActual<typeof import('@/src/lib/m365/connectClient')>(
    '@/src/lib/m365/connectClient',
  );
  return { ...actual, initiateM365OrgApproval: vi.fn() };
});

import { M365OrgApprovalCard } from '../M365OrgApprovalCard';
import { describeM365Error, initiateM365OrgApproval } from '@/src/lib/m365/connectClient';

const assignMock = vi.fn();

beforeEach(() => {
  canApprove.value = true;
  vi.mocked(initiateM365OrgApproval).mockReset();
  // jsdom's window.location is a non-configurable stub — replace the whole object so
  // window.location.assign is observable and does not throw a cross-origin navigation error when
  // the card redirects to login.microsoftonline.com (mirrors M365ConnectionCard.test.tsx).
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: assignMock, href: '' },
  });
  assignMock.mockClear();
});

describe('AC-M365SEP-017 — M365OrgApprovalCard visibility (FE Admin gate)', () => {
  it('AC-M365SEP-017: renders the affordance with an Approve button when the caller is an Admin', () => {
    canApprove.value = true;
    render(<M365OrgApprovalCard />);
    expect(screen.getByTestId('m365-org-approval')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /approve in microsoft 365/i }),
    ).toBeInTheDocument();
  });

  it('AC-M365SEP-017: renders NOTHING for a non-Admin (FE Admin-only; edge fn re-enforces Admin-or-Operator)', () => {
    canApprove.value = false;
    const { container } = render(<M365OrgApprovalCard />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('m365-org-approval')).not.toBeInTheDocument();
  });
});

describe('FR-M365SEP-005 — Approve calls initiate_org_approval and top-level-navigates to the consent URL', () => {
  it('FR-M365SEP-005: POSTs initiate_org_approval, then top-level-redirects to the returned adminConsentUrl', async () => {
    const adminConsentUrl =
      'https://login.microsoftonline.com/test-tenant-id/v2.0/adminconsent?client_id=test-client-id';
    vi.mocked(initiateM365OrgApproval).mockResolvedValueOnce({ adminConsentUrl });

    render(<M365OrgApprovalCard />);
    fireEvent.click(screen.getByRole('button', { name: /approve in microsoft 365/i }));

    await waitFor(() => expect(initiateM365OrgApproval).toHaveBeenCalledTimes(1));
    // Top-level navigation — Microsoft's consent page must be user-visible, never in an iframe.
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith(adminConsentUrl));
  });

  it('FR-M365SEP-005: a FORBIDDEN response surfaces the reviewed human copy (no navigation, button re-enabled)', async () => {
    // The caller is an Admin on the FE but the edge fn rejected (e.g. real role not Admin + not
    // Operator). classifyM365InvokeError maps FORBIDDEN → reviewed copy; the card surfaces it and
    // does NOT navigate.
    const { AppError } = await import('@/src/lib/appError');
    vi.mocked(initiateM365OrgApproval).mockRejectedValueOnce(
      new AppError(describeM365Error('FORBIDDEN'), 'FORBIDDEN'),
    );

    render(<M365OrgApprovalCard />);
    fireEvent.click(screen.getByRole('button', { name: /approve in microsoft 365/i }));

    await waitFor(() =>
      expect(screen.getByTestId('m365-org-approval-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('m365-org-approval-error')).toHaveTextContent(
      describeM365Error('FORBIDDEN'),
    );
    // No navigation happened on failure.
    expect(assignMock).not.toHaveBeenCalled();
    // The button is re-enabled for a retry (phase returned to idle/error, not stuck on 'approving').
    expect(
      screen.getByRole('button', { name: /approve in microsoft 365/i }),
    ).not.toBeDisabled();
  });

  it('FR-M365SEP-005: a double-click does not fire two initiate calls (in-flight guard)', async () => {
    vi.mocked(initiateM365OrgApproval).mockResolvedValueOnce({
      adminConsentUrl: 'https://login.microsoftonline.com/test/v2.0/adminconsent',
    });

    render(<M365OrgApprovalCard />);
    const btn = screen.getByRole('button', { name: /approve in microsoft 365/i });
    fireEvent.click(btn);
    fireEvent.click(btn); // stray second synchronous click before React flushes

    await waitFor(() => expect(initiateM365OrgApproval).toHaveBeenCalledTimes(1));
  });
});

// ── #690: the organization-approval card is localized and shares the personal card's error table ──
/** The REAL shipped catalogues — assertions pin the actual copy in both languages. */
type Catalogue = { integrations: { personalM365: { errors: Record<string, string> } } };
const readCatalogue = (lng: 'en' | 'id') =>
  JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/common.json`), 'utf8')) as Catalogue;

async function makeI18n(lng: 'en' | 'id', withCatalogues = true) {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng,
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: withCatalogues
      ? { en: { common: readCatalogue('en') }, id: { common: readCatalogue('id') } }
      : { en: { common: {} } },
    parseMissingKeyHandler,
    returnEmptyString: false,
  });
  return i18n;
}

async function renderLocalized(lng: 'en' | 'id', withCatalogues = true) {
  const i18n = await makeI18n(lng, withCatalogues);
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <M365OrgApprovalCard />
    </I18nextProvider>,
  );
  return { ...utils, i18n };
}

/** Click the approve button (its accessible name differs per locale) and wait for the failure. */
async function failApproval(buttonName: RegExp, error: Error) {
  vi.mocked(initiateM365OrgApproval).mockRejectedValueOnce(error);
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  return screen.findByTestId('m365-org-approval-error');
}

describe('AC-M365LOC-006 — M365OrgApprovalCard is localized (en/id) and code-driven', () => {
  it('AC-M365LOC-006: English shows the card copy, the approve action and no raw key', async () => {
    await renderLocalized('en');
    const card = screen.getByTestId('m365-org-approval');
    expect(card).toHaveTextContent('Organization approval');
    expect(card).toHaveTextContent(/approve the PMO Portal app for your organization/i);
    expect(screen.getByRole('button', { name: 'Approve in Microsoft 365' })).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/integrations\.[a-zA-Z0-9.]+/);
  });

  it('AC-M365LOC-006: Bahasa shows the localized card copy and approve action', async () => {
    await renderLocalized('id');
    const card = screen.getByTestId('m365-org-approval');
    expect(card).toHaveTextContent('Persetujuan organisasi');
    expect(card).toHaveTextContent(/setujui aplikasi PMO Portal untuk organisasi Anda/i);
    expect(screen.getByRole('button', { name: 'Setujui di Microsoft 365' })).toBeInTheDocument();
    // None of the English copy survives in the Bahasa render.
    expect(card.textContent).not.toMatch(/Organization approval|Approve in Microsoft 365/);
  });

  it('AC-M365LOC-006: with NO catalogue loaded the card still reads as English (defaults, never keys)', async () => {
    await renderLocalized('en', false);
    const card = screen.getByTestId('m365-org-approval');
    expect(card).toHaveTextContent('Organization approval');
    expect(screen.getByRole('button', { name: 'Approve in Microsoft 365' })).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/integrations\.[a-zA-Z0-9.]+/);
  });

  it('AC-M365LOC-006: a failure carrying a known code renders that code in Bahasa, never the server text', async () => {
    const { AppError } = await import('@/src/lib/appError');
    await renderLocalized('id');
    const alert = await failApproval(
      /setujui di microsoft 365/i,
      new AppError('raw server sentence that must not be echoed', 'FORBIDDEN'),
    );
    expect(alert).toHaveTextContent(readCatalogue('id').integrations.personalM365.errors.forbidden);
    expect(alert.textContent).not.toContain('raw server sentence');
    expect(alert.textContent).not.toContain('FORBIDDEN');
  });

  it('AC-M365LOC-006: every wire code the personal card knows renders its localized copy here too', async () => {
    const { AppError } = await import('@/src/lib/appError');
    const { M365_ERROR_CODES, knownM365ErrorReason } = await import('@/src/lib/m365/errorCopy');
    const { i18n } = await renderLocalized('id');
    for (const code of M365_ERROR_CODES) {
      const alert = await failApproval(/setujui di microsoft 365/i, new AppError('raw', code));
      expect(alert).toHaveTextContent(knownM365ErrorReason(i18n.t.bind(i18n), code)!);
    }
  });

  it('AC-M365LOC-006: an unknown or absent code shows the localized organization fallback, never the raw message', async () => {
    const { AppError } = await import('@/src/lib/appError');
    await renderLocalized('id');
    const unknown = await failApproval(
      /setujui di microsoft 365/i,
      new AppError('leaky backend detail', 'SOMETHING_NEW'),
    );
    expect(unknown).toHaveTextContent('Tidak dapat memulai persetujuan organisasi Microsoft 365.');
    expect(unknown.textContent).not.toContain('leaky backend detail');
    const plain = await failApproval(/setujui di microsoft 365/i, new Error('socket hang up'));
    expect(plain).toHaveTextContent('Tidak dapat memulai persetujuan organisasi Microsoft 365.');
    expect(plain.textContent).not.toContain('socket hang up');
  });

  it('AC-M365LOC-006: switching language re-renders a visible error in place (the code is stored, not the text)', async () => {
    const { AppError } = await import('@/src/lib/appError');
    const { i18n } = await renderLocalized('en');
    const alert = await failApproval(
      /approve in microsoft 365/i,
      new AppError('raw', 'FORBIDDEN'),
    );
    expect(alert).toHaveTextContent(/restricted to organization administrators/i);
    await act(async () => {
      await i18n.changeLanguage('id');
    });
    expect(screen.getByTestId('m365-org-approval-error')).toHaveTextContent(
      readCatalogue('id').integrations.personalM365.errors.forbidden,
    );
  });

  it('AC-M365LOC-008: the error line keeps its icon on the first wrapped line (390px)', async () => {
    const { AppError } = await import('@/src/lib/appError');
    await renderLocalized('en');
    const alert = await failApproval(/approve in microsoft 365/i, new AppError('raw', 'GRAPH_ERROR'));
    expect(alert.className).toContain('items-start');
    expect(alert.className).not.toContain('items-center');
    expect(alert.querySelector('svg')!.getAttribute('class')).toContain('mt-[3px]');
  });
});
