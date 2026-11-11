// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import i18next from 'i18next';
import { catalogueBackend, parseMissingKeyHandler, initI18n, DEFAULT_NS, NAMESPACES } from './index';

describe('FR-L10N-043: lazy per-locale catalogue load', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ greeting: 'Hello' }) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads a catalogue over the network from public/locales — never from the bundle', () => {
    // `public/` is copied verbatim by Vite, so adding a language must not grow the `en` bundle by a
    // byte. A static `import`/`resources` block would; this fetch cannot.
    const cb = vi.fn();
    catalogueBackend.read!('en', 'common', cb);
    expect(fetchMock).toHaveBeenCalledWith('/locales/en/common.json');
  });

  it('loads any feature namespace lazily from the public locale path', () => {
    const cb = vi.fn();
    catalogueBackend.read!('en', 'billingFeature', cb);
    expect(fetchMock).toHaveBeenCalledWith('/locales/en/billingFeature.json');
  });

  it('AC-L10N-043: an en session requests no id catalogue', () => {
    const cb = vi.fn();
    catalogueBackend.read!('en', 'common', cb);
    const requested = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(requested.some((u) => u.includes('/id/'))).toBe(false);
  });

  it('a 404 degrades to the English fallback rather than throwing', async () => {
    // A missing catalogue must not white-screen the app: it reports to i18next, which then falls
    // back per FR-L10N-041.
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });
    const cb = vi.fn();
    catalogueBackend.read!('id', 'common', cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalled());
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(cb.mock.calls[0][1]).toBe(false);
  });
});

describe('FR-L10N-041 / AC-L10N-040: a missing key never renders as a raw key', () => {
  it('renders the English source string the call site supplied', () => {
    // ⛔ The failure this guards is a client being shown `project.header.title`. i18next's DEFAULT
    // behaviour is exactly that — returning the key — so this handler is not decoration.
    expect(parseMissingKeyHandler('project.header.title', 'Project overview')).toBe(
      'Project overview',
    );
  });

  it('falls back to the en catalogue entry when the call site passed no default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    await initI18n();
    i18next.addResource('en', DEFAULT_NS, 'orphan.key', 'English from the catalogue');
    expect(parseMissingKeyHandler('orphan.key')).toBe('English from the catalogue');
    vi.unstubAllGlobals();
  });

  it('⛔ does not throw when reached BEFORE init (a missing key must never white-screen)', () => {
    // The guard this pins was a real crash: `getResource` is absent on an uninitialised instance,
    // so the pre-init path threw a TypeError out of render. Remove the `typeof` guard in index.ts
    // and this goes red — but ONLY if it runs before init, which is why it asserts the key path
    // rather than a catalogue hit.
    expect(() => parseMissingKeyHandler('never.registered.key')).not.toThrow();
    expect(parseMissingKeyHandler('never.registered.key', 'Fallback text')).toBe('Fallback text');
  });

  it('treats an empty string as missing, not as a deliberate blank', () => {
    // `returnEmptyString: false` plus this branch: an untranslated key in a partly-filled catalogue
    // must render its English text, not collapse to nothing on screen.
    expect(parseMissingKeyHandler('some.key', '')).not.toBe('');
  });
});

describe('feature namespaces', () => {
  it('registers the CRM catalogue for lazy loading', () => {
    expect(NAMESPACES).toContain('crm');
  });
  it('registers the finance hub catalogue for lazy loading', () => {
    expect(NAMESPACES).toContain('financeHub');
  });

  it('AC-1070-002: loads an unlisted namespace through the shipped backend in EN and ID', async () => {
    const { createInstance } = await import('i18next');
    const { initReactI18next, I18nextProvider, useTranslation } = await import('react-i18next');
    const { render, screen, waitFor } = await import('@testing-library/react');
    const React = await import('react');
    const runtimeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const catalogues: Record<string, object> = {
        '/locales/en/common.json': { shared: 'Shared English' },
        '/locales/en/runtimeFeature.json': { title: 'English feature' },
        '/locales/id/common.json': { shared: 'Bersama' },
        '/locales/id/runtimeFeature.json': { title: 'Fitur Indonesia' },
      };
      return { ok: Boolean(catalogues[url]), json: () => Promise.resolve(catalogues[url] ?? {}) };
    });
    vi.stubGlobal('fetch', runtimeFetch);
    const instance = createInstance();
    await instance.use(catalogueBackend).use(initReactI18next).init({
      lng: 'en', fallbackLng: 'en', fallbackNS: 'common', defaultNS: 'common',
      ns: ['common'], partialBundledLanguages: true,
      react: { useSuspense: false },
    });
    const Feature = () => {
      const { t } = useTranslation('runtimeFeature');
      return React.createElement('p', null, `${t('title')} / ${t('shared')}`);
    };
    const view = render(React.createElement(I18nextProvider, { i18n: instance }, React.createElement(Feature)));
    await waitFor(() => expect(screen.getByText('English feature / Shared English')).toBeInTheDocument());
    await instance.changeLanguage('id');
    view.rerender(React.createElement(I18nextProvider, { i18n: instance }, React.createElement(Feature)));
    await waitFor(() => expect(screen.getByText('Fitur Indonesia / Bersama')).toBeInTheDocument());
    expect(runtimeFetch).toHaveBeenCalledWith('/locales/en/runtimeFeature.json');
    expect(runtimeFetch).toHaveBeenCalledWith('/locales/id/runtimeFeature.json');
    view.unmount();
  });

  it('AC-1070-001: resolves feature keys in English and Indonesian with common fallback', async () => {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    const { createInstance } = await import('i18next');
    const { initReactI18next, I18nextProvider, useTranslation } = await import('react-i18next');
    const { render, screen } = await import('@testing-library/react');
    const React = await import('react');
    const instance = createInstance();
    await instance.use(initReactI18next).init({
      lng: 'en', fallbackLng: 'en', fallbackNS: 'common', defaultNS: 'common',
      ns: ['common', 'localeSlice'],
      resources: {
        en: { common: { shared: 'Shared English' }, localeSlice: { title: 'English feature' } },
        id: { common: { shared: 'Bersama' }, localeSlice: { title: 'Fitur Indonesia' } },
      },
      initImmediate: false,
    });
    const Feature = () => {
      const { t } = useTranslation('localeSlice');
      return React.createElement('p', null, `${t('title')} / ${t('shared')}`);
    };
    const { rerender } = render(React.createElement(I18nextProvider, { i18n: instance }, React.createElement(Feature)));
    expect(screen.getByText('English feature / Shared English')).toBeInTheDocument();
    await instance.changeLanguage('id');
    rerender(React.createElement(I18nextProvider, { i18n: instance }, React.createElement(Feature)));
    expect(screen.getByText('Fitur Indonesia / Bersama')).toBeInTheDocument();
  });
});

describe('#2097: only `common` is resident at boot; feature namespaces arrive on demand', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /**
   * An ISOLATED instance running the SHIPPED init options (`i18nInitOptions`). The shared singleton
   * is pre-initialised by `test/setup.ts` with empty resources, which makes every namespace report
   * as loaded — a boot assertion made against it would prove nothing.
   */
  async function isolatedBoot(locale = 'en') {
    const { createInstance } = await import('i18next');
    const { initReactI18next } = await import('react-i18next');
    vi.resetModules();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const catalogues: Record<string, object> = {
        '/locales/en/common.json': { shell: { nav: { projects: 'Projects' } } },
        '/locales/id/common.json': { shell: { nav: { projects: 'Proyek' } } },
        '/locales/en/crm.json': { companies: { title: 'Companies' } },
        '/locales/id/crm.json': { companies: { title: 'Perusahaan' } },
      };
      return { ok: Boolean(catalogues[url]), status: catalogues[url] ? 200 : 404, json: () => Promise.resolve(catalogues[url] ?? {}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const mod = await import('./index');
    const instance = createInstance();
    await instance.use(mod.catalogueBackend).use(initReactI18next).init(mod.i18nInitOptions(locale));
    return {
      mod,
      instance,
      urls: () => fetchMock.mock.calls.map((c) => String(c[0])),
    };
  }

  it('AC: a cold boot requests ONE namespace catalogue, not all 32', async () => {
    const { mod, instance, urls } = await isolatedBoot();
    expect(instance.options.ns).toEqual(['common']);
    expect(mod.BOOT_NAMESPACES).toEqual(['common']);
    // Every other catalogue is still registered for on-demand loading (it is what the route
    // preload rules and `useTranslation('<ns>')` name), but nothing fetches it at boot.
    expect(mod.NAMESPACES.length).toBeGreaterThan(30);
    expect(urls()).toEqual(['/locales/en/common.json']);
  });

  it('AC: a resolved Indonesian locale boots Indonesian FIRST — no English set up front', async () => {
    const { instance, urls } = await isolatedBoot('id');
    expect(instance.language).toBe('id');
    const requested = urls();
    expect(requested[0]).toBe('/locales/id/common.json');
    // `fallbackLng: 'en'` still fetches the English OTHER LANGUAGE of the one namespace that is
    // resident (that is the FR-L10N-041 fallback), but never a feature catalogue.
    expect(requested.sort()).toEqual(['/locales/en/common.json', '/locales/id/common.json']);
  });

  it('an unusable boot locale falls back to English instead of asking for a bogus catalogue', async () => {
    const { instance, urls } = await isolatedBoot('en_US');
    expect(instance.language).toBe('en');
    expect(urls().every((u) => u.startsWith('/locales/en/'))).toBe(true);
  });

  it('a miss in a feature namespace loads that catalogue on demand (no call-site opt-in)', async () => {
    const { mod, instance, urls } = await isolatedBoot('id');
    const handler = mod.createParseMissingKeyHandler(instance);
    // The handler's job is only the no-raw-key backstop; it reads the ENGLISH catalogue.
    expect(handler('crm:companies.title')).not.toContain('crm:');
    // The miss itself requests the namespace nobody declared...
    await vi.waitFor(() => expect(urls()).toContain('/locales/id/crm.json'));
    // ...and from then on `t()` resolves it in the ACTIVE language (this is what a route renders
    // after the catalogue lands, which `bindI18n: 'languageChanged loaded'` re-renders).
    await vi.waitFor(() => expect(instance.t('crm:companies.title')).toBe('Perusahaan'));
    expect(handler('crm:companies.title')).toBe('Companies');
  });

  it('resolves the English catalogue entry for the key OWN namespace, not just common', async () => {
    const { mod, instance } = await isolatedBoot();
    const handler = mod.createParseMissingKeyHandler(instance);
    instance.addResource('en', 'crm', 'companies.title', 'Companies');
    expect(handler('crm:companies.title')).toBe('Companies');
    // ...and the call site's own default still wins, as before (FR-L10N-041).
    expect(handler('crm:companies.title', 'Supplier list')).toBe('Supplier list');
  });

  it('⛔ a namespaced miss with no default never renders the namespace prefix on screen', () => {
    expect(parseMissingKeyHandler('crm:neverInAnyCatalogue')).toBe('neverInAnyCatalogue');
    expect(parseMissingKeyHandler('crm:neverInAnyCatalogue')).not.toContain(':');
  });
});

describe('init config', () => {
  it('boots in English and takes its language from resolveLocale, never a detector', async () => {
    // FR-L10N-003 is binding: no navigator.language, no localStorage, no detector plugin. Before
    // the profile resolves the language is 'en'; I18nProvider re-sets it when the profile lands.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    const i18n = await initI18n();
    expect(i18n.language).toBe('en');
    expect(i18n.options.fallbackLng).toEqual(['en']);
    expect(i18n.options.fallbackNS).toEqual(['common']);
    expect(i18n.options.returnEmptyString).toBe(false);
    // A catalogue arriving after the first paint must re-render its subscribers — with only
    // `common` resident, an on-demand namespace lands mid-session.
    expect(i18n.options.react?.bindI18n).toContain('loaded');
    expect(i18n.options.appendNamespaceToMissingKey).toBe(true);
    vi.unstubAllGlobals();
  });

  it('initI18n is idempotent — one instance, not one per caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    expect(await initI18n()).toBe(await initI18n());
    vi.unstubAllGlobals();
  });
});
