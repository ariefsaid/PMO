import { describe, it, expect } from 'vitest';
import { BlockNoteEditor } from '@blocknote/core';
import { minutesSchema } from './minutesSchema';

describe('minutesSchema — the typed block and the palette', () => {
  const action = minutesSchema.blockSchema.actionItem;

  it('AC-MTG-002 the actionItem block persists props.taskId only and declares NO inline content (FR-MTG-004)', () => {
    expect(action.content).toBe('none');
    expect(Object.keys(action.propSchema)).toEqual(['taskId']);
    expect(action.propSchema.taskId.default).toBe('');
  });

  it('FR-MTG-006 actionItem is the only custom block type', () => {
    const builtin = new Set([
      'paragraph', 'heading', 'quote', 'codeBlock', 'bulletListItem', 'numberedListItem',
      'checkListItem', 'toggleListItem', 'divider', 'table',
    ]);
    const custom = Object.keys(minutesSchema.blockSchema).filter((k) => !builtin.has(k));
    expect(custom).toEqual(['actionItem']);
  });

  it('AC-MTG-026 / FR-MTG-022 the palette has no image, video, audio or file block', () => {
    for (const t of ['image', 'video', 'audio', 'file']) {
      expect(Object.keys(minutesSchema.blockSchema)).not.toContain(t);
    }
  });

  // AC-MTG-006 (re-homed from the deleted actionItemTaskIds TS helper, #1710): the shipped schema
  // is what makes a pasted/duplicated actionItem block ANOTHER REFERENCE to the same task
  // (FR-MTG-020). A paste round-trips the block through this schema, so only what propSchema
  // declares survives — props.taskId — and content: 'none' means no task data rides along. The
  // task count cannot move: a notes edit never writes tasks (pgTAP 0254 AC-MTG-004 owns that seam).
  it('AC-MTG-006 duplicating an actionItem block through the schema yields two references to the SAME taskId and no copied task data (FR-MTG-020)', () => {
    const editor = BlockNoteEditor.create({ schema: minutesSchema });
    editor.replaceBlocks(editor.document, [
      { type: 'paragraph', content: 'Kickoff' },
      { type: 'actionItem', props: { taskId: 't1' } },
    ] as never);
    const original = editor.document[1];
    // What a paste produces: the same block re-created from its persisted props through the schema.
    editor.insertBlocks(
      [{ type: 'actionItem', props: original.props as { taskId: string } }],
      original,
      'after',
    );
    const refs = editor.document.filter((b) => b.type === 'actionItem');
    expect(refs).toHaveLength(2);
    expect(refs.map((b) => (b.props as { taskId: string }).taskId)).toEqual(['t1', 't1']);
    expect(refs.every((b) => b.content === undefined)).toBe(true);
  });
});
