import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const roots = ['pages', 'src'];
function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(tsx|ts)$/.test(file) && !/\.test\./.test(file) && !file.endsWith('.d.ts') ? [file] : [];
  });
}

describe('DataTable saved-width identities', () => {
  it('AC-TBL-RESIZE-002: every production table has a stable, unique page-scoped tableId', () => {
    const identities = new Map<string, string>();
    const missing: string[] = [];
    for (const root of roots) for (const file of sourceFiles(path.resolve(process.cwd(), root))) {
      const text = fs.readFileSync(file, 'utf8');
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'DataTable') {
          const prop = node.attributes.properties.find((attribute): attribute is ts.JsxAttribute =>
            ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'tableId');
          if (!prop?.initializer) {
            missing.push(path.relative(process.cwd(), file));
          } else {
            const identity = prop.initializer.getText(source).replace(/\s+/g, '');
            if (ts.isStringLiteral(prop.initializer)) expect(prop.initializer.text).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
            expect(identities.has(identity), `duplicate tableId ${identity}: ${file} and ${identities.get(identity)}`).toBe(false);
            identities.set(identity, file);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(missing, 'Production DataTable usages must provide a stable tableId').toEqual([]);
    expect(identities.size).toBeGreaterThan(25);
  });
});
