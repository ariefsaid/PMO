import { describe, it, expect } from 'vitest';
import { upgradeNotes, assertNoBinary, actionItemTaskIds, notesToText } from './meetingNotes';

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

describe('actionItemTaskIds / paste', () => {
  const doc = [
    { id: '1', type: 'actionItem', props: { taskId: 't1' }, children: [] },
    {
      id: '2',
      type: 'paragraph',
      content: [],
      children: [{ id: '3', type: 'actionItem', props: { taskId: 't1' }, children: [] }],
    },
    { id: '4', type: 'actionItem', props: { taskId: '' }, children: [] },
  ];
  it('AC-MTG-006 two blocks referencing one task are two references to the same id', () => {
    expect(actionItemTaskIds(doc)).toEqual(['t1', 't1']);
  });
  it('AC-MTG-008 an empty taskId is a reference to no live task and is not listed', () => {
    expect(actionItemTaskIds(doc)).not.toContain('');
  });
});

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
        { type: 'paragraph', content: [{ type: 'link', href: 'https://example.com', content: [] }] },
      ]),
    ).not.toThrow();
  });
});
