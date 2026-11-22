import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { parseRefusal, refusalText } from './refusals';

/** A catalogue stand-in: `refusals:CODE` → sentence, `{{x}}` filled from options; a missing key returns the default. */
const sentences: Record<string, string> = {
  PCI_CREW: 'You are not in that crew today.',
  ATT_DAY_CEILING: '{{hours}} hours on {{workOrder}}.',
  WOS_ITEM: 'That item cannot be planned',
  WOS_ITEM_detail: 'Choose a live stock item.',
  STK_INSUFFICIENT: 'Not enough stock.',
  STK_INSUFFICIENT_figures: 'Only {{available}} on hand; you asked for {{requested}}.',
};
const t = ((key: string, opts?: Record<string, unknown>) => {
  const raw = sentences[key.replace(/^refusals:/, '')];
  if (raw === undefined) return (opts?.defaultValue as string | undefined) ?? key;
  return raw.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts?.[k] ?? ''));
}) as unknown as TFunction;

describe('parseRefusal', () => {
  it('reads family, code and sentence from FAMILY_CODE: text', () => {
    expect(parseRefusal({ code: '23514', message: 'PCI_CREW: you are not in that crew today' }))
      .toMatchObject({ family: 'PCI', code: 'PCI_CREW', text: 'you are not in that crew today' });
  });
  it('finds the code when the message carries text before it', () => {
    expect(parseRefusal(new Error('failed: CWO_DECIDED: already decided'))?.code).toBe('CWO_DECIDED');
  });
  it('takes figures from a details JSON of strings', () => {
    expect(parseRefusal({ message: 'STK_INSUFFICIENT: x', details: '{"available":"5","requested":"6"}' })?.values)
      .toEqual({ available: '5', requested: '6' });
    expect(parseRefusal({ message: 'STK_INSUFFICIENT: x', details: 'not json' })?.values).toEqual({});
  });
  it('reads a figure out of the sentence for the codes whose migration writes no details', () => {
    expect(parseRefusal({ message: 'ATT_DAY_CEILING: Ana already has 20 hours on WO-1 that day' })?.values)
      .toEqual({ hours: '20', workOrder: 'WO-1' });
  });
  it('is null for anything that is not a refusal', () => {
    expect(parseRefusal({ code: '42501', message: 'permission denied for table x' })).toBeNull();
    expect(parseRefusal({ message: 'Update failed: try later' })).toBeNull();
    expect(parseRefusal(null)).toBeNull();
    expect(parseRefusal('PCI_CREW: x')).toBeNull();
  });
});

describe('refusalText', () => {
  it('is the catalogue sentence for the code, never the server text or the code', () => {
    const r = refusalText({ code: '23514', message: 'PCI_CREW: you are not in that crew today' }, t);
    expect(r).toEqual({ headline: 'You are not in that crew today.', detail: '' });
  });
  it('carries a second line when the code has a _detail entry', () => {
    expect(refusalText({ message: 'WOS_ITEM: the item is not a live stock item' }, t))
      .toEqual({ headline: 'That item cannot be planned', detail: 'Choose a live stock item.' });
  });
  it('fills the figures in', () => {
    expect(refusalText({ message: 'ATT_DAY_CEILING: Ana already has 20 hours on WO-1 that day' }, t).headline).toBe('20 hours on WO-1.');
  });
  it('prefers the _figures sentence when the refusal carries figures', () => {
    expect(refusalText({ message: 'STK_INSUFFICIENT: x', details: '{"available":"5","requested":"6"}' }, t).headline)
      .toBe('Only 5 on hand; you asked for 6.');
    expect(refusalText({ message: 'STK_INSUFFICIENT: x' }, t).headline).toBe('Not enough stock.');
  });
  it('extra values from the caller reach the sentence', () => {
    const t2 = ((k: string, o?: Record<string, unknown>) => `${k}|${String(o?.section)}`) as unknown as TFunction;
    expect(refusalText({ message: 'WOS_ITEM: x' }, t2, { values: { section: 'area' } }).headline).toBe('refusals:WOS_ITEM|area');
  });
  it('a code with no sentence shows the shared classifier headline and never the prefixed text', () => {
    const r = refusalText({ code: 'P0001', message: 'ZZZ_NEW: something raw' }, t, { context: { suppressCapture: true } });
    expect(r.headline).toBe("That move isn't allowed from the current stage.");
    expect(r.detail).toBe('');
  });
  it('a non-refusal error is the classifier headline and detail', () => {
    const r = refusalText({ code: '23505', message: 'duplicate key' }, t, { context: { suppressCapture: true } });
    expect(r).toMatchObject({ headline: 'That already exists.', detail: 'Another record already uses one of these values. Change it and try again.' });
  });
});
