import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';

type Tree = { [key: string]: string | Tree };
const leaves = (tree: Tree, prefix = ''): Record<string, string> => Object.fromEntries(
  Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string'
    ? [[`${prefix}${key}`, value]]
    : Object.entries(leaves(value, `${prefix}${key}.`)))),
);
const subtree = (catalogue: unknown, path: string[]): Record<string, string> =>
  leaves(path.reduce((node, key) => (node as Tree)[key] as Tree, catalogue as Tree) as Tree);
const AREAS: Array<{ path: string[]; prefix: string; files: string[]; minUses: number }> = [
  { path: ['projectDetail', 'workOrders', 'billing'], prefix: 'projectDetail.workOrders.billing.', minUses: 20,
    files: ['pages/project-detail/tabs/WorkOrdersTab.tsx', 'pages/project-detail/InvoiceWorkOrderModal.tsx'] },
  { path: ['dashboard', 'stillToInvoice'], prefix: 'dashboard.stillToInvoice.', minUses: 5,
    files: ['src/components/dashboard/StillToInvoiceCard.tsx'] },
];

describe('work-order billing strings (OD-BILL-1)', () => {
  it('AC-BWO-006 every key exists, non-empty, in English and Indonesian', () => {
    for (const area of AREAS) {
      const english = subtree(en, area.path);
      const indonesian = subtree(id, area.path);
      expect(Object.keys(indonesian).sort()).toEqual(Object.keys(english).sort());
      for (const [key, value] of [...Object.entries(english), ...Object.entries(indonesian)]) {
        expect(value.trim(), key).not.toBe('');
      }
    }
  });
  it('AC-BWO-006 every key the new screens use is in the catalogue', () => {
    for (const area of AREAS) {
      const english = subtree(en, area.path);
      const escaped = area.prefix.replace(/\./g, '\\.');
      const used = area.files.flatMap((file) => [...readFileSync(join(process.cwd(), file), 'utf8')
        .matchAll(new RegExp(`'${escaped}([A-Za-z.]+)'`, 'g'))].map((m) => m[1]));
      expect(used.length).toBeGreaterThan(area.minUses);
      expect(used.filter((key) => !(key in english))).toEqual([]);
    }
  });
});
