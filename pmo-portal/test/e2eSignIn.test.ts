import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const signInMocks = vi.hoisted(() => {
  const appBaseURL = 'http://app.example';
  const rootUrlAssertions = vi.fn(async (page: { url: () => string }, expected: RegExp) => {
    if (!expected.test(page.url())) {
      throw new Error(`expected ${page.url()} to match ${expected}`);
    }
  });
  const playwrightExpect = vi.fn((page: { url: () => string }) => ({
    toHaveURL: (expected: RegExp) => rootUrlAssertions(page, expected),
  }));

  return { appBaseURL, rootUrlAssertions, playwrightExpect };
});

vi.mock('@playwright/test', () => ({
  expect: signInMocks.playwrightExpect,
  test: { info: () => ({ project: { use: { baseURL: signInMocks.appBaseURL } } }) },
  request: { newContext: vi.fn() },
}));

import { AUTH_DIR, signIn } from '../e2e/helpers';

type StorageItem = { name: string; value: string };
type FakeRequest = {
  isNavigationRequest: () => boolean;
  frame: () => object;
  url: () => string;
};
type FakeRoute = {
  request: () => FakeRequest;
  fulfill: (options: { status?: number; contentType?: string; body?: string }) => Promise<void>;
  continue: () => Promise<void>;
};
type RouteEntry = {
  matches: (url: URL) => boolean;
  handle: (route: FakeRoute) => Promise<void>;
};

const ALPHA_EMAIL = 'actor-alpha@example.test';
const BETA_EMAIL = 'actor-beta@example.test';
const ORIGIN = signInMocks.appBaseURL;

function setFixture(email: string, items: StorageItem[]) {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(
    join(AUTH_DIR, `${email}.json`),
    JSON.stringify({ origins: [{ origin: ORIGIN, localStorage: items }] }),
    'utf8',
  );
}

function createPage(initialUrl = 'about:blank') {
  const localStorage = new Map<string, string>();
  const routes: RouteEntry[] = [];
  const mainFrame = {};
  const state = {
    url: initialUrl,
    appNavigations: 0,
    bootstrapNavigations: 0,
    storageClears: 0,
    routeHandlerCalls: 0,
    failNextBootstrapNavigation: false,
    routeMatchers: [] as ((url: URL) => boolean)[],
    navigationPaths: [] as string[],
    appStorageAtNavigation: [] as Record<string, string>[],
  };

  const page = {
    url: () => state.url,
    mainFrame: () => mainFrame,
    route: vi.fn(async (matcher: unknown, handler: unknown) => {
      const matches = matcher as (url: URL) => boolean;
      state.routeMatchers.push(matches);
      routes.push({
        matches,
        handle: handler as (route: FakeRoute) => Promise<void>,
      });
    }),
    unroute: vi.fn(async (matcher: unknown, handler: unknown) => {
      const matches = matcher as (url: URL) => boolean;
      const handle = handler as (route: FakeRoute) => Promise<void>;
      const index = routes.findIndex((entry) => entry.matches === matches && entry.handle === handle);
      if (index >= 0) routes.splice(index, 1);
    }),
    goto: vi.fn(async (path: string) => {
      if (state.failNextBootstrapNavigation) {
        state.failNextBootstrapNavigation = false;
        throw new Error('bootstrap navigation failed');
      }

      const target = new URL(path, ORIGIN);
      const routeEntry = routes.find((entry) => entry.matches(target));
      let fulfilled = false;

      if (routeEntry) {
        state.routeHandlerCalls += 1;
        await routeEntry.handle({
          request: () => ({
            isNavigationRequest: () => true,
            frame: () => mainFrame,
            url: () => target.href,
          }),
          fulfill: async () => {
            fulfilled = true;
            state.bootstrapNavigations += 1;
          },
          continue: async () => undefined,
        });
      }

      state.url = target.href;
      state.navigationPaths.push(target.pathname);
      if (!fulfilled) {
        state.appNavigations += 1;
        state.appStorageAtNavigation.push(Object.fromEntries(localStorage));
      }
    }),
    evaluate: vi.fn(async (callback: unknown, argument: unknown) => {
      const storageApi = {
        clear: () => {
          state.storageClears += 1;
          localStorage.clear();
        },
        setItem: (name: string, value: string) => localStorage.set(name, value),
      };
      const priorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: storageApi,
      });
      try {
        await (callback as (value: unknown) => unknown)(argument);
      } finally {
        if (priorDescriptor) Object.defineProperty(globalThis, 'localStorage', priorDescriptor);
        else Reflect.deleteProperty(globalThis, 'localStorage');
      }
    }),
  };

  return {
    page: page as unknown as Parameters<typeof signIn>[0],
    localStorage,
    routes,
    state,
  };
}

afterEach(() => {
  for (const email of [ALPHA_EMAIL, BETA_EMAIL]) {
    rmSync(join(AUTH_DIR, `${email}.json`), { force: true });
  }
  vi.clearAllMocks();
});

describe('e2e signIn fixture bootstrap', () => {
  it('uses a temporary empty origin document before the authenticated root navigation', async () => {
    setFixture(ALPHA_EMAIL, [{ name: 'session-marker', value: 'fixture-alpha-session' }]);
    const browser = createPage();

    await signIn(browser.page, ALPHA_EMAIL);

    expect(browser.state.bootstrapNavigations).toBe(1);
    expect(browser.state.appNavigations).toBe(1);
    expect(browser.state.appStorageAtNavigation).toEqual([
      { 'session-marker': 'fixture-alpha-session' },
    ]);
    expect(browser.state.navigationPaths).toEqual(['/','/']);
    expect(browser.routes).toHaveLength(0);
    expect(browser.page.unroute).toHaveBeenCalledTimes(1);
    expect(signInMocks.rootUrlAssertions).toHaveBeenLastCalledWith(browser.page, /\/$/);

    await browser.page.goto('/projects');

    expect(browser.state.navigationPaths).toEqual(['/','/','/projects']);
    expect(browser.state.routeHandlerCalls).toBe(1);
    expect(browser.state.appNavigations).toBe(2);
  });

  it('removes the temporary route when the bootstrap navigation rejects', async () => {
    setFixture(ALPHA_EMAIL, [{ name: 'session-marker', value: 'fixture-alpha-session' }]);
    const browser = createPage();
    browser.state.failNextBootstrapNavigation = true;

    await expect(signIn(browser.page, ALPHA_EMAIL)).rejects.toThrow('bootstrap navigation failed');

    expect(browser.state.navigationPaths).toEqual([]);
    expect(browser.state.appNavigations).toBe(0);
    expect(browser.state.appStorageAtNavigation).toHaveLength(0);
    expect(browser.page.goto).toHaveBeenCalledTimes(1);
    expect(browser.page.evaluate).not.toHaveBeenCalled();
    expect(browser.page.unroute).toHaveBeenCalledTimes(1);
    expect(browser.routes).toHaveLength(0);

    await browser.page.goto('/projects');

    expect(browser.state.routeHandlerCalls).toBe(0);
    expect(browser.state.navigationPaths).toEqual(['/projects']);
    expect(browser.state.appNavigations).toBe(1);
  });

  it('limits the temporary root route to the configured application origin', async () => {
    setFixture(ALPHA_EMAIL, [{ name: 'session-marker', value: 'fixture-alpha-session' }]);
    const browser = createPage();

    await signIn(browser.page, ALPHA_EMAIL);

    const rootMatcher = browser.state.routeMatchers[0];
    expect(rootMatcher(new URL(`${ORIGIN}/`))).toBe(true);
    expect(rootMatcher(new URL('https://foreign.example/'))).toBe(false);
    expect(browser.routes).toHaveLength(0);
  });

  it('replaces the captured actor storage without clearing later navigation state', async () => {
    setFixture(ALPHA_EMAIL, [{ name: 'session-marker', value: 'fixture-alpha-session' }]);
    setFixture(BETA_EMAIL, [
      { name: 'session-marker', value: 'fixture-beta-session' },
      { name: 'actor-profile', value: 'fixture-beta-profile' },
    ]);
    const browser = createPage();

    await signIn(browser.page, ALPHA_EMAIL);
    browser.localStorage.set('stale-identity-key', 'fixture-alpha-only');
    await signIn(browser.page, BETA_EMAIL);

    expect(browser.state.storageClears).toBe(2);
    expect(Object.fromEntries(browser.localStorage)).toEqual({
      'session-marker': 'fixture-beta-session',
      'actor-profile': 'fixture-beta-profile',
    });
    expect(browser.state.bootstrapNavigations).toBe(1);
    expect(browser.state.appNavigations).toBe(2);
    expect(browser.state.appStorageAtNavigation.at(-1)).toEqual({
      'session-marker': 'fixture-beta-session',
      'actor-profile': 'fixture-beta-profile',
    });
    expect(signInMocks.rootUrlAssertions).toHaveBeenCalledTimes(2);
    expect(signInMocks.rootUrlAssertions.mock.calls.map(([, pattern]) => pattern)).toEqual([
      /\/$/,
      /\/$/,
    ]);

    await browser.page.goto('/settings');

    expect(browser.state.navigationPaths).toEqual(['/','/','/','/settings']);
    expect(browser.state.routeHandlerCalls).toBe(1);
    expect(browser.state.appNavigations).toBe(3);
    expect(browser.state.appStorageAtNavigation.at(-1)).toEqual({
      'session-marker': 'fixture-beta-session',
      'actor-profile': 'fixture-beta-profile',
    });
  });
});
