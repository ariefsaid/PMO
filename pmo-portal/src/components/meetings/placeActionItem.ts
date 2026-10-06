import type { minutesSchema } from './minutesSchema';
import type { BlockNoteEditor } from '@blocknote/core';

type MinutesEditorInstance = BlockNoteEditor<
  typeof minutesSchema.blockSchema,
  typeof minutesSchema.inlineContentSchema,
  typeof minutesSchema.styleSchema
>;

/**
 * Put the `actionItem` block for `taskId` where `/action` was invoked (DD-MTG-2: it stores the id only).
 * The invoking line is REPLACED, not kept above the block: the block renders the task's own name, so keeping
 * the line would show the same words twice. The modal prefilled the task name from that line, so nothing the
 * author typed is lost; cancelling the modal never reaches this function, leaving the line untouched.
 * If the line is gone by the time the task exists, the block lands at the end of the document.
 */
export function placeActionItem(editor: MinutesEditorInstance, blockId: string | null, taskId: string): void {
  const props = { taskId };
  const line = blockId ? editor.getBlock(blockId) : undefined;
  if (line) {
    editor.updateBlock(line, { type: 'actionItem', props, content: undefined });
    return;
  }
  const last = editor.document[editor.document.length - 1];
  editor.insertBlocks([{ type: 'actionItem', props }], last, 'after');
}
