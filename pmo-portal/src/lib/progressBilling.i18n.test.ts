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
const workOrders = (catalogue: unknown) => leaves(((catalogue as Tree).projectDetail as Tree).workOrders as Tree);
const WORK_ORDER_SCREENS = [
  'pages/project-detail/tabs/WorkOrdersTab.tsx',
  'pages/project-detail/WorkOrderLinesModal.tsx',
  'pages/project-detail/WorkOrderAcceptanceModal.tsx',
  'pages/project-detail/WorkOrderAcceptances.tsx',
];
const SCREENS = [
  'pages/project-detail/tabs/BillingTab.tsx',
  'pages/project-detail/BoqItemFormModal.tsx',
  'pages/project-detail/ProgressClaimModal.tsx',
  'pages/project-detail/ProgressAssessmentModal.tsx',
  'pages/project-detail/ClaimEvidenceModal.tsx',
  'pages/project-detail/WorkOrderAcceptanceModal.tsx',
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

  it('AC-CQ-019 every work order key — contract lines, BAST, closing value — exists, non-empty, in English and Indonesian', () => {
    const english = workOrders(en);
    const indonesian = workOrders(id);
    expect(Object.keys(indonesian).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of [...Object.entries(english), ...Object.entries(indonesian)]) {
      expect(value.trim(), key).not.toBe('');
    }
    for (const prefix of ['contractLines.', 'acceptances.', 'quantities.', 'closing.']) {
      expect(Object.keys(english).filter((key) => key.startsWith(prefix)).length, prefix).toBeGreaterThan(0);
    }
  });

  it('AC-CQ-019 every key the work order screens use is in the catalogue, in both languages', () => {
    const english = workOrders(en);
    const indonesian = workOrders(id);
    const used = WORK_ORDER_SCREENS.flatMap((file) => [...readFileSync(join(process.cwd(), file), 'utf8')
      .matchAll(/'projectDetail\.workOrders\.([A-Za-z.]+)'/g)].map((match) => match[1]));
    expect(used.length).toBeGreaterThan(60);
    expect(used.filter((key) => !(key in english))).toEqual([]);
    expect(used.filter((key) => !(key in indonesian))).toEqual([]);
  });

  it('AC-CQ-019 the Indonesian text is translated, not the English default', () => {
    const english = { ...billing(en), ...Object.fromEntries(Object.entries(workOrders(en)).map(([k, v]) => [`wo.${k}`, v])) };
    const indonesian = { ...billing(id), ...Object.fromEntries(Object.entries(workOrders(id)).map(([k, v]) => [`wo.${k}`, v])) };
    const same = ['boqForm.basis', 'contractLines.title', 'acceptances.form.titleNew', 'closing.dpHeld', 'quantities.title']
      .map((key) => (key.startsWith('boqForm') ? key : `wo.${key}`))
      .filter((key) => key in english && english[key] === indonesian[key]);
    expect(same).toEqual([]);
  });
});
