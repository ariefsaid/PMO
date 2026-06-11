# PostHog Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/specs/posthog-instrumentation.spec.md`: a free-tier-compatible PostHog
analytics foundation plus deployed-prospect demo replay and limited click autocapture.

**Architecture:** Keep PostHog behind `src/lib/analytics/*`. The app emits safe typed events through
the local facade; only `src/lib/analytics/client.ts` imports `posthog-js`. Analytics initializes for
`VITE_DEMO_MODE=true || VITE_ANALYTICS_ENABLED=true`, but replay/autocapture only runs for deployed
prospect demo sessions.

**Tech Stack:** React 19, Vite 6, TypeScript 5.8, Vitest/RTL, `posthog-js`, React Router.

**Sources:** Spec `docs/specs/posthog-instrumentation.spec.md`; ADR-0022; PostHog JS config docs
(`disable_session_recording`, `property_denylist`, `before_send`), session replay privacy controls
(`maskAllInputs`, `ph-no-capture`, URL redaction), and autocapture config (`dom_event_allowlist`,
`element_allowlist`, `capture_copied_text`).

---

## Scope And Non-Negotiables

- Build first slice only. Do not build dashboards, heatmaps, feature flags, surveys, error tracking,
  logs/tracing, reverse proxy, self-hosting, or B2B multi-tenancy.
- Do not use paid PostHog Group Analytics in this slice. Register `org_id` as event context only.
- No component may import `posthog-js` directly.
- No event may send email, names, raw UUID paths, query strings, project/company/procurement names,
  monetary values, notes/comments, file names/content, network bodies/headers, or auth tokens.
- Replay/autocapture gate:

```ts
const replayAndAutocapture =
  env.VITE_DEMO_MODE === 'true' &&
  env.DEV !== true &&
  demoAudience === 'prospect';
```

## File Map

Create:
- `pmo-portal/src/lib/analytics/config.ts` — parse env + `da`/`demo_account`; expose mode flags.
- `pmo-portal/src/lib/analytics/events.ts` — typed events, safe property contracts, sanitizer.
- `pmo-portal/src/lib/analytics/route.ts` — map raw paths to safe route/module metadata.
- `pmo-portal/src/lib/analytics/client.ts` — sole `posthog-js` SDK boundary.
- `pmo-portal/src/lib/analytics/AnalyticsProvider.tsx` — init, identity sync, route tracking.
- `pmo-portal/src/lib/analytics/index.ts` — public analytics facade exports.
- `pmo-portal/src/lib/analytics/*.test.ts(x)` — unit coverage for config/events/client/provider/route.
- `docs/analytics-events.md` — developer guide for adding events safely.

Modify:
- `pmo-portal/package.json` / `package-lock.json` — add `posthog-js`.
- `pmo-portal/src/vite-env.d.ts` — add PostHog/demo env declarations.
- `pmo-portal/vite.config.ts` — add hermetic test env defaults for analytics vars.
- `pmo-portal/.env.example` — document PostHog env vars.
- `docs/environments.md` — document CF Pages demo env vars.
- `pmo-portal/App.tsx` — mount `AnalyticsProvider`.
- `pmo-portal/src/auth/LoginPage.tsx` — demo persona/login success/failure events.
- `pmo-portal/src/auth/LoginPage.test.tsx` — assert safe demo/login events.

## Traceability

| AC | Owning Layer | Owning Test / Check |
|---|---|---|
| AC-PH-001 | Unit | `config.test.ts` + `client.test.ts`: disabled no-op |
| AC-PH-002 | Unit | `client.test.ts`: init once when enabled |
| AC-PH-003 | Unit | `client.test.ts`: host from config |
| AC-PH-004 | Unit | `client.test.ts`: analytics mode disables replay/autocapture |
| AC-PH-005 | Unit | `client.test.ts`: deployed prospect demo enables replay + click-only autocapture |
| AC-PH-006 | Unit | `client.test.ts`: local/internal demo disables replay/autocapture |
| AC-PH-007 | Unit | `config.test.ts`: `?da=comp1` → prospect/comp1 sessionStorage |
| AC-PH-008 | Unit | `config.test.ts`: deployed/local defaults |
| AC-PH-009 | Unit | `AnalyticsProvider.test.tsx`: identify + register org context, no PII |
| AC-PH-010 | Unit | `AnalyticsProvider.test.tsx`: reset on sign-out |
| AC-PH-011 | Unit | `route.test.ts` + provider route capture |
| AC-PH-012 | Unit | `LoginPage.test.tsx`: persona event no email |
| AC-PH-013 | Unit | `events.test.ts`: failed-action helpers send only safe metadata |
| AC-PH-014 | Unit | `events.test.ts`: forbidden properties blocked |
| AC-PH-015 | Typecheck | `events.ts` event-name union; `npm run typecheck` |
| AC-PH-016 | Static check | `rg "from 'posthog-js'|from \"posthog-js\"" pmo-portal` |

No pgTAP/e2e required: this is client instrumentation only, with no DB/RLS change and no user-visible
behavior change.

---

## Task 1 — Add Dependency And Env Declarations

**Files:**
- Modify: `pmo-portal/package.json`
- Modify: `pmo-portal/package-lock.json`
- Modify: `pmo-portal/src/vite-env.d.ts`
- Modify: `pmo-portal/vite.config.ts`
- Modify: `pmo-portal/.env.example`

- [ ] **Step 1: Install dependency**

Run from `pmo-portal/`:

```bash
npm install posthog-js
```

Expected: `package.json` and `package-lock.json` add `posthog-js`.

- [ ] **Step 2: Add Vite env types**

Edit `pmo-portal/src/vite-env.d.ts` so `ImportMetaEnv` includes:

```ts
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_ANALYTICS_ENABLED?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_APP_ENV?: string;
```

- [ ] **Step 3: Add hermetic test env defaults**

In `pmo-portal/vite.config.ts` `test.env`, add:

```ts
      VITE_POSTHOG_KEY: '',
      VITE_POSTHOG_HOST: 'https://us.i.posthog.com',
      VITE_ANALYTICS_ENABLED: 'false',
      VITE_DEMO_MODE: 'false',
      VITE_APP_ENV: 'test',
```

- [ ] **Step 4: Document local env vars**

Append to `pmo-portal/.env.example`:

```dotenv

# PostHog analytics (public browser key; leave disabled locally unless testing instrumentation).
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_ANALYTICS_ENABLED=false
# Demo builds already use this to show seeded personas; analytics also initializes when true.
VITE_DEMO_MODE=false
VITE_APP_ENV=local
```

- [ ] **Step 5: Verify**

Run from `pmo-portal/`:

```bash
npm run typecheck
```

Expected: no new env typing errors.

---

## Task 2 — Config Parser (RED/GREEN)

**Files:**
- Create: `pmo-portal/src/lib/analytics/config.ts`
- Create: `pmo-portal/src/lib/analytics/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `config.test.ts` with these cases:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getAnalyticsConfig, parseDemoContext } from './config';

const baseEnv = {
  VITE_POSTHOG_KEY: 'ph_test',
  VITE_POSTHOG_HOST: 'https://us.i.posthog.com',
  VITE_ANALYTICS_ENABLED: 'false',
  VITE_DEMO_MODE: 'false',
  VITE_APP_ENV: 'test',
  DEV: false,
  PROD: false,
  MODE: 'test',
};

beforeEach(() => {
  sessionStorage.clear();
  vi.unstubAllEnvs();
});

describe('parseDemoContext', () => {
  it('AC-PH-007: ?da=comp1 becomes prospect/comp1 and persists for the session', () => {
    const ctx = parseDemoContext({
      search: '?da=comp1',
      isDev: false,
      demoMode: true,
      storage: sessionStorage,
    });
    expect(ctx).toEqual({ demoAudience: 'prospect', demoAccount: 'comp1' });
    expect(sessionStorage.getItem('pmo.demoAudience')).toBe('prospect');
    expect(sessionStorage.getItem('pmo.demoAccount')).toBe('comp1');
  });

  it('AC-PH-006: ?da=internal marks deployed internal testing', () => {
    expect(parseDemoContext({
      search: '?da=internal',
      isDev: false,
      demoMode: true,
      storage: sessionStorage,
    })).toEqual({ demoAudience: 'internal', demoAccount: 'default' });
  });

  it('AC-PH-008: no flag defaults deployed demo to prospect/default', () => {
    expect(parseDemoContext({
      search: '',
      isDev: false,
      demoMode: true,
      storage: sessionStorage,
    })).toEqual({ demoAudience: 'prospect', demoAccount: 'default' });
  });

  it('AC-PH-008: no flag defaults local dev to internal/local', () => {
    expect(parseDemoContext({
      search: '',
      isDev: true,
      demoMode: true,
      storage: sessionStorage,
    })).toEqual({ demoAudience: 'internal', demoAccount: 'local' });
  });

  it('ignores unsafe account slugs', () => {
    expect(parseDemoContext({
      search: '?da=../../bad',
      isDev: false,
      demoMode: true,
      storage: sessionStorage,
    })).toEqual({ demoAudience: 'prospect', demoAccount: 'default' });
  });
});

describe('getAnalyticsConfig', () => {
  it('AC-PH-001: disables analytics when both flags are false', () => {
    expect(getAnalyticsConfig(baseEnv, '', sessionStorage).enabled).toBe(false);
  });

  it('AC-PH-002: enables analytics for demo mode', () => {
    const cfg = getAnalyticsConfig({ ...baseEnv, VITE_DEMO_MODE: 'true' }, '', sessionStorage);
    expect(cfg.enabled).toBe(true);
    expect(cfg.replayAndAutocapture).toBe(true);
  });

  it('AC-PH-004: analytics-only mode disables replay/autocapture', () => {
    const cfg = getAnalyticsConfig({ ...baseEnv, VITE_ANALYTICS_ENABLED: 'true' }, '', sessionStorage);
    expect(cfg.enabled).toBe(true);
    expect(cfg.replayAndAutocapture).toBe(false);
  });
});
```

Run:

```bash
npm test -- config.test.ts
```

Expected: fails because `config.ts` does not exist.

- [ ] **Step 2: Implement config parser**

Create `config.ts` with:

```ts
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

  args.storage?.setItem(SESSION_AUDIENCE, ctx.demoAudience);
  args.storage?.setItem(SESSION_ACCOUNT, ctx.demoAccount);
  return ctx;
}

export function getAnalyticsConfig(
  env: EnvLike = import.meta.env,
  search = typeof window === 'undefined' ? '' : window.location.search,
  storage = typeof window === 'undefined' ? undefined : window.sessionStorage
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
```

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- config.test.ts
```

Expected: pass.

---

## Task 3 — Event Contract And Sanitizer (RED/GREEN)

**Files:**
- Create: `pmo-portal/src/lib/analytics/events.ts`
- Create: `pmo-portal/src/lib/analytics/events.test.ts`

- [ ] **Step 1: Write failing event tests**

Create `events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildEventProperties,
  trackFormValidationFailed,
  trackSaveFailed,
  trackPermissionDeniedSeen,
  trackEmptyStateSeen,
} from './events';

describe('analytics event sanitizer', () => {
  it('AC-PH-014: blocks forbidden property keys in dev/test', () => {
    expect(() => buildEventProperties('save_failed', {
      entity_type: 'project',
      operation: 'update',
      reason_code: 'network',
      module: 'projects',
      email: 'pm@acme.test',
    }, false)).toThrow(/forbidden analytics property/i);
  });

  it('AC-PH-013: failed-action helpers emit safe metadata only', () => {
    expect(trackFormValidationFailed('project-form', 2, 'required', 'projects')).toMatchObject({
      event: 'form_validation_failed',
      properties: { form_id: 'project-form', field_count: 2, reason_code: 'required', module: 'projects' },
    });
    expect(trackSaveFailed('project', 'update', 'network', 'projects').event).toBe('save_failed');
    expect(trackPermissionDeniedSeen('project-actions', 'Engineer', 'projects').event).toBe('permission_denied_seen');
    expect(trackEmptyStateSeen('project-list-empty', 'Project Manager', 'projects').event).toBe('empty_state_seen');
  });
});
```

Run:

```bash
npm test -- events.test.ts
```

Expected: fails because `events.ts` does not exist.

- [ ] **Step 2: Implement typed events**

Create `events.ts` with the event-name union from the spec, a `SafeProperties` type, a
`FORBIDDEN_PROPERTY_KEYS` set, and these exports:

```ts
export type AnalyticsEventName =
  | 'demo_persona_selected'
  | 'app_route_viewed'
  | 'auth_login_succeeded'
  | 'auth_login_failed'
  | 'auth_logout_succeeded'
  | 'project_detail_opened'
  | 'project_tab_viewed'
  | 'procurement_detail_opened'
  | 'filter_applied'
  | 'search_used'
  | 'coming_soon_clicked'
  | 'form_validation_failed'
  | 'save_failed'
  | 'permission_denied_seen'
  | 'empty_state_seen';

export type SafeValue = string | number | boolean | null | undefined;
export type SafeProperties = Record<string, SafeValue>;

export const FORBIDDEN_PROPERTY_KEYS = new Set([
  'email', 'name', 'full_name', 'person_name', 'company_name', 'project_name',
  'procurement_title', 'contract_value', 'budget', 'budget_amount', 'token',
  'access_token', 'refresh_token', 'notes', 'note', 'comment', 'comments',
  'file_name', 'file', 'password', 'query', 'search_params',
]);

export function buildEventProperties(
  event: AnalyticsEventName,
  properties: SafeProperties,
  production = import.meta.env.PROD
): SafeProperties {
  const safe: SafeProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (FORBIDDEN_PROPERTY_KEYS.has(key)) {
      if (!production) throw new Error(`Forbidden analytics property for ${event}: ${key}`);
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      if (!production) throw new Error(`Unsafe analytics value for ${event}: ${key}`);
      continue;
    }
    safe[key] = value;
  }
  return safe;
}
```

Add helper builders returning `{ event, properties }` for the explicit events used in tests. Keep them
pure; the SDK call happens in Task 4.

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- events.test.ts
npm run typecheck
```

Expected: pass.

---

## Task 4 — Route Sanitization (RED/GREEN)

**Files:**
- Create: `pmo-portal/src/lib/analytics/route.ts`
- Create: `pmo-portal/src/lib/analytics/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `route.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { routeAnalyticsForPath } from './route';

describe('routeAnalyticsForPath', () => {
  it('AC-PH-011: strips UUIDs and query strings from project detail routes', () => {
    expect(routeAnalyticsForPath('/projects/d0000000-0000-0000-0000-000000000001?x=y')).toEqual({
      route: '/projects/:projectId',
      module: 'projects',
    });
  });

  it('tracks project tabs as safe patterns', () => {
    expect(routeAnalyticsForPath('/projects/d0000000-0000-0000-0000-000000000001/budget')).toEqual({
      route: '/projects/:projectId/:tab',
      module: 'projects',
      tab_id: 'budget',
    });
  });

  it('tracks procurement detail as a safe pattern', () => {
    expect(routeAnalyticsForPath('/procurement/60000000-0000-0000-0000-000000000001')).toEqual({
      route: '/procurement/:procurementId',
      module: 'procurement',
    });
  });
});
```

- [ ] **Step 2: Implement route helper**

Create `route.ts` with deterministic pattern matching:

```ts
export interface RouteAnalytics {
  route: string;
  module: string;
  tab_id?: string;
}

const stripQuery = (path: string) => path.split('?')[0] || '/';

export function routeAnalyticsForPath(path: string): RouteAnalytics {
  const clean = stripQuery(path);
  const parts = clean.split('/').filter(Boolean);
  if (clean === '/') return { route: '/', module: 'dashboard' };
  if (parts[0] === 'login') return { route: '/login', module: 'auth' };
  if (parts[0] === 'projects' && parts.length >= 3) {
    return { route: '/projects/:projectId/:tab', module: 'projects', tab_id: parts[2] };
  }
  if (parts[0] === 'projects' && parts.length === 2) return { route: '/projects/:projectId', module: 'projects' };
  if (parts[0] === 'projects') return { route: '/projects', module: 'projects' };
  if (parts[0] === 'procurement' && parts.length === 2) return { route: '/procurement/:procurementId', module: 'procurement' };
  if (parts[0] === 'procurement') return { route: '/procurement', module: 'procurement' };
  if (parts[0] === 'sales' && parts.length === 2) return { route: '/sales/:opportunityId', module: 'sales' };
  if (parts[0]) return { route: `/${parts[0]}`, module: parts[0] };
  return { route: '/', module: 'dashboard' };
}
```

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- route.test.ts
```

Expected: pass.

---

## Task 5 — PostHog Client Boundary (RED/GREEN)

**Files:**
- Create: `pmo-portal/src/lib/analytics/client.ts`
- Create: `pmo-portal/src/lib/analytics/client.test.ts`

- [ ] **Step 1: Write failing SDK boundary tests**

Create `client.test.ts` that mocks `posthog-js`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsConfig } from './config';

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthog }));

import { analyticsClient } from './client';

const base: AnalyticsConfig = {
  enabled: true,
  demoMode: false,
  analyticsEnabled: true,
  replayAndAutocapture: false,
  posthogKey: 'ph_test',
  posthogHost: 'https://us.i.posthog.com',
  appEnv: 'test',
  isDev: false,
  isProd: false,
  demoAudience: 'internal',
  demoAccount: 'local',
};

beforeEach(() => {
  posthog.init.mockReset();
  posthog.capture.mockReset();
  posthog.identify.mockReset();
  posthog.register.mockReset();
  posthog.reset.mockReset();
  analyticsClient.__resetForTests();
});

describe('analyticsClient', () => {
  it('AC-PH-001: disabled mode does not init', () => {
    analyticsClient.init({ ...base, enabled: false });
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it('AC-PH-002/003/004: initializes once with host and no replay/autocapture in analytics-only mode', () => {
    analyticsClient.init(base);
    analyticsClient.init(base);
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init).toHaveBeenCalledWith('ph_test', expect.objectContaining({
      api_host: 'https://us.i.posthog.com',
      autocapture: false,
      disable_session_recording: true,
      enable_heatmaps: false,
    }));
  });

  it('AC-PH-005: deployed prospect demo enables replay and click-only autocapture', () => {
    analyticsClient.init({ ...base, demoMode: true, replayAndAutocapture: true, demoAudience: 'prospect', demoAccount: 'comp1' });
    expect(posthog.init).toHaveBeenCalledWith('ph_test', expect.objectContaining({
      disable_session_recording: false,
      autocapture: expect.objectContaining({
        dom_event_allowlist: ['click'],
        element_allowlist: ['a', 'button'],
        capture_copied_text: false,
      }),
    }));
  });

  it('AC-PH-009/010: identifies, registers org context, and resets', () => {
    analyticsClient.init(base);
    analyticsClient.identify({ userId: 'u1', role: 'Project Manager', orgId: 'o1' });
    expect(posthog.identify).toHaveBeenCalledWith('u1', { role: 'Project Manager' });
    expect(posthog.register).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'o1', role: 'Project Manager' }));
    analyticsClient.reset();
    expect(posthog.reset).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement client**

Create `client.ts`:

```ts
import posthog from 'posthog-js';
import type { AnalyticsConfig } from './config';
import type { AnalyticsEventName, SafeProperties } from './events';
import { buildEventProperties, FORBIDDEN_PROPERTY_KEYS } from './events';

let initialized = false;
let activeConfig: AnalyticsConfig | null = null;

const redactUrl = (request: { name?: string }) => {
  if (request.name) request.name = request.name.split('?')[0];
  return request;
};

export const analyticsClient = {
  init(config: AnalyticsConfig) {
    activeConfig = config;
    if (!config.enabled || initialized || !config.posthogKey) return;
    posthog.init(config.posthogKey, {
      api_host: config.posthogHost,
      defaults: '2026-01-30',
      capture_pageview: false,
      person_profiles: 'identified_only',
      disable_session_recording: !config.replayAndAutocapture,
      enable_heatmaps: false,
      enable_recording_console_log: false,
      property_denylist: Array.from(FORBIDDEN_PROPERTY_KEYS),
      autocapture: config.replayAndAutocapture
        ? {
            dom_event_allowlist: ['click'],
            element_allowlist: ['a', 'button'],
            capture_copied_text: false,
            element_attribute_ignorelist: ['aria-label', 'data-sensitive'],
          }
        : false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '.ph-mask,[data-ph-mask="true"]',
        blockSelector: '.ph-no-capture,[data-ph-no-capture="true"]',
        maskCapturedNetworkRequestFn: redactUrl,
      },
    });
    initialized = true;
  },
  capture(event: AnalyticsEventName, properties: SafeProperties = {}) {
    if (!initialized || !activeConfig?.enabled) return;
    posthog.capture(event, buildEventProperties(event, properties, activeConfig.isProd));
  },
  identify(input: { userId: string; role: string; orgId: string }) {
    if (!initialized || !activeConfig?.enabled) return;
    posthog.identify(input.userId, { role: input.role });
    posthog.register({ role: input.role, org_id: input.orgId });
  },
  register(properties: SafeProperties) {
    if (!initialized || !activeConfig?.enabled) return;
    posthog.register(buildEventProperties('app_route_viewed', properties, activeConfig.isProd));
  },
  reset() {
    if (!initialized) return;
    posthog.reset();
  },
  __resetForTests() {
    initialized = false;
    activeConfig = null;
  },
};
```

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- client.test.ts
```

Expected: pass.

---

## Task 6 — Analytics Provider And Public Facade (RED/GREEN)

**Files:**
- Create: `pmo-portal/src/lib/analytics/AnalyticsProvider.tsx`
- Create: `pmo-portal/src/lib/analytics/AnalyticsProvider.test.tsx`
- Create: `pmo-portal/src/lib/analytics/index.ts`
- Modify: `pmo-portal/App.tsx`

- [ ] **Step 1: Write provider tests**

Test with `AuthContext.Provider` and `MemoryRouter`; mock `analyticsClient`. Required assertions:

```ts
// AC-PH-011: initial /projects/<uuid>?x=y captures app_route_viewed with route '/projects/:projectId'.
// AC-PH-009: currentUser registers identify({ userId, role, orgId }).
// AC-PH-010: transition from user to null calls reset().
```

Use exact profile shape from `AuthProvider.test.tsx`; do not include email in expected analytics calls.

- [ ] **Step 2: Implement provider**

`AnalyticsProvider.tsx` responsibilities:

```tsx
import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/src/auth/useAuth';
import { getAnalyticsConfig } from './config';
import { analyticsClient } from './client';
import { routeAnalyticsForPath } from './route';

export const AnalyticsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const { currentUser, role } = useAuth();
  const identifiedUserRef = useRef<string | null>(null);
  const config = getAnalyticsConfig();

  useEffect(() => {
    analyticsClient.init(config);
    analyticsClient.register({
      environment: config.appEnv,
      demo_audience: config.demoMode ? config.demoAudience : undefined,
      demo_account: config.demoMode ? config.demoAccount : undefined,
    });
  }, [config.enabled, config.demoAudience, config.demoAccount, config.replayAndAutocapture]);

  useEffect(() => {
    if (currentUser?.id && currentUser.org_id && role) {
      identifiedUserRef.current = currentUser.id;
      analyticsClient.identify({ userId: currentUser.id, role, orgId: currentUser.org_id });
    } else if (identifiedUserRef.current) {
      identifiedUserRef.current = null;
      analyticsClient.reset();
    }
  }, [currentUser?.id, currentUser?.org_id, role]);

  useEffect(() => {
    const route = routeAnalyticsForPath(`${location.pathname}${location.search}`);
    analyticsClient.capture('app_route_viewed', { ...route, role: role ?? undefined });
  }, [location.pathname, location.search, role]);

  return <>{children}</>;
};
```

`index.ts` should export the provider, client facade, event helpers, config, and route helper.

- [ ] **Step 3: Mount provider**

In `pmo-portal/App.tsx`, import:

```ts
import { AnalyticsProvider } from '@/src/lib/analytics';
```

Wrap the routes inside `BrowserRouter`:

```tsx
        <BrowserRouter>
          <AnalyticsProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/*" element={<Shell />} />
              </Route>
            </Routes>
          </AnalyticsProvider>
        </BrowserRouter>
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- AnalyticsProvider.test.tsx
npm run typecheck
```

Expected: pass.

---

## Task 7 — Login/Demo Events (RED/GREEN)

**Files:**
- Modify: `pmo-portal/src/auth/LoginPage.tsx`
- Modify: `pmo-portal/src/auth/LoginPage.test.tsx`

- [ ] **Step 1: Mock analytics in LoginPage tests**

At the top of `LoginPage.test.tsx`, add:

```ts
const analytics = vi.hoisted(() => ({
  capture: vi.fn(),
}));

vi.mock('@/src/lib/analytics', () => ({
  analyticsClient: analytics,
}));
```

Add tests:

```ts
it('AC-PH-012: demo persona selection captures role only, not email', async () => {
  vi.stubEnv('VITE_DEMO_MODE', 'true');
  renderLogin();
  await userEvent.click(screen.getByRole('button', { name: /Executive/i }));
  expect(analytics.capture).toHaveBeenCalledWith('demo_persona_selected', {
    persona_role: 'Executive',
  });
  expect(JSON.stringify(analytics.capture.mock.calls)).not.toContain('exec@acme.test');
});

it('AC-PH-013: login success/failure emit safe auth events', async () => {
  auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
  renderLogin();
  await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
  await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
  await waitFor(() => expect(analytics.capture).toHaveBeenCalledWith('auth_login_failed', {
    method: 'password',
    reason_code: 'invalid_credentials',
  }));
  expect(JSON.stringify(analytics.capture.mock.calls)).not.toContain('pm@acme.test');
});
```

- [ ] **Step 2: Update LoginPage**

Import:

```ts
import { analyticsClient } from '@/src/lib/analytics';
```

On persona click, before setting email/password:

```ts
analyticsClient.capture('demo_persona_selected', { persona_role: label });
```

On password login failure:

```ts
analyticsClient.capture('auth_login_failed', {
  method: 'password',
  reason_code: error.toLowerCase().includes('invalid') ? 'invalid_credentials' : 'auth_error',
});
```

On password login success before navigate:

```ts
analyticsClient.capture('auth_login_succeeded', { method: 'password' });
```

For magic-link success/failure, use method `magic_link` and reason code `auth_error`.

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- LoginPage.test.tsx
```

Expected: existing auth tests plus new analytics tests pass.

---

## Task 8 — Developer Docs And Environment Docs

**Files:**
- Create: `docs/analytics-events.md`
- Modify: `docs/environments.md`

- [ ] **Step 1: Add event guide**

Create `docs/analytics-events.md` with:

```md
# Analytics Events

Analytics is implemented behind `pmo-portal/src/lib/analytics`.

Rules:
- Components never import `posthog-js`.
- Add new event names to `events.ts` first.
- Use enum/status/module/reason-code properties, not raw domain objects.
- Never send email, names, raw UUID paths, query strings, project/company/procurement names, monetary
  values, notes/comments, file names/content, request/response bodies, or auth tokens.
- Demo account labels must be safe slugs (`comp1`, `roadshow-1`), not real company names unless the
  owner explicitly approves that usage.

First-slice events are defined in `docs/specs/posthog-instrumentation.spec.md`.
PostHog dashboards are a required follow-up after the first event stream lands.
```

- [ ] **Step 2: Update environment docs**

In `docs/environments.md` Cloudflare Pages env var list, add:

```md
  - `VITE_POSTHOG_KEY` = PostHog public project key (public browser key, not a personal API key)
  - `VITE_POSTHOG_HOST` = `https://us.i.posthog.com`
  - `VITE_ANALYTICS_ENABLED` = `false` for demo builds unless you need non-demo analytics
```

Add one note under `VITE_DEMO_MODE`:

```md
    With PostHog instrumentation, deployed demo sessions default to `demo_audience=prospect`.
    Add `?da=internal` for team testing, or `?da=<safe-slug>` (for example `?da=comp1`) to label a
    prospect demo account for the browser session.
```

- [ ] **Step 3: Verify docs only**

Run:

```bash
rg -n "VITE_POSTHOG|demo_audience|demo_account|PostHog dashboards" docs pmo-portal/.env.example
```

Expected: spec, ADR, plan, environment docs, analytics guide, and `.env.example` all mention the right
surfaces.

---

## Task 9 — Static Boundary And Full Verification

**Files:** all changed files in this issue.

- [ ] **Step 1: Static import boundary**

Run from repo root:

```bash
rg -n "from 'posthog-js'|from \"posthog-js\"" pmo-portal
```

Expected: exactly one hit in `pmo-portal/src/lib/analytics/client.ts`.

- [ ] **Step 2: Focused tests**

Run from `pmo-portal/`:

```bash
npm test -- config.test.ts events.test.ts route.test.ts client.test.ts AnalyticsProvider.test.tsx LoginPage.test.tsx
```

Expected: all pass.

- [ ] **Step 3: Merge gates**

Run from `pmo-portal/`:

```bash
npm run typecheck
npm run lint:ci
npm test
npm run build
```

Expected: all pass. No e2e required for this client-only instrumentation slice, but if another branch
already changed app behavior, run `npx playwright test` before shipping.

- [ ] **Step 4: Security/privacy review checkpoint**

Before PR:

```bash
rg -n "email|full_name|project_name|company_name|contract_value|notes|comment|file_name|access_token|refresh_token" pmo-portal/src/lib/analytics pmo-portal/src/auth/LoginPage.tsx
```

Expected: hits only in forbidden-key lists/tests/docs or safe source email constants already present in
the login persona list; no analytics capture sends those values.

---

## Follow-Up Issue: PostHog Dashboard Setup

After this instrumentation PR lands and emits data, create a separate SDD spec/plan for dashboards:

- Sessions/replays by `demo_account`.
- Route/module interest.
- Project/procurement detail interest.
- Coming-soon demand.
- Failed-action friction.
- Search/filter usage.
- Internal-vs-prospect filtering.

Do not build dashboard provisioning in this PR.
