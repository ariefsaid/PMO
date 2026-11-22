/** AC-TX-002/003 (#2712): the 16-term list agrees across its mirrors; each new term rewrites per language; scoped terms stay scoped. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyOrgTerms, SHIPPED_FORMS, TERM_KEYS, TERM_SCOPE, type OrgTerms, type TermKey } from './orgTerms';

const ROOT = resolve(__dirname, '../../../..');
const NEW_KEYS: TermKey[] = ['billOfQuantities', 'contractItem', 'dailyRevenue', 'acceptedQuantity', 'costVariation', 'deliveryNote', 'stockCount', 'imprest', 'standIn', 'progressClaim'];

const quoted = (text: string) => [...text.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);

describe('AC-TX-002 the term list is one list in three places', () => {
  it('has 16 keys, the six existing first', () => {
    expect(TERM_KEYS).toHaveLength(16);
    expect(TERM_KEYS.slice(0, 6)).toEqual(['workOrder', 'project', 'clientSuppliedStock', 'purchaseRequest', 'discipline', 'materialRequest']);
  });
  it('the SQL check lists the same keys', () => {
    const sql = readFileSync(resolve(ROOT, 'supabase/migrations/1230_terminology_expansion.sql'), 'utf8');
    const block = sql.slice(sql.indexOf('check (term_key in ('));
    expect(quoted(block).sort()).toEqual([...TERM_KEYS].sort());
  });
  it('the guard patterns list the same keys', async () => {
    const guard = (await import(/* @vite-ignore */ resolve(ROOT, 'scripts/check-org-terms.mjs'))) as { TERM_PATTERNS: Record<string, RegExp> };
    expect(Object.keys(guard.TERM_PATTERNS).sort()).toEqual([...TERM_KEYS].sort());
  });
  it('every term has shipped forms in both languages', () => {
    for (const key of TERM_KEYS) for (const loc of ['en', 'id'] as const) {
      expect(SHIPPED_FORMS[loc][key].singular.length).toBeGreaterThan(0);
      expect(SHIPPED_FORMS[loc][key].plural.length).toBeGreaterThan(0);
    }
  });
});

const en = (key: TermKey, s: string, p: string): OrgTerms => ({ en: { [key]: { singular: s, plural: p } } });
const id = (key: TermKey, s: string): OrgTerms => ({ id: { [key]: { singular: s, plural: s } } });

describe('AC-TX-003 each new term rewrites its shipped wording', () => {
  // key, English text -> output, English override (singular, plural), Bahasa text -> output, Bahasa override
  const cases: Array<[TermKey, [string, string], [string, string], [string, string], string]> = [
    ['billOfQuantities', ['No bill of quantities yet', 'No schedule of items yet'], ['schedule of items', 'schedules of items'], ['Belum ada bill of quantities', 'Belum ada daftar harga'], 'daftar harga'],
    ['contractItem', ['Contract item', 'Pay item'], ['pay item', 'pay items'], ['Item kontrak', 'Butir bayar'], 'butir bayar'],
    ['dailyRevenue', ['Day revenue', 'Earnings today'], ['earnings today', 'earnings today'], ['Pendapatan hari itu', 'Hasil hari ini'], 'hasil hari ini'],
    ['acceptedQuantity', ['Record accepted quantity', 'Record signed-off quantity'], ['signed-off quantity', 'signed-off quantities'], ['Catat kuantitas diterima', 'Catat jumlah disetujui'], 'jumlah disetujui'],
    ['costVariation', ['No cost variations requested', 'No cost changes requested'], ['cost change', 'cost changes'], ['Belum ada variasi biaya', 'Belum ada perubahan biaya'], 'perubahan biaya'],
    ['deliveryNote', ['Delivery note', 'Waybill'], ['waybill', 'waybills'], ['Surat jalan', 'Slip kirim'], 'slip kirim'],
    ['stockCount', ['Stock count', 'Inventory check'], ['inventory check', 'inventory checks'], ['Stok opname', 'Cek persediaan'], 'cek persediaan'],
    ['imprest', ['Imprest', 'Petty cash'], ['petty cash', 'petty cash'], ['Kas lapangan', 'Kas kecil'], 'kas kecil'],
    ['progressClaim', ['Progress claim created', 'Stage claim created'], ['stage claim', 'stage claims'], ['Klaim progres dibuat', 'Klaim tahap dibuat'], 'klaim tahap'],
  ];
  for (const [key, [enText, enOut], [sing, plur], [idText, idOut], idName] of cases) {
    it(`${key}: English and Bahasa`, () => {
      expect(applyOrgTerms(enText, 'en', en(key, sing, plur))).toBe(enOut);
      expect(applyOrgTerms(idText, 'id', id(key, idName))).toBe(idOut);
    });
  }
  it('plural and case follow the shipped wording', () => {
    expect(applyOrgTerms('3 delivery notes, Delivery Note', 'en', en('deliveryNote', 'waybill', 'waybills'))).toBe('3 waybills, Waybill');
  });
  it('Bahasa override replaces the shipped Bahasa wording only', () => {
    expect(applyOrgTerms('Surat jalan baru', 'id', id('deliveryNote', 'slip kirim'))).toBe('Slip kirim baru');
    expect(applyOrgTerms('Surat jalan baru', 'en', id('deliveryNote', 'slip kirim'))).toBe('Surat jalan baru');
  });
  it('with no override the text is unchanged, and partial words are untouched', () => {
    expect(applyOrgTerms('Delivery note and imprests', 'en', {})).toBe('Delivery note and imprests');
    expect(applyOrgTerms('Imprestation', 'en', en('imprest', 'petty cash', 'petty cash'))).toBe('Imprestation');
  });
});

describe('AC-TX-003 scoped terms (the Bahasa stand-in word is ordinary Indonesian)', () => {
  it('standIn is scoped to the material-request namespace', () => {
    expect(TERM_SCOPE.standIn).toEqual(['materialRequests']);
    for (const key of NEW_KEYS) if (key !== 'standIn') expect(TERM_SCOPE[key]).toBeUndefined();
  });
  const terms = id('standIn', 'wakil');
  it('is rewritten inside its namespace', () => {
    expect(applyOrgTerms('Tambah pengganti', 'id', terms, { namespace: 'materialRequests' })).toBe('Tambah wakil');
  });
  it('is not rewritten in another namespace or outside i18next', () => {
    const text = 'Anggaran pengganti ditahan';
    expect(applyOrgTerms(text, 'id', terms, { namespace: 'notifications' })).toBe(text);
    expect(applyOrgTerms(text, 'id', terms)).toBe(text);
  });
});
