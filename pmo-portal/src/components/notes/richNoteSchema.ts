import { BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from '@blocknote/core';

/**
 * #2062 — the schema for approval notes and activity notes: the smallest palette that still
 * reads as a note. Paragraphs, the two lists, bold/italic and links (inline defaults).
 *
 * Withholding happens at the SCHEMA level, not the toolbar: the schema is what a paste, a
 * markdown import or a stored row can carry, so anything not listed here cannot exist in a
 * saved note. Headings/code/tables/media and the colour/underline/strike/code styles are
 * therefore impossible, and BlockNote's own toolbar buttons render `null` for unsupported
 * styles — the toolbar needs no second gate.
 */
const { paragraph, bulletListItem, numberedListItem } = defaultBlockSpecs;

export const richNoteSchema = BlockNoteSchema.create({
  blockSpecs: { paragraph, bulletListItem, numberedListItem },
  styleSpecs: { bold: defaultStyleSpecs.bold, italic: defaultStyleSpecs.italic },
});
