import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';
import tabsEn from '../../public/locales/en/projectTabs.json';
import tabsId from '../../public/locales/id/projectTabs.json';

type Tree = { [key: string]: string | Tree };
const leaves = (tree: Tree, prefix = ''): Record<string, string> => Object.fromEntries(
  Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string'
    ? [[`${prefix}${key}`, value]]
    : Object.entries(leaves(value, `${prefix}${key}.`)))),
);
const billing = (catalogue: unknown) => leaves(((catalogue as Tree).projectDetail as Tree).billing as Tree);
// ADR-0090 strings live in the projectTabs namespace (new `common` keys are refused by check:i18n).
const quantities = (catalogue: unknown) => leaves((catalogue as Tree).contractQuantities as Tree);
const KEY = /'projectTabs:contractQuantities\.([A-Za-z.]+)'/g;
const usedQuantityKeys = (files: string[]) =>
  files.flatMap((file) => [...readFileSync(join(process.cwd(), file), 'utf8').matchAll(KEY)].map((match) => match[1]));
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

  it('AC-CQ-019 every contract-quantity key — basis, quantities, BAST, closing value — exists, non-empty, in English and Indonesian', () => {
    const english = quantities(tabsEn);
    const indonesian = quantities(tabsId);
    expect(Object.keys(indonesian).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of [...Object.entries(english), ...Object.entries(indonesian)]) {
      expect(value.trim(), key).not.toBe('');
    }
    for (const prefix of ['billing.boq.', 'billing.boqForm.', 'workOrders.contractLines.', 'workOrders.acceptances.', 'workOrders.quantities.', 'workOrders.closing.']) {
      expect(Object.keys(english).filter((key) => key.startsWith(prefix)).length, prefix).toBeGreaterThan(0);
    }
  });

  it('AC-CQ-019 every key the contract-quantity screens use is in the catalogue, in both languages', () => {
    const english = quantities(tabsEn);
    const indonesian = quantities(tabsId);
    const used = usedQuantityKeys([...SCREENS, ...WORK_ORDER_SCREENS]);
    expect(used.length).toBeGreaterThan(100);
    expect(used.filter((key) => !(key in english))).toEqual([]);
    expect(used.filter((key) => !(key in indonesian))).toEqual([]);
    // …and nothing in the namespace is orphaned: a key no screen uses is a translation nobody sees.
    const usedSet = new Set(used);
    expect(Object.keys(english).filter((key) => !usedSet.has(key))).toEqual([]);
  });

  it('AC-CQ-019 the Indonesian text is translated, not the English default', () => {
    const english = quantities(tabsEn);
    const indonesian = quantities(tabsId);
    const sameAsEnglish = Object.keys(english).filter((key) => english[key] === indonesian[key]);
    // Words that are the same in both languages (loanwords/abbreviations) — an explicit, reviewed list.
    expect(sameAsEnglish.sort()).toEqual([
      'billing.boq.lumpSum',
      'workOrders.acceptances.final',
      'workOrders.acceptances.status.draft',
    ]);
  });
});
