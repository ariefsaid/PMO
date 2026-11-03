import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ODOO_REVENUE_ANCHOR_VERDICT } from '../__fixtures__/revenue.ts';
import { anchorMemo, externalIdentifier, ODOO_REVENUE_ANCHORS, REVENUE_KEY_RE } from './anchors.ts';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

it('AC-OCI-011 derives a safe external identifier per kind from a validated key', () => {
  expect(externalIdentifier(`si:${UUID}`)).toEqual({ module: 'pmo', name: 'si_123e4567_e89b_12d3_a456_426614174000' });
  expect(externalIdentifier(`ip:${UUID}`)).toEqual({ module: 'pmo', name: 'ip_123e4567_e89b_12d3_a456_426614174000' });
  expect(anchorMemo(`ip:${UUID}`)).toBe(`pmo:ip:${UUID}`);
  for (const bad of ['si:bad', `po:${UUID}`, `si:${UUID}:1`, '', `si:${UUID}; drop`]) {
    expect(REVENUE_KEY_RE.test(bad), bad).toBe(false);
    expect(() => externalIdentifier(bad), bad).toThrow();
  }
});

it('AC-OCI-011 no anchor is a business field; the table matches the C0 verdict', () => {
  for (const kind of ['sales-invoice', 'incoming-payment'] as const) {
    const anchor = ODOO_REVENUE_ANCHORS[kind];
    expect(anchor.model, kind).toBe('ir.model.data');
    expect(anchor.mutable, kind).toBe(false);
    expect(anchor.probe, kind).toBe('composite-hold-on-doubt');
    expect(anchor, kind).not.toHaveProperty('field');   // a field anchor would be a business field the user can edit
  }
  expect(ODOO_REVENUE_ANCHORS['sales-invoice'].primary).toBe(ODOO_REVENUE_ANCHOR_VERDICT.invoice.primary);
  expect(ODOO_REVENUE_ANCHORS['incoming-payment'].primary).toBe(ODOO_REVENUE_ANCHOR_VERDICT.payment.primary);
  // The memo is a secondary trace on the payment only.
  expect(ODOO_REVENUE_ANCHORS['incoming-payment'].secondary).toEqual({ model: 'account.payment', field: 'memo' });
  expect(ODOO_REVENUE_ANCHORS['sales-invoice'].secondary).toBeNull();
});

it('AC-OCI-011 every anchor is read through the table: no other revenue file names the anchor model or field', () => {
  const dir = new URL('.', import.meta.url).pathname;
  const others = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'anchors.ts');
  for (const f of others) {
    const src = readFileSync(`${dir}${f}`, 'utf8');
    expect(src, f).not.toMatch(/ir\.model\.data/);
    expect(src, f).not.toMatch(/['"`]memo['"`]/);
  }
});
