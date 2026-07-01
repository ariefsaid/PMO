/**
 * E3 (ADR-0040, FR-408 / AC-408) — same-origin dev proxy to the agent-native Nitro sidecar.
 *
 * WHY `/_agent-native` (not `/agent`): the installed `@agent-native/core/client` HARDCODES
 * the framework route prefix `/_agent-native` (verified in
 * `node_modules/@agent-native/core/dist/client/api-path.js` — `FRAMEWORK_ROUTE_PREFIX`,
 * not configurable). The browser-session bridge, the chat fetcher, and the embed auth
 * interceptor all target `/_agent-native/*`. Proxying any other path would be dead config:
 * the SDK never calls it, so the bearer-attached request would never be forwarded. The
 * proven pilot (`PMO-sidecar/pmo/agent-native/embed/vite.config.ts`) proxies exactly this
 * prefix. (The issue brief's literal `/agent` is shorthand; the SDK-fixed prefix wins.)
 *
 * This module is PURE DATA (no app imports) so it is safe to import from BOTH
 * `vite.config.ts` (Node context) and the Vitest unit test that asserts AC-408. Keeping the
 * proxy spec in one place means the test asserts the exact object Vite consumes.
 *
 * Prod same-origin proxy is a Cloudflare Pages Function (E8) — NOT configured here.
 */

/** The Nitro sidecar origin (local dev: port 8100, matching `pmo/agent-native` `nitro dev --port 8100`). */
export const AGENT_SIDECAR_TARGET = 'http://127.0.0.1:8100';

/** The SDK-fixed framework route prefix every agent-native client fetch is scoped under. */
export const AGENT_NATIVE_ROUTE_PREFIX = '/_agent-native';

/**
 * Vite dev-server proxy entry: forwards same-origin `/_agent-native/*` (with the
 * `Authorization` header the embed auth interceptor injected) to the Nitro sidecar.
 *
 * `changeOrigin` + the `proxyReq` hook preserve the bearer agent-native's fetch
 * interceptor stamped on the client (http-proxy keeps Authorization by default for
 * `changeOrigin` proxies; the hook is belt-and-suspenders against any intermediary
 * that strips headers). Mirrors the proven pilot config.
 */
export const AGENT_SIDECAR_PROXY = {
  [AGENT_NATIVE_ROUTE_PREFIX]: {
    target: AGENT_SIDECAR_TARGET,
    changeOrigin: true,
    configure: (proxy: { on: (event: string, cb: (...args: unknown[]) => void) => void }) => {
      proxy.on('proxyReq', (proxyReq: { setHeader: (k: string, v: string) => void }, req: { headers: Record<string, string | undefined> }) => {
        const auth = req.headers['authorization'];
        if (auth) proxyReq.setHeader('Authorization', auth);
        const target = req.headers['x-agent-native-embed-target'];
        if (target) proxyReq.setHeader('x-agent-native-embed-target', target);
      });
    },
  },
} as const;
