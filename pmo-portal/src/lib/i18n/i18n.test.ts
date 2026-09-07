// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import i18next from 'i18next';
import { catalogueBackend, parseMissingKeyHandler, initI18n, DEFAULT_NS } from './index';

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

describe('init config', () => {
  it('boots in English and takes its language from resolveLocale, never a detector', async () => {
    // FR-L10N-003 is binding: no navigator.language, no localStorage, no detector plugin. Before
    // the profile resolves the language is 'en'; I18nProvider re-sets it when the profile lands.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    const i18n = await initI18n();
    expect(i18n.language).toBe('en');
    expect(i18n.options.fallbackLng).toEqual(['en']);
    expect(i18n.options.returnEmptyString).toBe(false);
    vi.unstubAllGlobals();
  });

  it('initI18n is idempotent — one instance, not one per caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    expect(await initI18n()).toBe(await initI18n());
    vi.unstubAllGlobals();
  });
});
