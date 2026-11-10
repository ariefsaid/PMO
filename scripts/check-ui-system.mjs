#!/usr/bin/env node
/**
 * Guard (#2059): the UI stays on ONE button system, ONE avatar, sentence-case labels.
 * Fails on, in app source (tests and vendored reui/shadcn excluded):
 *   uppercase   a CSS `uppercase` class (labels are sentence case; codes are typed in caps)
 *   button      a <Button> className that sets its own height or text size, or a <Link>/<a>/<button>
 *               hand-styled as a button (rounded + border-input or bg-primary): use <Button> /
 *               buttonClasses(variant, size) with the DESIGN.md sizes (default 38px, sm 30px, icon)
 *   avatar      a hand-built initials circle (rounded-full + place-items-center + bg-secondary) or the
 *               retired per-person --avatar-N hues: use <Avatar> from src/components/ui/Avatar
 * Existing exceptions live in ALLOW (path -> rule, reason); a stale entry fails too.
 *
 * Run: node scripts/check-ui-system.mjs [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['pmo-portal/pages', 'pmo-portal/src', 'pmo-portal/components'];
const SKIP = /(\.test\.|\/__tests__\/|\/reui\/|\/shadcn\/|\.d\.ts$)/;

/** path -> { rule, reason } — each must still match, or the entry is stale. */
export const ALLOW = {
  'pmo-portal/src/components/EnvBadge.tsx': { rule: 'uppercase', reason: 'environment code badge (STAGING), a code not a label' },
  'pmo-portal/src/components/ui/ConfirmDialog.tsx': { rule: 'button', reason: '44px mobile sheet buttons' },
};

const RULES = {
  uppercase: (line) => /\buppercase\b/.test(line),
  button: (line) =>
    /<Button\b[^>]*className="[^"]*(?<![-\w])(h-\d|h-\[|text-xs|text-sm|text-\[)/.test(line) ||
    /<(Link|a|button)\b[^>]*className="[^"]*\brounded-(md|lg)\b[^"]*(border-input|bg-primary\b)/.test(line),
  avatar: (line) =>
    /--avatar-\d|avatarHue/.test(line) ||
    (/rounded-full/.test(line) && /place-items-center|items-center justify-center/.test(line) && /\bsize-\d/.test(line) && /bg-secondary\b/.test(line) && /text-\[|font-(bold|semibold)/.test(line)),
};

export function scan(path, text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const [rule, test] of Object.entries(RULES)) if (test(line)) hits.push({ path, line: i + 1, rule });
  });
  return hits;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !SKIP.test(p)) out.push(p);
  }
  return out;
}

export function evaluate(hits) {
  const used = new Set();
  const failures = [];
  for (const h of hits) {
    const a = ALLOW[h.path];
    if (a && a.rule === h.rule) used.add(h.path);
    else failures.push(`${h.path}:${h.line} ${h.rule}`);
  }
  for (const p of Object.keys(ALLOW)) if (!used.has(p)) failures.push(`${p} stale allowlist entry (${ALLOW[p].rule})`);
  return failures;
}

function selfTest() {
  const bad = {
    uppercase: '<p className="text-[11px] uppercase tracking-wide">Status</p>',
    button: '<Button variant="outline" className="h-9 px-2">Go</Button>',
    button2: '<Link className="rounded-md border border-input px-3" to="/x">Go</Link>',
    avatar: '<span className="grid size-6 place-items-center rounded-full bg-secondary text-[11px] font-bold">RK</span>',
    avatar2: "style={{ background: 'hsl(var(--avatar-2))' }}",
  };
  const good = ['<Button variant="outline" size="sm" className="w-full">Go</Button>', '<span className="rounded-full bg-primary size-2" />'];
  for (const [k, line] of Object.entries(bad)) if (!scan('x.tsx', line).length) throw new Error(`self-test: ${k} not caught`);
  for (const line of good) if (scan('x.tsx', line).length) throw new Error(`self-test: false positive on ${line}`);
  if (!evaluate([]).some((f) => f.includes('stale'))) throw new Error('self-test: stale entry not caught');
  console.log('check-ui-system self-test ok');
}

if (process.argv.includes('--self-test')) selfTest();
else {
  const hits = ROOTS.flatMap((r) => walk(join(REPO, r))).flatMap((f) => scan(relative(REPO, f), readFileSync(f, 'utf8')));
  const failures = evaluate(hits);
  if (failures.length) {
    console.error('UI system guard failed (#2059):\n' + failures.map((f) => '  ' + f).join('\n'));
    process.exit(1);
  }
  console.log('check-ui-system ok');
}
