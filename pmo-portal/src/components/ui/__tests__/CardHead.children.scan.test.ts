// @vitest-environment node
/**
 * Static guard (T1 regression): CardHead renders a real heading, so anything interactive (or any
 * non-title element) among its children becomes part of the heading's accessible name. Production
 * `<CardHead>` children may be plain text / expressions / inline text wrappers only — buttons,
 * links, inputs, badges and menus belong in the `actions` prop.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(__dirname, '../../../..');
const SCAN_DIRS = ['pages', 'src', 'components'];
const INLINE_TEXT_TAGS = new Set(['span', 'strong', 'em', 'b', 'i', 'small']);

/** Sites whose heading content is deliberately interactive, with the reason. Stale entries fail. */
const ALLOWED: Record<string, string> = {
  // WAI-ARIA accordion header: the disclosure <button> inside the heading IS the heading's content.
  'src/components/history/HistorySection.tsx': 'accordion trigger button is the heading content',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '__tests__') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name) && !/\.(test|spec|stories)\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

function tagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText();
}

/** Returns a description of the first disallowed child under `node`, or null. */
function badChild(node: ts.Node): string | null {
  let bad: string | null = null;
  const visit = (n: ts.Node): void => {
    if (bad) return;
    if (ts.isJsxSelfClosingElement(n)) { bad = `<${tagName(n)} />`; return; }
    if (ts.isJsxFragment(n)) { bad = '<> fragment'; return; }
    if (ts.isJsxElement(n)) {
      if (!INLINE_TEXT_TAGS.has(tagName(n))) { bad = `<${tagName(n)}>`; return; }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return bad;
}

function violations(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isJsxElement(n) && tagName(n) === 'CardHead') {
      // Children only — the `actions` attribute lives on the opening element, outside this walk.
      for (const child of n.children) {
        if (ts.isJsxText(child)) continue;
        const wrapper = ts.isJsxElement(child) && INLINE_TEXT_TAGS.has(tagName(child));
        const why = wrapper ? badChild(child) : ts.isJsxExpression(child) ? badChild(child) : ts.isJsxFragment(child) ? '<> fragment' : `<${tagName(child as ts.JsxElement)}>`;
        if (why) found.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} CardHead child ${why}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe('CardHead children scan (interactive content goes in `actions`)', () => {
  it('flags interactive children, accepts inline text wrappers and actions (self-test)', () => {
    const bad = `const a = <CardHead>Title<Button>x</Button></CardHead>;`;
    const cond = `const a = <CardHead>Title{ok && <Button>x</Button>}</CardHead>;`;
    const ok = `const a = <CardHead actions={<Button>x</Button>}>Title <span className="m">{hint}</span></CardHead>;`;
    expect(violations('bad.tsx', bad)).toHaveLength(1);
    expect(violations('cond.tsx', cond)).toHaveLength(1);
    expect(violations('ok.tsx', ok)).toEqual([]);
  });

  it('no production CardHead has an element child other than an inline text wrapper', () => {
    const all = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
    const offenders: string[] = [];
    const flaggedAllowed = new Set<string>();
    for (const file of all) {
      const rel = relative(ROOT, file);
      const found = violations(rel, readFileSync(file, 'utf8'));
      if (found.length && rel in ALLOWED) flaggedAllowed.add(rel);
      else offenders.push(...found);
    }
    expect(offenders).toEqual([]);
    expect(Object.keys(ALLOWED).filter((f) => !flaggedAllowed.has(f))).toEqual([]);
  });
});
