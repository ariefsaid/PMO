import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TFunction } from 'i18next';
import { recordFolderErrorCopy, recordFolderOutcomeCopy, recordFolderText, type RecordFolderCopyKey } from '../recordFolderCopy';
import { M365_ERROR_CODES } from '../errorCopy';

const RAW = 'RAW-UPSTREAM-MARKER https://tenant.example.invalid/sites/x';
// Identity-with-default translator: proves the English default each literal call site carries.
const tDefault = ((_key: string, def: string) => def) as unknown as TFunction<'recordFolders'>;

const ALL_KEYS: RecordFolderCopyKey[] = [
  'status.linked', 'error.additionalConsent', 'error.notConnected', 'error.access',
  'error.defaultUnset', 'error.missingIdentifier', 'error.ambiguous', 'error.generic',
];

function flatten(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]);
}
const catalogue = (lng: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../public/locales/${lng}/recordFolders.json`), 'utf8'));

describe('AC-M365DOC-071 — record folder copy map', () => {
  it('maps every stable wire code to reviewed copy, never to the error message', () => {
    for (const code of M365_ERROR_CODES) {
      const copy = recordFolderErrorCopy(Object.assign(new Error(RAW), { code }));
      expect(ALL_KEYS).toContain(copy.key);
      expect(recordFolderText(tDefault, copy.key)).not.toContain('RAW-UPSTREAM');
      expect(copy.ok).toBe(false);
    }
  });

  it('SCOPE_INSUFFICIENT is the additional-consent copy with a reconnect remedy', () => {
    const copy = recordFolderErrorCopy({ code: 'SCOPE_INSUFFICIENT' });
    expect(copy).toEqual({ key: 'error.additionalConsent', remedy: 'reconnect', ok: false });
    expect(recordFolderText(tDefault, copy.key)).toBe(
      'The connection needs additional permissions. Ask your Microsoft admin to approve them, then reconnect.');
  });

  it('access copy never promises that reconnecting fixes access', () => {
    const copy = recordFolderErrorCopy({ code: 'FORBIDDEN' });
    expect(copy.remedy).toBe('contactAdmin');
    expect(recordFolderText(tDefault, copy.key)).toBe(
      'Access depends on your Microsoft permissions. Ask your Microsoft admin to check folder creation access.');
  });

  it.each(['GRAPH_ERROR', 'INTERNAL_ERROR', 'external-unreachable', 'BAD_REQUEST', 'WHATEVER', undefined])(
    'an opaque failure (%s) is the generic copy with no licence/access diagnosis',
    (code) => {
      const copy = recordFolderErrorCopy(Object.assign(new Error(RAW), { code }));
      expect(copy.key).toBe('error.generic');
      const text = recordFolderText(tDefault, copy.key);
      expect(text).not.toMatch(/licen[sc]e|permission|not found/i);
      expect(text).not.toContain('RAW');
    },
  );

  it('handles non-error throwables', () => {
    expect(recordFolderErrorCopy(null).key).toBe('error.generic');
    expect(recordFolderErrorCopy('boom').key).toBe('error.generic');
  });

  it('maps domain outcomes to their reviewed copy and remedy', () => {
    expect(recordFolderOutcomeCopy({ state: 'linked', document_id: 'd' })).toMatchObject({ key: 'status.linked', ok: true });
    expect(recordFolderOutcomeCopy({ state: 'created', document_id: 'd' }).ok).toBe(true);
    expect(recordFolderOutcomeCopy({ state: 'already_linked', document_id: 'd' }).ok).toBe(true);
    expect(recordFolderOutcomeCopy({ state: 'needs_choice' })).toEqual({ key: 'error.ambiguous', remedy: 'chooseExisting', ok: false });
    expect(recordFolderText(tDefault, recordFolderOutcomeCopy({ state: 'default_unset' }).key))
      .toBe('Ask an Admin to choose the default document library.');
    expect(recordFolderText(tDefault, recordFolderOutcomeCopy({ state: 'missing_identifier' }).key))
      .toBe("Add the record's code, then try again.");
  });

  it('an unknown or internal outcome is the generic failure, not a success', () => {
    expect(recordFolderOutcomeCopy({ state: 'not_found' } as never).ok).toBe(false);
    expect(recordFolderOutcomeCopy({ state: 'surprise' } as never).key).toBe('error.generic');
    expect(recordFolderOutcomeCopy(undefined as never).key).toBe('error.generic');
  });

  it('en and id catalogues have identical key trees and every copy key exists with the reviewed English', () => {
    const en = catalogue('en');
    const id = catalogue('id');
    expect(flatten(id).sort()).toEqual(flatten(en).sort());
    for (const key of ALL_KEYS) {
      const [a, b] = key.split('.');
      expect(en[a][b]).toBe(recordFolderText(tDefault, key));
      expect(id[a][b]).toBeTruthy();
    }
    for (const required of ['action.create', 'action.choose', 'action.reconnect', 'status.pending', 'status.savedNotLinked',
      'backfill.start', 'backfill.stop', 'backfill.continue', 'backfill.progress', 'backfill.summary']) {
      expect(flatten(en)).toContain(required);
    }
  });

  it('keeps count variables in both locales', () => {
    for (const lng of ['en', 'id']) {
      const summary: string = catalogue(lng).backfill.summary;
      for (const v of ['linked', 'needsChoice', 'missing', 'failed', 'skipped']) expect(summary).toContain(`{{${v}}}`);
    }
  });
});
