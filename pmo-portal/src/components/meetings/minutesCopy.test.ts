import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const load = (lng: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../public/locales/${lng}/common.json`), 'utf8')).meetingDetail;
const en = load('en');
const id = load('id');

const strings = (o: unknown): string[] =>
  typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : [];

describe('meeting minutes copy', () => {
  // Action items now come from typing /action, not from an "Action" control on a line.
  it('AC-MTG-060 the empty action-items copy tells people to type /action (en)', () => {
    expect(en.actionItems.empty).toContain('/action');
    expect(en.actionItems.empty).not.toMatch(/Use Action on/i);
  });

  it('AC-MTG-060 the empty action-items copy tells people to type /action (id)', () => {
    expect(id.actionItems.empty).toContain('/action');
    expect(id.actionItems.empty).not.toMatch(/Gunakan Action/i);
  });

  it('AC-MTG-060 /action finds the entry in Bahasa as well (the alias the copy names is real)', () => {
    expect(id.minutes.slash.actionAliases.split(',').map((a: string) => a.trim())).toContain('action');
    expect(en.minutes.slash.actionAliases.split(',').map((a: string) => a.trim())).toContain('action');
  });

  // One Bahasa term: the section heading, the slash entry, the modal and the toast all say "Action item".
  it('AC-MTG-025 Bahasa uses ONE term for an action item — the slash entry matches the section heading', () => {
    expect(id.minutes.slash.actionTitle).toBe(id.actionItems.title);
    expect(id.minutes.slash.actionTitle).toBe('Action item');
  });

  it('AC-MTG-025 no Bahasa meeting string calls an action item "butir tindakan"', () => {
    const offenders = strings(id).filter((s) => /butir tindakan/i.test(s));
    expect(offenders).toEqual([]);
  });
});
