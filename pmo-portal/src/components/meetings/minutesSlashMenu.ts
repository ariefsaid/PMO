import type { TFunction } from 'i18next';
import { getDefaultReactSlashMenuItems, blockTypeSelectItems, type BlockTypeSelectItem } from '@blocknote/react';
import type { BlockNoteEditor, BlockSchema, Dictionary, InlineContentSchema, StyleSchema } from '@blocknote/core';

type SlashItem = ReturnType<typeof getDefaultReactSlashMenuItems>[number];

/**
 * Block types the minutes palette withholds (DD-MTG-10). A check list looks like a to-do but never
 * becomes a task; an action item is the one way a minute line turns into work.
 */
const WITHHELD_SLASH_KEYS = new Set(['check_list']);
const WITHHELD_BLOCK_TYPES = new Set(['checkListItem']);

export const inlineText = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .map((r) =>
          r && typeof r === 'object' && typeof (r as { text?: unknown }).text === 'string'
            ? (r as { text: string }).text
            : '',
        )
        .join('')
    : '';

interface SlashOptions {
  t: TFunction;
  /** §8.5: tasks are externally owned — `/action` is not offered. */
  tasksExternal: boolean;
  /** `/action` was chosen on block `blockId`, which holds `lineText`. */
  onRequestAction: (blockId: string, lineText: string) => void;
}

/** The slash menu, in order: "Action item" first (the point of a minutes editor), then BlockNote's blocks. */
export function minutesSlashItems<B extends BlockSchema, I extends InlineContentSchema, S extends StyleSchema>(
  editor: BlockNoteEditor<B, I, S>,
  { t, tasksExternal, onRequestAction }: SlashOptions,
): SlashItem[] {
  const defaults = getDefaultReactSlashMenuItems(editor).filter(
    (i) => !WITHHELD_SLASH_KEYS.has((i as { key?: string }).key ?? ''),
  );
  if (tasksExternal) return defaults;
  const action = {
    key: 'action_item',
    title: t('meetingDetail.minutes.slash.actionTitle', 'Action item'),
    subtext: t('meetingDetail.minutes.slash.actionSubtext', 'Create a task from this line'),
    group: t('meetingDetail.minutes.slash.actionGroup', 'Actions'),
    aliases: t('meetingDetail.minutes.slash.actionAliases', 'action,task,todo')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    onItemClick: () => {
      const block = editor.getTextCursorPosition().block;
      onRequestAction(block.id, inlineText(block.content));
    },
  } as unknown as SlashItem;
  return [action, ...defaults];
}

/** The formatting toolbar's block-type picker, minus the withheld block types. */
export const minutesBlockTypeItems = (dict: Dictionary): BlockTypeSelectItem[] =>
  blockTypeSelectItems(dict).filter((i) => !WITHHELD_BLOCK_TYPES.has(i.type));
