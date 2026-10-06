import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const load = (lng: 'en' | 'id') =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../public/locales/${lng}/common.json`, import.meta.url)), 'utf-8'));
const get = (obj: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);

const KEYS = [
  'shell.nav.managementPack',
  'managementPack.title', 'managementPack.description', 'managementPack.from', 'managementPack.asAt',
  'managementPack.exportCsv', 'managementPack.exportXlsx', 'managementPack.noAccessTitle', 'managementPack.noAccessSub',
  'managementPack.errorTitle', 'managementPack.errorSub', 'managementPack.invalidRange', 'managementPack.emptyTitle',
  'managementPack.emptySub', 'managementPack.projectsAsAt', 'managementPack.monthlyTotals', 'managementPack.unassigned',
  'managementPack.otherCurrency', 'managementPack.recordProgress', 'managementPack.billedAhead', 'managementPack.undated',
  'managementPack.total', 'managementPack.basis.invoiced', 'managementPack.basis.progress', 'managementPack.basis.progressShort',
  'managementPack.col.month', 'managementPack.col.projectNumber', 'managementPack.col.project', 'managementPack.col.client',
  'managementPack.col.currency', 'managementPack.col.taxBasis', 'managementPack.col.contract', 'managementPack.col.planned',
  'managementPack.col.recognised', 'managementPack.col.invoiced', 'managementPack.col.recognisedToDate',
  'managementPack.col.invoicedToDate', 'managementPack.col.unbilled', 'managementPack.col.backlog', 'managementPack.col.basis',
  'managementPack.progressModal.title', 'managementPack.progressModal.month', 'managementPack.progressModal.monthInvalid',
  'managementPack.progressModal.pct', 'managementPack.progressModal.pctHelper', 'managementPack.progressModal.pctInvalid',
  'managementPack.progressModal.note', 'managementPack.progressModal.save', 'managementPack.progressModal.saved',
];

describe('AC-MMP-017 management pack catalogue', () => {
  for (const lng of ['en', 'id'] as const) {
    it(`AC-MMP-017: every management pack key has non-empty ${lng} copy`, () => {
      const cat = load(lng);
      const missing = KEYS.filter((k) => typeof get(cat, k) !== 'string' || !(get(cat, k) as string).trim());
      expect(missing).toEqual([]);
    });
  }
});
