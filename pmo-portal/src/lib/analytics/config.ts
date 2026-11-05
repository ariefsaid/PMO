type EnvLike = {
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
  VITE_ANALYTICS_ENABLED?: string;
  VITE_DEMO_MODE?: string;
  VITE_APP_ENV?: string;
  DEV?: boolean;
  PROD?: boolean;
  MODE?: string;
};

export type DemoAudience = 'prospect' | 'internal';

export interface DemoContext {
  demoAudience: DemoAudience;
  demoAccount: string;
}

export interface AnalyticsConfig extends DemoContext {
  enabled: boolean;
  demoMode: boolean;
  replayAndAutocapture: boolean;
  posthogKey: string;
  posthogHost: string;
  appEnv: string;
  isProd: boolean;
}

const SESSION_AUDIENCE = 'pmo.demoAudience';
const SESSION_ACCOUNT = 'pmo.demoAccount';
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

const cleanSlug = (value: string | null): string | null => {
  const trimmed = (value ?? '').trim().toLowerCase();
  return SAFE_SLUG.test(trimmed) ? trimmed : null;
};

export function parseDemoContext(args: {
  search: string;
  isDev: boolean;
  demoMode: boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}): DemoContext {
  const fallback: DemoContext = args.isDev
    ? { demoAudience: 'internal', demoAccount: 'local' }
    : { demoAudience: 'prospect', demoAccount: 'default' };

  if (!args.demoMode) return fallback;

  const params = new URLSearchParams(args.search.startsWith('?') ? args.search.slice(1) : args.search);
  const da = cleanSlug(params.get('da'));
  const explicitAccount = cleanSlug(params.get('demo_account'));
  // Storage reads are best-effort: browsers that block storage access throw from the
  // read itself (private mode, embedded webviews). Degrade to the URL/in-memory
  // defaults instead of letting analytics setup interrupt the app — the same contract
  // the consent client applies to its localStorage opt-out flag.
  let storedAudience: DemoAudience | null = null;
  let storedAccount: string | null = null;
  try {
    storedAudience = (args.storage?.getItem(SESSION_AUDIENCE) as DemoAudience | null) ?? null;
    storedAccount = cleanSlug(args.storage?.getItem(SESSION_ACCOUNT) ?? null);
  } catch {
    /* storage blocked — fall through to the in-memory defaults */
  }

  let ctx = fallback;
  if (da === 'internal') ctx = { demoAudience: 'internal', demoAccount: explicitAccount ?? 'default' };
  else if (da === 'prospect') ctx = { demoAudience: 'prospect', demoAccount: explicitAccount ?? 'default' };
  else if (da) ctx = { demoAudience: 'prospect', demoAccount: explicitAccount ?? da };
  else if ((storedAudience === 'internal' || storedAudience === 'prospect') && storedAccount) {
    ctx = { demoAudience: storedAudience, demoAccount: storedAccount };
  } else if (explicitAccount) {
    ctx = { demoAudience: fallback.demoAudience, demoAccount: explicitAccount };
  }

  return ctx;
}

export function persistDemoContext(
  ctx: DemoContext,
  storage?: Pick<Storage, 'setItem'>,
): void {
  // Best-effort write: blocked or quota-exceeded storage must not crash the provider's
  // persistence effect — the context still applies for this session in memory.
  try {
    storage?.setItem(SESSION_AUDIENCE, ctx.demoAudience);
    storage?.setItem(SESSION_ACCOUNT, ctx.demoAccount);
  } catch {
    /* storage unavailable — nothing to persist, carry on */
  }
}

/**
 * Obtain `sessionStorage` without letting a BLOCKED browser throw: merely touching
 * `window.sessionStorage` raises SecurityError in browsers that deny storage access
 * (private mode, embedded webviews). Returns undefined there and callers fall back to
 * the in-memory demo defaults — the same contract `readOptOut` applies to localStorage.
 */
export function safeSessionStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined; // storage access blocked entirely
  }
}

/**
 * A usable PostHog project key is `phc_` + base62. Guarding on this stops the SDK
 * from initialising against a placeholder/empty/malformed key and spamming the
 * console with 401s from the ingestion endpoint (real defect 2026-06-16: the demo
 * deploy carried an invalid key → repeated 401s on us.i.posthog.com). A real key
 * unlocks analytics as before; anything else disables it cleanly.
 */
export const isValidPosthogKey = (key: string | undefined): boolean =>
  /^phc_[A-Za-z0-9]{20,}$/.test((key ?? '').trim());

export function getAnalyticsConfig(
  env: EnvLike = import.meta.env,
  search = typeof window === 'undefined' ? '' : window.location.search,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeSessionStorage()
): AnalyticsConfig {
  const demoMode = env.VITE_DEMO_MODE === 'true';
  const analyticsEnabled = env.VITE_ANALYTICS_ENABLED === 'true';
  // A missing/invalid PostHog key fully disables analytics — no init, no 401 noise —
  // regardless of demo/analytics flags. A valid `phc_` key re-enables it transparently.
  const enabled = (demoMode || analyticsEnabled) && isValidPosthogKey(env.VITE_POSTHOG_KEY);
  const isDev = env.DEV === true;
  const isProd = env.PROD === true;
  const demo = parseDemoContext({ search, isDev, demoMode, storage });

  return {
    enabled,
    demoMode,
    replayAndAutocapture: demoMode && !isDev && demo.demoAudience === 'prospect',
    posthogKey: isValidPosthogKey(env.VITE_POSTHOG_KEY) ? env.VITE_POSTHOG_KEY!.trim() : '',
    posthogHost: env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    appEnv: env.VITE_APP_ENV || env.MODE || (isDev ? 'local' : 'prod'),
    isProd,
    ...demo,
  };
}
