import { describe, it, expect } from 'vitest';
import { BlockNoteEditor } from '@blocknote/core';
import { richNoteSchema } from './richNoteSchema';

/**
 * #2062 — the approval-note / activity-note editor palette. Notes are small prose surfaces:
 * paragraphs, the two lists, bold/italic and links. Everything else (headings, code, tables,
 * media, colours, underline) is OUT of the schema, not merely hidden — the schema is what a
 * paste can smuggle in, so withholding at the schema level is the real gate.
 */
describe('richNoteSchema — the small note palette (#2062)', () => {
  it('holds exactly paragraph, bulletListItem and numberedListItem blocks', () => {
    expect(Object.keys(richNoteSchema.blockSchema).sort()).toEqual(
      ['bulletListItem', 'numberedListItem', 'paragraph'],
    );
  });

  it('holds exactly bold and italic styles — no colours, underline, strike or code', () => {
    expect(Object.keys(richNoteSchema.styleSchema).sort()).toEqual(['bold', 'italic']);
  });

  it('keeps text and link inline content — the link style a note needs', () => {
    expect(Object.keys(richNoteSchema.inlineContentSchema).sort()).toEqual(['link', 'text']);
  });

  it('round-trips a legacy plain-text row through the editor without loss', () => {
    // The stored column is plain text; markdown is a superset of plain text, so an old row
    // must parse and serialise back to the same characters the author typed.
    const editor = BlockNoteEditor.create({ schema: richNoteSchema });
    const legacy = 'Called the site engineer, follow up Monday';
    const blocks = editor.tryParseMarkdownToBlocks(legacy);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(editor.blocksToMarkdownLossy(blocks as never).trim()).toBe(legacy);
  });

  it('round-trips markdown bold, italic, links and both lists', () => {
    const editor = BlockNoteEditor.create({ schema: richNoteSchema });
    const md = [
      'Approved with **note** on *budget* — see [the BoQ](https://example.com/boq).',
      '',
      '- first',
      '- second',
      '',
      '1. one',
      '2. two',
      '',
    ].join('\n');
    const blocks = editor.tryParseMarkdownToBlocks(md);
    const out = editor.blocksToMarkdownLossy(blocks as never);
    expect(out).toContain('**note**');
    expect(out).toContain('*budget*');
    expect(out).toContain('[the BoQ](https://example.com/boq)');
    // BlockNote serialises bullet lists with `*` (valid markdown; the library owns the dialect).
    expect(out).toContain('* first');
    expect(out).toContain('1. one');
  });

  it('parses a markdown heading as plain text — the palette has no heading block', () => {
    // A legacy row typed like "# Note" must still render (as text), never error.
    const editor = BlockNoteEditor.create({ schema: richNoteSchema });
    const blocks = editor.tryParseMarkdownToBlocks('# Legacy heading line');
    expect(blocks.every((b) => b.type === 'paragraph')).toBe(true);
    expect(editor.blocksToMarkdownLossy(blocks as never)).toContain('Legacy heading line');
  });
});
