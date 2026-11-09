import { describe, expect, it } from 'vitest';
import {
  keyFromLabourExternalIdentifier, labourCostKey, labourExternalIdentifier, labourLineKey, parseLabourLineKey,
} from './anchors.ts';

const SHEET = '15100000-0000-4000-8000-000000000001';
const PROJECT = '15100000-0000-4000-8000-000000000002';
const BATCH = '15100000-0000-4000-8000-000000000003';

describe('odoo/labour/anchors — AC-OLH-022 one immutable identifier per (sheet, project, day)', () => {
  it('AC-OLH-022 the line key is the triple, and a bad uuid or a day that does not exist throws', () => {
    expect(labourLineKey(SHEET, PROJECT, '2026-11-02')).toBe(`lbl:${SHEET}:${PROJECT}:20261102`);
    expect(() => labourLineKey('sheet-1', PROJECT, '2026-11-02')).toThrow();
    expect(() => labourLineKey(SHEET, 'not-a-uuid', '2026-11-02')).toThrow();
    expect(() => labourLineKey(SHEET, PROJECT, '2 Nov')).toThrow();
    expect(() => labourLineKey(SHEET, PROJECT, '2026-02-30')).toThrow();
  });

  it('AC-OLH-022 the external identifier is Odoo-safe: no colon, no dash, and lossless back to the key', () => {
    const key = labourLineKey(SHEET, PROJECT, '2026-11-02');
    const { module, name } = labourExternalIdentifier(key);
    expect(module).toBe('pmo');
    expect(name).not.toContain(':');
    expect(name).not.toContain('-');
    expect(name).toBe(`lbl_${SHEET.replace(/-/g, '_')}_${PROJECT.replace(/-/g, '_')}_20261102`);
    expect(parseLabourLineKey(name)).toBe(key);
  });

  it('AC-OLH-022 the cost key is the batch revision, and a revision below one throws', () => {
    expect(labourCostKey(BATCH, 3)).toBe(`lcost:${BATCH}:3`);
    expect(() => labourCostKey(BATCH, 0)).toThrow();
    expect(() => labourCostKey(BATCH, 1.5)).toThrow();
    expect(() => labourCostKey('nope', 1)).toThrow();
    expect(keyFromLabourExternalIdentifier(labourExternalIdentifier(labourCostKey(BATCH, 12)).name)).toBe(`lcost:${BATCH}:12`);
  });

  it('AC-OLH-022 no cross-family adoption: a purchase identifier and garbage are both null', () => {
    expect(parseLabourLineKey('po_15100000_0000_4000_8000_000000000001')).toBeNull();
    expect(parseLabourLineKey('garbage')).toBeNull();
    expect(parseLabourLineKey('lbl_15100000_0000_4000_8000_000000000001_20261102')).toBeNull();
    expect(keyFromLabourExternalIdentifier('po_15100000_0000_4000_8000_000000000001')).toBeNull();
    expect(keyFromLabourExternalIdentifier('')).toBeNull();
    expect(() => labourExternalIdentifier('po:15100000-0000-4000-8000-000000000001')).toThrow();
  });
});
