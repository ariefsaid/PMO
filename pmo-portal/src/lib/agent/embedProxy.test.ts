/**
 * AC-408 (proxy config half) — FR-408.
 * The Vite dev proxy must forward the agent-native SDK's same-origin calls to the
 * Nitro sidecar (same-origin so the embed auth interceptor's `Authorization` header rides along).
 *
 * Owning layer: Unit (the proxy spec is a pure config object consumed by vite.config.ts).
 */
import { describe, it, expect } from 'vitest';
import { AGENT_SIDECAR_PROXY, AGENT_SIDECAR_TARGET, AGENT_NATIVE_ROUTE_PREFIX } from '@/src/lib/agent/embedProxy';

describe('AC-408 — agent-native same-origin dev proxy config', () => {
  it('proxies the SDK-fixed /_agent-native prefix (not a dead /agent path)', () => {
    // The SDK hardcodes /_agent-native; a proxy on any other path is dead config.
    expect(AGENT_NATIVE_ROUTE_PREFIX).toBe('/_agent-native');
    expect(AGENT_SIDECAR_PROXY).toHaveProperty('/_agent-native');
  });

  it('forwards to the Nitro sidecar on 127.0.0.1:8100 with changeOrigin', () => {
    const entry = (AGENT_SIDECAR_PROXY as Record<string, { target: string; changeOrigin: boolean }>)[
      AGENT_NATIVE_ROUTE_PREFIX
    ];
    expect(entry.target).toBe(AGENT_SIDECAR_TARGET);
    expect(AGENT_SIDECAR_TARGET).toBe('http://127.0.0.1:8100');
    // changeOrigin so the sidecar sees a same-host request + keeps the Authorization header.
    expect(entry.changeOrigin).toBe(true);
  });

  it('preserves the Authorization header through the proxyReq hook', () => {
    // The bearer the embed auth interceptor stamps must survive the hop to the sidecar.
    const entry = AGENT_SIDECAR_PROXY[
      AGENT_NATIVE_ROUTE_PREFIX as keyof typeof AGENT_SIDECAR_PROXY
    ] as unknown as { configure: (proxy: MockProxy) => void };
    const setHeaders: Record<string, string> = {};
    const proxy: MockProxy = {
      on: (event, cb) => {
        // capture the registered proxyReq handler so we can invoke it
        if (event === 'proxyReq') (proxy as unknown as { _handler?: (...a: unknown[]) => void })._handler = cb;
      },
    };
    entry.configure(proxy);
    const handler = (proxy as unknown as { _handler?: (...a: unknown[]) => void })._handler;
    expect(handler).toBeDefined();

    handler!({ setHeader: (k, v) => (setHeaders[k] = v) }, { headers: { authorization: 'Bearer jwt-abc' } });
    expect(setHeaders['Authorization']).toBe('Bearer jwt-abc');
  });
});

interface MockProxy {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}
