import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../../../public/locales/en/m365Documents.json';
import id from '../../../public/locales/id/m365Documents.json';

// Flatten nested groups (procurement / budget / defaultLibrary / …) to dotted leaf keys.
const flat = (o: unknown, prefix = ''): Record<string, string> =>
  Object.entries(o as Record<string, unknown>).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'object' && v !== null ? { ...acc, ...flat(v, key) } : { ...acc, [key]: String(v) };
  }, {});
const enFlat = flat(en);
const idFlat = flat(id);

const read = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

describe('m365Documents localization (AC-M365DOC-020/064/065/067)', () => {
  it('AC-M365DOC-020: en and id carry the same keys, all non-empty', () => {
    expect(Object.keys(idFlat).sort()).toEqual(Object.keys(enFlat).sort());
    expect(en.procurement.heading).toBe('SharePoint links for this case');
    expect(en.picker.title).toBe('Choose a Microsoft document');
    expect(en.versions.title).toBe('Versions of {{name}}');
    for (const catalogue of [enFlat, idFlat]) {
      for (const value of Object.values(catalogue)) expect(value.trim()).not.toBe('');
    }
  });

  it('AC-M365DOC-020: interpolation placeholders match across locales', () => {
    const placeholders = (v: string) => (v.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const [key, value] of Object.entries(enFlat)) {
      expect(placeholders(idFlat[key]), key).toEqual(placeholders(value));
    }
  });

  it('AC-M365DOC-065: folder / recovery messages are reviewed sentences, never raw codes or tokens', () => {
    expect(en.referenceOnly).toBe('Folder reference — contents are not issued or approved');
    expect(en.unlinkBody).toBe('Only the PMO reference is removed. The Microsoft item is unchanged.');
    for (const value of [...Object.values(enFlat), ...Object.values(idFlat)]) {
      expect(value).not.toMatch(/\b[A-Z]{2,}(?:_[A-Z]{2,})+\b/);
      expect(value).not.toMatch(/\bGRAPH_ERROR\b|\bBearer\b|access_token/i);
    }
  });

  it('AC-M365DOC-064: every project appearance of a reference goes through the shared cell / drift projection', () => {
    const tab = read('pages/project-detail/tabs/DocumentsTab.tsx');
    expect(tab).toMatch(/<LinkedDocumentCell/);
    // Table AND Drawer share one renderer — there is no second, hand-rolled Microsoft cell.
    expect(tab.match(/microsoftCell\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(read('src/components/NewRevisionModal.tsx')).toMatch(/<DocumentDriftBadge/);
  });

  it('AC-M365DOC-067: the money-path evidence predicate is untouched (file_path only)', () => {
    expect(read('pages/project-detail/ClaimEvidenceModal.tsx')).toMatch(/file_path/);
    expect(read('pages/project-detail/ClaimEvidenceModal.tsx')).not.toMatch(/onedrive|ms_item_kind/);
  });
});
