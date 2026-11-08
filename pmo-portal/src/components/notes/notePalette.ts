import type { Dictionary } from '@blocknote/core';
import { blockTypeSelectItems, type BlockTypeSelectItem } from '@blocknote/react';

/**
 * The formatting toolbar's block-type picker for notes (#2062): exactly the palette the
 * schema allows — paragraph, bullet list, numbered list — so the picker can both start a
 * list and leave one. Everything else BlockNote offers (headings, quote, check list…) is
 * withheld; the schema (`richNoteSchema`) is the hard gate, this is the visible one.
 */
const NOTE_BLOCK_TYPES = new Set(['paragraph', 'bulletListItem', 'numberedListItem']);

export const noteBlockTypeItems = (dict: Dictionary): BlockTypeSelectItem[] =>
  blockTypeSelectItems(dict).filter((i) => NOTE_BLOCK_TYPES.has(i.type));
