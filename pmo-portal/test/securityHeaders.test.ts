/**
 * AC-CLI-016 — the deployed app may not be framed by any site (#728 security review). The consent
 * screen at /oauth/consent grants an outside program access to the user's account, so it — and, for
 * simplicity, every page — refuses to render inside a frame. Cloudflare Pages serves
 * `public/_headers` (copied verbatim into dist/ by Vite); the SPA fallback in `_redirects` serves
 * every route under the same `/*` rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HEADERS = readFileSync(join(process.cwd(), 'public/_headers'), 'utf8');

/** Parse Cloudflare Pages `_headers`: a URL pattern line, then indented `Name: value` lines. */
function rules(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      out.set(line.trim(), current);
    } else if (current) {
      const i = line.indexOf(':');
      current.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
    }
  }
  return out;
}

describe('security headers (AC-CLI-016)', () => {
  it('AC-CLI-016: every page refuses to be framed — CSP frame-ancestors none and X-Frame-Options DENY', () => {
    const all = rules(HEADERS).get('/*');
    expect(all, 'a site-wide /* rule').toBeDefined();
    expect(all?.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(all?.get('x-frame-options')).toBe('DENY');
  });
});
