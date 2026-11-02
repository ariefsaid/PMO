import type { NoteBlock } from '@/src/lib/meetingNotes';

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Top-level text of each block's inline runs (and v1 `text`), one string per block. */
export function notesToText(blocks: NoteBlock[]): string[] {
  return blocks.map((block) => {
    const content = block.content;
    if (!Array.isArray(content)) return typeof block.text === 'string' ? block.text : '';
    return content
      .map((run) => (isObject(run) && typeof run.text === 'string' ? run.text : ''))
      .join('');
  });
}
