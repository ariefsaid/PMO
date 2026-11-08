import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
// #2062: the rich-note editor is a second lazy BlockNote family (approval/activity notes) — the
// SAME invariant, one more family: everything importing @blocknote/* stays reachable only via
// import(), and pages reach it only through its chunk module (richNoteEditorChunk).
const EDITOR_FAMILIES = ['src/components/meetings/', 'src/components/notes/'];
const EDITOR_FILES = [
  'src/components/meetings/MinutesEditor',
  'src/components/meetings/minutesSchema',
  'src/components/meetings/minutesDictionary',
  'src/components/meetings/ActionItemView',
  'src/components/notes/RichNoteEditor',
  'src/components/notes/richNoteSchema',
  'src/components/notes/notePalette',
];

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
  it('AC-MTG-024 only the editor module families import @blocknote/* (minutes + notes, #2062)', () => {
    const offenders = files
      .filter((f) => /@blocknote\//.test(readFileSync(f, 'utf8')))
      .map(rel)
      .filter((f) => !EDITOR_FAMILIES.some((dir) => f.startsWith(dir)));
    expect(offenders).toEqual([]);
  });

  it('AC-MTG-024 nothing imports the editor module family statically — the route reaches it via import()', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const modulePath = rel(f).replace(/\.(tsx?|css)$/, '');
      if (EDITOR_FILES.includes(modulePath)) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gms)) {
        if (EDITOR_FILES.some((e) => m[1].replace('@/', '') === e || m[1].endsWith(e.split('/').pop()!))) {
          offenders.push(`${rel(f)} → ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('AC-MTG-024 MeetingDetail reaches the editor through the shared lazy chunk module — never a static import', () => {
    const detail = readFileSync(join(root, 'pages/MeetingDetail.tsx'), 'utf8');
    const minutes = readFileSync(join(root, 'src/components/meetings/MeetingMinutes.tsx'), 'utf8');
    const chunk = readFileSync(join(root, 'src/components/meetings/minutesEditorChunk.ts'), 'utf8');
    expect(detail).toMatch(/import MeetingMinutes[^;]*from ['"]@\/src\/components\/meetings\/MeetingMinutes['"]/);
    // #1834 moved the lazy declaration into the shared minutesEditorChunk module
    // (one memoized import + a preload the route entry fires); the ORACLE is
    // unchanged — the editor is still reached only via import(), never statically.
    expect(minutes).toMatch(/import \{ MinutesEditor \} from ['"]@\/src\/components\/meetings\/minutesEditorChunk['"]/);
    expect(chunk).toMatch(/import\('\.\/MinutesEditor'\)/);
  });
});
