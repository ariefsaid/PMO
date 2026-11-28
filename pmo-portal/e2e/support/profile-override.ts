// @e2e-isolation: read-only — rewrites the signed-in profile in the responses the page reads; nothing is written.
import type { Page } from '@playwright/test';

/**
 * The ONE place an e2e test rewrites the signed-in profile (language, number format, timezone).
 *
 * The shell reads the profile two ways: the start-up call `rpc/shell_bootstrap` (its `profile` section; the
 * normal path) and the plain `profiles` REST read (the fallback when the start-up call fails, and any other
 * profile read). A test that pins only one of them leaves the other to win, so this rewrites BOTH, and every
 * test that pins a profile uses it. Read-only and parallel-safe: no profile row is written.
 */
export type ProfilePatch = Record<string, unknown>;

/** A fixed patch, or a function read on every response (a journey that switches language mid-test). */
export type ProfilePatchSource = ProfilePatch | (() => ProfilePatch);

const LOCALE_FORMAT = { en: 'en-US', id: 'id-ID' } as const;

/** `locale` plus its matching `number_locale` — the pair every language pin needs. */
export function localePatch(locale: 'en' | 'id'): ProfilePatch {
  return { locale, number_locale: LOCALE_FORMAT[locale] };
}

const resolve = (source: ProfilePatchSource): ProfilePatch => (typeof source === 'function' ? source() : source);

const isRow = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export async function overrideProfile(page: Page, source: ProfilePatchSource): Promise<void> {
  // 1. The plain profile read(s).
  await page.route('**/rest/v1/profiles?*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    const patch = resolve(source);
    const apply = (row: unknown) => (isRow(row) && 'locale' in row ? { ...row, ...patch } : row);
    return route.fulfill({ response, json: Array.isArray(body) ? body.map(apply) : apply(body) });
  });

  // 2. The start-up call: the profile arrives as its `profile` section.
  await page.route('**/rest/v1/rpc/shell_bootstrap*', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    if (isRow(body) && isRow(body.profile)) {
      return route.fulfill({ response, json: { ...body, profile: { ...body.profile, ...resolve(source) } } });
    }
    return route.fulfill({ response, json: body });
  });
}
