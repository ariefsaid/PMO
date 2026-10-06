import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { createReactBlockSpec } from '@blocknote/react';
import { ActionItemView } from './ActionItemView';

/**
 * The one typed block (DD-MTG-1/2, FR-MTG-003/004/006): an atomic reference to a real `tasks` row.
 * It stores `props.taskId` and nothing else — `content: 'none'` — so the document can never hold a
 * second copy of the task's name, assignee, date or status. Deleting the block deletes only this
 * reference (FR-MTG-018); a pasted/duplicated block is another reference to the same task (FR-MTG-020).
 */
export const ActionItemBlock = createReactBlockSpec(
  {
    type: 'actionItem',
    content: 'none',
    propSchema: { taskId: { default: '' } },
  },
  {
    render: ({ block }) => <ActionItemView taskId={block.props.taskId} />,
  },
);

// FR-MTG-022: no image / video / audio / file blocks in v1 — the persisted document must hold no
// embedded binary; attachments are a later slice (storage bucket, 0025 pattern).
const { image: _image, video: _video, audio: _audio, file: _file, ...allowedBlockSpecs } = defaultBlockSpecs;
void [_image, _video, _audio, _file];

export const minutesSchema = BlockNoteSchema.create({
  blockSpecs: { ...allowedBlockSpecs, actionItem: ActionItemBlock() },
});
