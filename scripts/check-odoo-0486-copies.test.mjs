// Migration 0486 re-creates three ECA-2 functions (migration 0480) with an Odoo arm, because 0480 is not merged yet and is
// another branch's file. A later ECA-2 fix to the same function would be reverted silently by 0486, so this fails when a
// 0486 copy differs from the last earlier definition by anything but its `-- odoo-arm` lines.
// Fix on failure: take the earlier definition's new body into 0486 and re-add the odoo-arm lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const OWN = '0486_odoo_project_links_config.sql';
const COPIED = ['accept_connect_proposals', 'unlink_connect_match', 'connect_link_project'];

export function definition(sql, fn) {
  const start = sql.lastIndexOf(`create or replace function public.${fn}(`);
  if (start < 0) return null;
  const end = sql.indexOf('\nend $$;', start);
  assert.ok(end > start, `${fn}: no closing "end $$;"`);
  return sql.slice(start, end);
}

/** The code lines of a body, minus the odoo-arm lines; an `elsif` that followed an arm-opening `if` becomes the `if` it was. */
export function codeLines(body) {
  const out = [];
  let armOpened = false;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line.includes('-- odoo-arm')) { armOpened = armOpened || line.startsWith('if '); continue; }
    let code = line.replace(/--.*$/, '').trim();
    if (!code) continue;
    if (armOpened && code.startsWith('elsif ')) code = code.slice(3);
    armOpened = false;
    out.push(code);
  }
  return out;
}

const earlier = (fn) => {
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f < OWN).sort();
  for (const f of files.reverse()) {
    const d = definition(readFileSync(join(dir, f), 'utf8'), fn);
    if (d) return { file: f, body: d };
  }
  return null;
};

for (const fn of COPIED) {
  test(`0486's ${fn} is the earlier definition plus its Odoo arm, nothing else`, () => {
    const mine = definition(readFileSync(join(dir, OWN), 'utf8'), fn);
    assert.ok(mine, `${OWN} no longer defines ${fn}`);
    assert.ok(mine.split('\n').some((l) => l.includes('-- odoo-arm')), `${fn}: no odoo-arm line left in the copy`);
    const prior = earlier(fn);
    assert.ok(prior, `${fn}: no earlier definition found`);
    assert.deepEqual(codeLines(mine), codeLines(prior.body),
      `${fn} in ${OWN} drifted from its definition in ${prior.file}: re-copy that body and re-add the odoo-arm lines`);
  });
}

test('the comparison notices a changed line and an extra one', () => {
  const base = 'create or replace function public.f()\nbegin\n  if a then\n    x := 1;\n  end if;';
  assert.deepEqual(codeLines(base), codeLines(base.replace('\n  if a then', '\n  if a then -- odoo-arm\n  elsif b then -- odoo-arm\n  if a then')));
  assert.notDeepEqual(codeLines(base), codeLines(base.replace('x := 1', 'x := 2')));
  assert.notDeepEqual(codeLines(base), codeLines(`${base}\n  y := 1;`));
});
