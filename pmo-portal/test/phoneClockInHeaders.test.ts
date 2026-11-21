/**
 * AC-PCI-013 (#2705) — geolocation is allowed on the clock-in route only. The site-wide `/*` rule keeps blocking it (AC-SEC-207 pins that
 * value); `/my` detaches the header and re-adds a policy with geolocation=(self). Camera and microphone stay blocked everywhere.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HEADERS = readFileSync(join(process.cwd(), 'public/_headers'), 'utf8');

interface Rule { detached: string[]; set: Map<string, string> }
function rules(text: string): Map<string, Rule> {
  const out = new Map<string, Rule>();
  let cur: Rule | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { detached: [], set: new Map() }; out.set(line.trim(), cur); continue; }
    if (!cur) continue;
    const t = line.trim();
    if (t.startsWith('!')) { cur.detached.push(t.slice(1).trim().toLowerCase()); continue; }
    const i = t.indexOf(':');
    cur.set.set(t.slice(0, i).trim().toLowerCase(), t.slice(i + 1).trim());
  }
  return out;
}

describe('AC-PCI-013 geolocation is scoped to the clock-in route', () => {
  const all = rules(HEADERS);
  it('the clock-in route detaches the site-wide policy and allows geolocation for this origin', () => {
    const my = all.get('/my');
    expect(my, 'a /my rule').toBeDefined();
    expect(my?.detached).toContain('permissions-policy');
    expect(my?.set.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=(self)');
  });
  it('the detach line comes before the re-add so the route ends with exactly one policy', () => {
    const block = HEADERS.slice(HEADERS.indexOf('\n/my\n'));
    expect(block.indexOf('! Permissions-Policy')).toBeGreaterThan(-1);
    expect(block.indexOf('! Permissions-Policy')).toBeLessThan(block.indexOf('Permissions-Policy: camera'));
  });
  it('every other rule that sets a permissions policy still blocks geolocation, camera and microphone', () => {
    const others = [...all.entries()].filter(([path]) => path !== '/my');
    const withPolicy = others.filter(([, r]) => r.set.has('permissions-policy'));
    expect(withPolicy.length).toBeGreaterThan(0);
    for (const [path, r] of withPolicy) {
      const v = r.set.get('permissions-policy') ?? '';
      expect(v, path).toContain('geolocation=()');
      expect(v, path).toContain('camera=()');
      expect(v, path).toContain('microphone=()');
    }
  });
  it('no rule other than /my allows geolocation, and /my never allows camera or microphone', () => {
    for (const [path, r] of all) {
      const v = r.set.get('permissions-policy') ?? '';
      if (path !== '/my') expect(v, path).not.toMatch(/geolocation=\((?!\))/);
    }
    expect(all.get('/my')?.set.get('permissions-policy')).not.toMatch(/(camera|microphone)=\((?!\))/);
  });
});
