import { describe, it, expect } from 'vitest';
import { upgradeNotes, assertNoBinary } from './meetingNotes';
import { notesToText } from '@/test/meetingNotes';

describe('upgradeNotes (one-way v1 → BlockNote)', () => {
  it('AC-MTG-201 maps every v1 line to a paragraph with the same text — no data loss', () => {
    const v1 = [
      { type: 'p', text: 'Kickoff' },
      { type: 'p', text: '' },
      { type: 'p', text: 'Agreed crane schedule — “quoted” & <b>' },
      'a bare string line',
      { type: 'p' },
    ];
    const out = upgradeNotes(v1, 1);
    expect(out).toHaveLength(5);
    expect(out.every((b) => b.type === 'paragraph')).toBe(true);
    expect(notesToText(out)).toEqual([
      'Kickoff',
      '',
      'Agreed crane schedule — “quoted” & <b>',
      'a bare string line',
      '',
    ]);
    // text is carried as a plain text run (content array), never dropped
    expect((out[0] as { content: unknown }).content).toEqual([{ type: 'text', text: 'Kickoff', styles: {} }]);
  });

  it('AC-MTG-201 is idempotent on a v2 document and never mutates it', () => {
    const v2 = [
      {
        id: 'a',
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: 'Title', styles: {} }],
        children: [],
      },
    ];
    expect(upgradeNotes(v2, 2)).toEqual(v2);
    const once = upgradeNotes([{ type: 'p', text: 'x' }], 1);
    expect(upgradeNotes(once, 2)).toEqual(once);
  });

  it('upgrades by shape when the version is unknown, and treats non-arrays as empty', () => {
    expect(upgradeNotes([{ type: 'p', text: 'x' }])).toHaveLength(1);
    expect(upgradeNotes(null as never)).toEqual([]);
    expect(upgradeNotes({} as never)).toEqual([]);
    expect(upgradeNotes([])).toEqual([]);
  });
});

// (actionItemTaskIds describe removed, #1710 — the helper had no production caller. AC-MTG-006
// lives at src/components/meetings/minutesSchema.test.ts (the shipped schema makes a pasted block
// another reference to the same task); AC-MTG-008's empty-taskId oracle lives at
// src/components/meetings/ActionItemView.test.tsx (tombstone, no lookup, no write).)

describe('assertNoBinary', () => {
  it('AC-MTG-026 rejects any data: URI anywhere in the document', () => {
    expect(() =>
      assertNoBinary([{ type: 'image', props: { url: 'data:image/png;base64,AAAA' } }]),
    ).toThrow(/binary/i);
    expect(() =>
      assertNoBinary([{ type: 'paragraph', content: [{ type: 'link', href: 'data:text/html,x' }] }]),
    ).toThrow(/binary/i);
  });
  it('allows ordinary https links and text mentioning data:', () => {
    expect(() =>
      assertNoBinary([
        { type: 'paragraph', content: [{ type: 'text', text: 'see data: here', styles: {} }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Data: 40 samples collected', styles: {} }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'data:\n  rows: 3', styles: {} }] },
        { type: 'paragraph', content: [{ type: 'link', href: 'https://example.com', content: [] }] },
      ]),
    ).not.toThrow();
  });
});
