import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const EDITOR_FILES = ['MinutesEditor', 'minutesSchema', 'minutesDictionary', 'ActionItemView'].map((n) => `src/components/meetings/${n}`);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === 'e2e' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}
const files = walk(join(root, 'src')).concat(walk(join(root, 'pages')), [join(root, 'App.tsx')]);
const rel = (f: string) => relative(root, f).replace(/\\/g, '/');

describe('the BlockNote editor stays out of the initial bundle (FR-MTG-026)', () => {
  it('AC-MTG-024 only the editor module family imports @blocknote/*', () => {
    const offenders = files
      .filter((f) => /@blocknote\//.test(readFileSync(f, 'utf8')))
      .map(rel)
      .filter((f) => !f.startsWith('src/components/meetings/'));
    expect(offenders).toEqual([]);
  });

  it('AC-MTG-024 nothing imports the editor module family statically — the route reaches it via import()', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (rel(f).startsWith('src/components/meetings/')) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gms)) {
        if (EDITOR_FILES.some((e) => m[1].replace('@/', '') === e || m[1].endsWith(e.split('/').pop()!))) {
          offenders.push(`${rel(f)} → ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('AC-MTG-024 MeetingDetail loads the editor with React.lazy(() => import(…))', () => {
    const src = readFileSync(join(root, 'pages/MeetingDetail.tsx'), 'utf8');
    expect(src).toMatch(/React\.lazy\(\(\)\s*=>\s*import\('@\/src\/components\/meetings\/MinutesEditor'\)\)/);
  });
});
