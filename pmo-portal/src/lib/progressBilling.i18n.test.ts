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
const billing = (catalogue: unknown) => leaves(((catalogue as Tree).projectDetail as Tree).billing as Tree);
const SCREENS = [
  'pages/project-detail/tabs/BillingTab.tsx',
  'pages/project-detail/BoqItemFormModal.tsx',
  'pages/project-detail/ProgressClaimModal.tsx',
  'pages/project-detail/ProgressAssessmentModal.tsx',
  'pages/project-detail/ClaimEvidenceModal.tsx',
];

describe('progress billing strings', () => {
  it('AC-PB-014 every billing key exists, non-empty, in English and Indonesian', () => {
    const english = billing(en);
    const indonesian = billing(id);
    expect(Object.keys(indonesian).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of [...Object.entries(english), ...Object.entries(indonesian)]) {
      expect(value.trim(), key).not.toBe('');
    }
    expect(((en as unknown as Tree).projectDetail as Tree).tabs).toHaveProperty('billing');
    expect(((id as unknown as Tree).projectDetail as Tree).tabs).toHaveProperty('billing');
  });

  it('AC-PB-014 every key the billing screens use is in the catalogue', () => {
    const english = billing(en);
    const used = SCREENS.flatMap((file) => [...readFileSync(join(process.cwd(), file), 'utf8')
      .matchAll(/'projectDetail\.billing\.([A-Za-z.]+)'/g)].map((match) => match[1]));
    expect(used.length).toBeGreaterThan(80);
    expect(used.filter((key) => !(key in english))).toEqual([]);
  });
});
