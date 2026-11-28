import fs from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

// Same stance as App.preloads.test: only the rules are under test, never a real chunk download.
vi.mock('@/src/lib/lazyWithPreload', () => ({ lazyWithPreload: () => ({ preload: async () => ({}) }) }));

import { namespacesForPath } from '../../../App';
import { PAGES_NS } from './index';

/**
 * Guard for the `common` → `common` + `commonPages` split. `commonPages` is a SECOND fallback
 * namespace, so a screen that renders one of its keys only has it if the route rule loads it:
 * otherwise the key shows raw. Two failures are made impossible here, by walking the import graph:
 *  1. a `commonPages` key used by a file the start-up bundle loads (it would render before the
 *     namespace is there, on every route);
 *  2. a route chunk whose code reaches such a key and whose `PRELOAD_RULES` entry does not list
 *     `commonPages`.
 */
const APP = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(APP, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p, out); }
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p.split(path.sep).join('/'));
  }
  return out;
}
const files = new Set(['App.tsx', 'index.tsx', ...walk('pages'), ...walk('src'), ...walk('components')]);
const src = new Map([...files].map((f) => [f, fs.readFileSync(path.join(APP, f), 'utf8')]));

function resolveSpec(from: string, spec: string): string | undefined {
  const base = spec.startsWith('@/') ? spec.slice(2) : spec.startsWith('.') ? path.posix.join(path.posix.dirname(from), spec) : undefined;
  if (!base) return undefined;
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base].find((c) => files.has(c));
}
const staticEdges = new Map<string, Set<string>>();
const dynamicEdges = new Map<string, Set<string>>();
for (const [f, text] of src) {
  const s = new Set<string>(); const d = new Set<string>();
  for (const m of text.matchAll(/import\s*\(\s*['"]([^'"]+)['"]/g)) { const t = resolveSpec(f, m[1]); if (t) d.add(t); }
  const noDynamic = text.replace(/import\s*\(\s*['"][^'"]+['"]/g, '');
  for (const m of noDynamic.matchAll(/(?:from\s*|import\s+)['"]([^'"]+)['"]/g)) { const t = resolveSpec(f, m[1]); if (t) s.add(t); }
  staticEdges.set(f, s); dynamicEdges.set(f, d);
}

const catalogue = JSON.parse(fs.readFileSync(path.join(APP, `public/locales/en/${PAGES_NS}.json`), 'utf8')) as Record<string, unknown>;
const blocks = Object.keys(catalogue);

/** Files whose text names a moved key (`'<block>.…'`, `common:<block>.…`, in any quote style). */
const userFiles = new Map<string, Set<string>>(); // file -> blocks
for (const [f, text] of src) {
  for (const b of blocks) {
    if (new RegExp(`['"\`](?:common:)?${b}\\.`).test(text)) (userFiles.get(f) ?? userFiles.set(f, new Set()).get(f)!).add(b);
  }
}

function reachers(target: string): Set<string> {
  const rev = new Map<string, Set<string>>();
  for (const edges of [staticEdges, dynamicEdges]) for (const [from, tos] of edges) for (const t of tos) (rev.get(t) ?? rev.set(t, new Set()).get(t)!).add(from);
  const seen = new Set([target]); const queue = [target];
  while (queue.length) for (const up of rev.get(queue.pop()!) ?? []) if (!seen.has(up)) { seen.add(up); queue.push(up); }
  return seen;
}

/** Route chunk files -> the URL paths whose preload rule starts them (read from the rule source). */
const appText = src.get('App.tsx')!;
const lazyFile = new Map<string, string>(); // identifier -> file
for (const f of ['App.tsx', 'pages/project-detail/lazyProjectChunks.ts']) {
  for (const m of src.get(f)!.matchAll(/(?:const|export const)\s+(\w+)\s*=\s*lazyWithPreload\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g)) {
    const t = resolveSpec(f, m[2]); if (t) lazyFile.set(m[1], t);
  }
}
const routeFilePaths = new Map<string, Set<string>>();
const addPath = (file: string, p: string) => (routeFilePaths.get(file) ?? routeFilePaths.set(file, new Set()).get(file)!).add(p);
const rulesBlock = appText.slice(appText.indexOf('const PRELOAD_RULES'), appText.indexOf('/** Same semantics the router applies'));
for (const line of rulesBlock.split('\n')) {
  const pm = /path:\s*'([^']+)'/.exec(line); const cm = /chunks:\s*\[([^\]]*)\]/.exec(line);
  if (!pm || !cm) continue;
  for (const id of cm[1].split(/[,\s]+/)) if (lazyFile.has(id)) addPath(lazyFile.get(id)!, pm[1]);
}
// The project tab rules are built from a table, not written one per line: sample every tab.
const PROJECT_SAMPLES = ['', '/overview', ...['orders', 'budget', 'procurement', 'materials', 'tasks', 'documents', 'contract', 'billing', 'work-orders', 'activity', 'other'].map((t) => `/${t}`)].map((s) => `/projects/:projectId${s}`);
for (const [id, file] of lazyFile) if (file.startsWith('pages/project-detail/') && id !== 'ProjectDetail') for (const p of PROJECT_SAMPLES) addPath(file, p);

it('the moved catalogue is non-empty and its keys are found in source', () => {
  expect(blocks.length).toBeGreaterThan(0);
  expect(userFiles.size).toBeGreaterThan(0);
});

it('no start-up file uses a commonPages key', () => {
  const entry = new Set(['index.tsx']); const queue = ['index.tsx'];
  while (queue.length) for (const t of staticEdges.get(queue.pop()!) ?? []) if (!entry.has(t)) { entry.add(t); queue.push(t); }
  expect([...userFiles.keys()].filter((f) => entry.has(f)).map((f) => `${f}: ${[...userFiles.get(f)!]}`)).toEqual([]);
});

it('every route chunk that reaches a commonPages key loads commonPages on entry', () => {
  const failures: string[] = [];
  const routeFiles = new Set(lazyFile.values());
  for (const [user, used] of userFiles) {
    for (const up of reachers(user)) {
      if (!routeFiles.has(up)) continue;
      const paths = routeFilePaths.get(up);
      if (!paths?.size) { failures.push(`${up} reaches ${[...used]} (via ${user}) but no route rule starts it`); continue; }
      for (const p of paths) {
        if (!namespacesForPath(p.replace(/:\w+/g, 'x')).includes(PAGES_NS)) failures.push(`${p} -> ${up} reaches ${[...used]} without ${PAGES_NS}`);
      }
    }
  }
  expect([...new Set(failures)].sort()).toEqual([]);
});
