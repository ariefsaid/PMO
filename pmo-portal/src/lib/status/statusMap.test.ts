import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  STATUS_MAP,
  STATUS_RECORDS,
  statusLabel,
  statusTone,
  statusVariantOf,
  toneVariant,
  type StatusRecord,
  type StatusTone,
} from './statusMap';

const TONES: StatusTone[] = ['neutral', 'waiting', 'exception', 'done'];
const echo = (_key: string, fallback: string) => fallback;
const catalogue = (lng: 'en' | 'id') =>
  JSON.parse(readFileSync(`public/locales/${lng}/status.json`, 'utf8')) as Record<string, Record<string, string>>;

describe('status map', () => {
  it('every state has a tone from the four-tone set and a non-empty label', () => {
    for (const record of STATUS_RECORDS) {
      for (const state of Object.keys(STATUS_MAP[record])) {
        expect(TONES, `${record}.${state}`).toContain(statusTone(record, state));
        expect(statusLabel(record, state, echo).length, `${record}.${state}`).toBeGreaterThan(0);
      }
    }
  });

  it('returned work waits on the submitter; terminal rejections and errors are exceptions', () => {
    for (const record of ['procurement', 'expense', 'timesheet', 'equipmentUsage'] as const) {
      expect(statusTone(record, 'Rejected')).toBe('waiting');
    }
    expect(statusTone('imprest', 'Rejected')).toBe('exception');
    expect(statusTone('costVariation', 'Rejected')).toBe('exception');
    expect(statusTone('salesInvoice', 'Overdue')).toBe('exception');
    expect(statusTone('due', 'overdue')).toBe('exception');
    expect(statusTone('push', 'failed')).toBe('exception');
    expect(statusTone('budgetHealth', 'over-budget')).toBe('exception');
    expect(statusTone('expense', 'Paid')).toBe('done');
    expect(statusTone('task', 'Done')).toBe('done');
  });

  it('waiting on someone is amber: submitted work and held pushes', () => {
    expect(statusTone('expense', 'Submitted')).toBe('waiting');
    expect(statusTone('timesheet', 'Submitted')).toBe('waiting');
    expect(statusTone('push', 'held')).toBe('waiting');
    expect(statusTone('due', 'due-soon')).toBe('waiting');
  });

  it('the same state reads the same on every screen: one tone per shared state word', () => {
    // Draft is grey everywhere, Cancelled is grey everywhere, Paid is green everywhere.
    for (const record of STATUS_RECORDS) {
      const states = STATUS_MAP[record] as Record<string, { tone: StatusTone }>;
      if (states.Draft) expect(states.Draft.tone, `${record}.Draft`).toBe('neutral');
      if (states.Cancelled) expect(states.Cancelled.tone, `${record}.Cancelled`).toBe('neutral');
      if (states.Paid) expect(states.Paid.tone, `${record}.Paid`).toBe('done');
      if (states.Rejected) {
        const isReturned = ['procurement', 'expense', 'timesheet', 'equipmentUsage'].includes(record);
        expect(states.Rejected.tone, `${record}.Rejected`).toBe(isReturned ? 'waiting' : 'exception');
      }
      if (states.Approved) expect(states.Approved.tone, `${record}.Approved`).toBe('done');
    }
  });

  it('one name per state per record type: no two states of a record share a label', () => {
    for (const record of STATUS_RECORDS) {
      const byLabel = new Map<string, string>();
      for (const state of Object.keys(STATUS_MAP[record])) {
        const label = statusLabel(record, state, echo);
        const clash = byLabel.get(label);
        // A receipt's stored "Paid" and "Received" are the same state under two spellings.
        if (clash && !(record === 'receipt' && label === 'Received')) throw new Error(`${record}: "${label}" names ${clash} and ${state}`);
        byLabel.set(label, state);
      }
    }
  });

  it('tone maps onto the existing StatusPill variants and never onto the action blue', () => {
    expect(TONES.map(toneVariant)).toEqual(['neutral', 'warn', 'lost', 'won']);
    expect(statusVariantOf('task', 'Blocked')).toBe('lost');
    expect(statusVariantOf('task', 'In Progress')).toBe('neutral');
  });

  it('an unknown state is neutral and reads as its stored text, even for prototype keys', () => {
    expect(statusTone('expense', 'Mystery')).toBe('neutral');
    expect(statusLabel('expense', 'Mystery', echo)).toBe('Mystery');
    expect(statusTone('expense', 'constructor')).toBe('neutral');
    expect(statusLabel('expense', 'toString', echo)).toBe('toString');
  });

  it('the purchase state has one name where the app used five', () => {
    expect(statusLabel('procurement', 'Requested', echo)).toBe('Requested');
    expect(statusLabel('procurement', 'Ordered', echo)).toBe('Purchase order');
  });

  it('names reversible decisions Returned and keeps terminal top-ups Rejected', () => {
    expect(statusLabel('timesheet', 'Rejected', echo)).toBe('Returned');
    expect(statusLabel('expense', 'Rejected', echo)).toBe('Returned');
    expect(statusLabel('equipmentUsage', 'Rejected', echo)).toBe('Returned');
    expect(statusLabel('imprest', 'Rejected', echo)).toBe('Rejected');
  });

  it('uses sentence casing for common task states', () => {
    expect(statusLabel('task', 'To Do', echo)).toBe('To do');
    expect(statusLabel('task', 'In Progress', echo)).toBe('In progress');
  });
});

describe('status catalogues (en + id)', () => {
  const keysOf = (c: Record<string, Record<string, string>>) =>
    Object.entries(c).flatMap(([group, rows]) => Object.keys(rows).map((k) => `${group}.${k}`)).sort();

  it('en and id carry exactly the same keys, none empty', () => {
    expect(keysOf(catalogue('id'))).toEqual(keysOf(catalogue('en')));
    for (const lng of ['en', 'id'] as const) {
      for (const [group, rows] of Object.entries(catalogue(lng))) {
        for (const [k, v] of Object.entries(rows)) expect(v.trim().length, `${lng} ${group}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('every map label resolves to a catalogue key whose English text is the map default', () => {
    const en = catalogue('en');
    for (const record of STATUS_RECORDS as StatusRecord[]) {
      for (const state of Object.keys(STATUS_MAP[record])) {
        let seenKey = '';
        let seenDefault = '';
        statusLabel(record, state, (key, fallback) => { seenKey = key; seenDefault = fallback; return fallback; });
        const [, group, name] = /^status:([^.]+)\.(.+)$/.exec(seenKey) ?? [];
        expect(group, seenKey).toBe(record);
        expect(en[group]?.[name], seenKey).toBe(seenDefault);
      }
    }
  });
});
