/**
 * AC-PCI-013 (#2705) / AC-WCI-041 — geolocation is allowed for this site's own origin on every route, so the phone clock-in screen and
 * the crews check-in area form work whichever page the browser loaded first. Camera and microphone stay blocked; no rule re-opens either.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HEADERS = readFileSync(join(process.cwd(), 'public/_headers'), 'utf8');

function rules(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let cur: Map<string, string> | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = new Map(); out.set(line.trim(), cur); continue; }
    const t = line.trim();
    if (!cur || t.startsWith('!')) continue;
    const i = t.indexOf(':');
    cur.set(t.slice(0, i).trim().toLowerCase(), t.slice(i + 1).trim());
  }
  return out;
}

describe('AC-PCI-013 geolocation is allowed for this origin on every route', () => {
  const all = rules(HEADERS);
  it('the site-wide rule allows geolocation for this origin only, with camera and microphone blocked', () => {
    expect(all.get('/*')?.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=(self)');
  });
  it('AC-WCI-041 no per-route rule detaches or re-adds the permissions policy (a browser keeps the first page loaded)', () => {
    expect(HEADERS).not.toMatch(/^\s*!\s*Permissions-Policy/im);
    expect(all.has('/my')).toBe(false);
    expect(all.has('/crews')).toBe(false);
  });
  it('every rule that sets a permissions policy blocks camera and microphone and allows geolocation for this origin only', () => {
    const withPolicy = [...all.entries()].filter(([, r]) => r.has('permissions-policy'));
    expect(withPolicy.length).toBeGreaterThan(0);
    for (const [path, r] of withPolicy) {
      const v = r.get('permissions-policy') ?? '';
      expect(v, path).toContain('camera=()');
      expect(v, path).toContain('microphone=()');
      expect(v, path).toMatch(/geolocation=\(self\)/);
      expect(v, path).not.toContain('*');
    }
  });
});
