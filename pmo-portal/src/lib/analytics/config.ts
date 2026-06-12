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
  analyticsEnabled: boolean;
  replayAndAutocapture: boolean;
  posthogKey: string;
  posthogHost: string;
  appEnv: string;
  isDev: boolean;
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
  const storedAudience = args.storage?.getItem(SESSION_AUDIENCE) as DemoAudience | null;
  const storedAccount = cleanSlug(args.storage?.getItem(SESSION_ACCOUNT) ?? null);

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
  storage: Pick<Storage, 'setItem'>,
): void {
  storage.setItem(SESSION_AUDIENCE, ctx.demoAudience);
  storage.setItem(SESSION_ACCOUNT, ctx.demoAccount);
}

export function getAnalyticsConfig(
  env: EnvLike = import.meta.env,
  search = typeof window === 'undefined' ? '' : window.location.search,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof window === 'undefined' ? undefined : window.sessionStorage
): AnalyticsConfig {
  const demoMode = env.VITE_DEMO_MODE === 'true';
  const analyticsEnabled = env.VITE_ANALYTICS_ENABLED === 'true';
  const enabled = demoMode || analyticsEnabled;
  const isDev = env.DEV === true;
  const isProd = env.PROD === true;
  const demo = parseDemoContext({ search, isDev, demoMode, storage });

  return {
    enabled,
    demoMode,
    analyticsEnabled,
    replayAndAutocapture: demoMode && !isDev && demo.demoAudience === 'prospect',
    posthogKey: env.VITE_POSTHOG_KEY ?? '',
    posthogHost: env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    appEnv: env.VITE_APP_ENV || env.MODE || (isDev ? 'local' : 'prod'),
    isDev,
    isProd,
    ...demo,
  };
}
