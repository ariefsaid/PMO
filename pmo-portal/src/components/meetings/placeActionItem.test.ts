import { describe, it, expect } from 'vitest';
import { BlockNoteEditor } from '@blocknote/core';
import { minutesSchema } from './minutesSchema';
import { placeActionItem } from './placeActionItem';

const make = (blocks: Array<Record<string, unknown>>) => {
  const e = BlockNoteEditor.create({ schema: minutesSchema });
  e.replaceBlocks(e.document, blocks as never);
  return e;
};
const shape = (e: ReturnType<typeof make>) =>
  e.document.map((b) => [b.type, b.type === 'actionItem' ? (b.props as { taskId: string }).taskId : (b.content as Array<{ text: string }>).map((r) => r.text).join('')]);

describe('placeActionItem — /action replaces the line it was invoked on (no duplicated text)', () => {
  it('AC-MTG-060 a line WITH text is REPLACED by the action-item block — the text is not repeated', () => {
    const e = make([
      { type: 'paragraph', content: 'Agenda' },
      { type: 'paragraph', content: 'Confirm crane schedule' },
      { type: 'paragraph', content: 'AOB' },
    ]);
    placeActionItem(e, e.document[1].id, 'task-1');
    expect(shape(e)).toEqual([
      ['paragraph', 'Agenda'],
      ['actionItem', 'task-1'],
      ['paragraph', 'AOB'],
    ]);
  });

  it('AC-MTG-060 an EMPTY line becomes the block in place (no stray blank line left behind)', () => {
    const e = make([
      { type: 'paragraph', content: 'Agenda' },
      { type: 'paragraph' },
    ]);
    placeActionItem(e, e.document[1].id, 'task-2');
    expect(shape(e)).toEqual([
      ['paragraph', 'Agenda'],
      ['actionItem', 'task-2'],
    ]);
  });

  it('AC-MTG-060 a text line of another block type (a bullet) is replaced too', () => {
    const e = make([{ type: 'bulletListItem', content: 'Chase the permit' }]);
    placeActionItem(e, e.document[0].id, 'task-3');
    expect(shape(e)).toEqual([['actionItem', 'task-3']]);
  });

  it('with no remembered line (it was deleted while the modal was open) the block goes at the end', () => {
    const e = make([{ type: 'paragraph', content: 'Agenda' }]);
    placeActionItem(e, 'gone', 'task-4');
    expect(shape(e)).toEqual([
      ['paragraph', 'Agenda'],
      ['actionItem', 'task-4'],
    ]);
  });
});
