import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import en from '../../../../public/locales/en/workOrderSections.json';
import id from '../../../../public/locales/id/workOrderSections.json';
import enCommon from '../../../../public/locales/en/common.json';
import idCommon from '../../../../public/locales/id/common.json';

/**
 * AC-WOS-018 / NFR-WOS-004 (#2576): the word for a work-order section is spelled in ONE place, the terms
 * (`common:terms.section` / `terms.sections`, read through `useTerms()`). Nothing else may type it: not the
 * catalogue values, not a string or JSX text in the section screens. The word reaches a string only as `{{section}}`.
 */
const WORD = /\b(sections?|bagian)\b/i;
const strip = (s: string) => s.replace(/\{\{[^}]*\}\}/g, '');

function values(o: unknown, out: string[] = []): string[] {
  if (typeof o === 'string') out.push(o);
  else if (o && typeof o === 'object') for (const v of Object.values(o)) values(v, out);
  return out;
}

describe('the section term', () => {
  it('has English and Bahasa defaults in the shared terms', () => {
    expect(enCommon.terms.section).toBe('Section');
    expect(enCommon.terms.sections).toBe('Sections');
    expect(idCommon.terms.section).toBe('Bagian');
    expect(idCommon.terms.sections).toBe('Bagian');
  });

  it('no catalogue value of the section screens types the word', () => {
    for (const v of [...values(en), ...values(id)]) expect(strip(v), v).not.toMatch(WORD);
  });

  it('no string literal or JSX text in the section screens types the word', () => {
    const dir = resolve(__dirname, '../../../../pages/work-order-detail');
    const files = readdirSync(dir).filter((f) => /^Section.*\.tsx$/.test(f) && !f.endsWith('.test.tsx'));
    files.push('../../src/lib/workOrderSectionRefusal.ts');
    expect(files.length).toBeGreaterThanOrEqual(4);
    const offenders: string[] = [];
    for (const f of files) {
      const path = join(dir, f);
      const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node) => {
        if ((ts.isStringLiteralLike(n) || ts.isJsxText(n)) && WORD.test(strip(n.text))) {
          // A module path, a test id and a translation key are code, not words a person reads.
          const parent = n.parent;
          const isModule = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
          const isIdentifier = /^[A-Za-z0-9_:.-]+$/.test(n.text.trim()) && !/^[A-Z]/.test(n.text.trim());
          if (!isModule && !isIdentifier) offenders.push(`${f}: ${n.text.trim().slice(0, 60)}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });
});
