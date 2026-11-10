// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInstance } from 'i18next';
import { initReactI18next, I18nextProvider, useTranslation } from 'react-i18next';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { catalogueBackend, createParseMissingKeyHandler, i18nInitOptions } from './index';

/**
 * #2097 — the rendered half of "a feature catalogue nobody declared still renders, in the right
 * language, and never as a raw key".
 *
 * i18next boots with `common` alone. A component that reaches a feature key through a BARE
 * `useTranslation()` — `t('crm:companies.title', 'Companies')` — therefore misses on its first
 * paint. It must show the English source string (FR-L10N-041), request `crm`, and then resolve to
 * the active language's text once that catalogue lands (which needs `bindI18n: '… loaded'`).
 */

const CATALOGUES: Record<string, object> = {
  '/locales/id/common.json': { shell: { greeting: 'Halo' } },
  '/locales/en/common.json': { shell: { greeting: 'Hello' } },
  '/locales/id/crm.json': { companies: { title: 'Perusahaan' } },
  '/locales/en/crm.json': { companies: { title: 'Companies' } },
};

function FeatureScreen() {
  const { t } = useTranslation();
  return (
    <p>
      {t('crm:companies.title', 'Companies')} / {t('shell.greeting', 'Hello')}
    </p>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('#2097: a route renders through an on-demand catalogue, never a raw key', () => {
  it('an Indonesian session shows the English source string first, then the Indonesian text', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = CATALOGUES[url];
      return { ok: Boolean(body), status: body ? 200 : 404, json: () => Promise.resolve(body ?? {}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const instance = createInstance();
    await instance
      .use(catalogueBackend)
      .use(initReactI18next)
      .init(i18nInitOptions('id', instance));

    render(
      <I18nextProvider i18n={instance}>
        <FeatureScreen />
      </I18nextProvider>,
    );

    // First paint: `common` may still be in flight, so the call site's English source string is
    // what shows — never `crm:companies.title`, never `companies.title`.
    const first = screen.getByText(/Companies|Perusahaan/).textContent ?? '';
    expect(first).not.toContain('crm:');
    expect(first).not.toContain('companies.title');

    // The miss requested `crm` on its own, and the arriving catalogue re-rendered the subtree into
    // Indonesian (`bindI18n: 'languageChanged loaded'`).
    await waitFor(() => expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/locales/id/crm.json'));
    await waitFor(() => expect(screen.getByText(/^Perusahaan/)).toBeInTheDocument());

    // The boot fetch was the ACTIVE language first — not English-then-switch.
    expect(fetchMock.mock.calls[0][0]).toBe('/locales/id/common.json');
    instance.removeResourceBundle('id', 'crm');
    instance.removeResourceBundle('en', 'crm');
    expect(createParseMissingKeyHandler(instance)('crm:unlisted.key')).toBe('unlisted.key');
  });
});
