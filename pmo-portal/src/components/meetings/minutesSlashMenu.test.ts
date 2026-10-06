import { describe, it, expect, vi } from 'vitest';
import { BlockNoteEditor } from '@blocknote/core';
import { en } from '@blocknote/core/locales';
import { blockTypeSelectItems } from '@blocknote/react';
import { minutesSchema } from './minutesSchema';
import { minutesSlashItems, minutesBlockTypeItems } from './minutesSlashMenu';

const t = ((_key: string, fallback: string) => fallback) as never;
const editor = () => BlockNoteEditor.create({ schema: minutesSchema });

describe('minutesSlashMenu — the palette order and what it leaves out (DD-MTG-10)', () => {
  it('AC-MTG-022 "Action item" is the FIRST entry of the slash menu', () => {
    const items = minutesSlashItems(editor(), { t, tasksExternal: false, onRequestAction: vi.fn() });
    expect(items[0].title).toBe('Action item');
    expect(items[0].group).toBe('Actions');
  });

  it('AC-MTG-022 the check-list entry is NOT offered — it looks like a to-do but never becomes a task', () => {
    const items = minutesSlashItems(editor(), { t, tasksExternal: false, onRequestAction: vi.fn() });
    expect(items.map((i) => i.title)).not.toContain(en.slash_menu.check_list.title);
    expect(items.map((i) => (i as { key?: string }).key)).not.toContain('check_list');
    // the rest of the palette is intact
    expect(items.map((i) => i.title)).toEqual(expect.arrayContaining(['Heading 1', 'Bullet List', 'Table']));
  });

  it('AC-MTG-022 the block-type picker (formatting toolbar) offers no check list either', () => {
    const names = minutesBlockTypeItems(en).map((i) => i.type);
    expect(names).not.toContain('checkListItem');
    expect(names).toContain('bulletListItem');
    expect(blockTypeSelectItems(en).map((i) => i.type)).toContain('checkListItem'); // proves the filter is doing the work
  });

  it('§8.5 with externally-owned tasks there is no action entry and the check list stays out', () => {
    const items = minutesSlashItems(editor(), { t, tasksExternal: true, onRequestAction: vi.fn() });
    expect(items.map((i) => i.title)).not.toContain('Action item');
    expect(items.map((i) => (i as { key?: string }).key)).not.toContain('check_list');
  });

  it('AC-MTG-060 choosing "Action item" hands the line text to the page (the modal prefill)', () => {
    const e = editor();
    e.replaceBlocks(e.document, [{ type: 'paragraph', content: 'Confirm crane schedule' }]);
    e.setTextCursorPosition(e.document[0], 'end');
    const onRequestAction = vi.fn();
    const [action] = minutesSlashItems(e, { t, tasksExternal: false, onRequestAction });
    action.onItemClick();
    expect(onRequestAction).toHaveBeenCalledWith(e.document[0].id, 'Confirm crane schedule');
  });
});
