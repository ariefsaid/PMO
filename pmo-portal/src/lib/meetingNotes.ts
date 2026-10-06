/**
 * Pure helpers over the `meetings.notes` document (#805, FR-MTG-002).
 *
 * v1 stored `[{type:'p', text}]` (the line editor, #526); v2 stores BlockNote's `Block[]` verbatim.
 * The schema asserts only "array", so everything here reads defensively and never throws on shape.
 */
import type { Json } from '@/src/lib/supabase/database.types';

/** A stored BlockNote block (v2), or a v1 line — structurally typed, interior left opaque. */
export interface NoteBlock {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: NoteBlock[];
  [key: string]: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** A BlockNote block always carries `children`; no v1 line does (mirrors the 0254 trigger). */
const isV2Block = (b: unknown): boolean => isObject(b) && Array.isArray(b.children);

function lineToParagraph(line: unknown): NoteBlock {
  const text = isObject(line) ? line.text : line;
  const s = typeof text === 'string' ? text : '';
  return {
    type: 'paragraph',
    content: s ? [{ type: 'text', text: s, styles: {} }] : [],
    children: [],
  };
}

/**
 * One-way upgrade of a stored note to editor blocks. v2 (by `version >= 2`, or by shape when the
 * version is unknown) is returned untouched; v1 lines become paragraphs carrying the same text.
 * Nothing is dropped: empty lines stay empty paragraphs. The next Save writes v2.
 */
export function upgradeNotes(notes: Json | unknown, version?: number): NoteBlock[] {
  if (!Array.isArray(notes)) return [];
  if (notes.length === 0) return [];
  const v2 = version !== undefined ? version >= 2 : notes.every(isV2Block);
  if (v2) return notes as NoteBlock[];
  return notes.map((b) => (isV2Block(b) ? (b as NoteBlock) : lineToParagraph(b)));
}

/** Top-level text of each block's inline runs (and v1 `text`), one string per block — for tests/previews. */
export function notesToText(blocks: NoteBlock[]): string[] {
  return blocks.map((b) => {
    const c = b.content;
    if (!Array.isArray(c)) return typeof b.text === 'string' ? b.text : '';
    return c.map((r) => (isObject(r) && typeof r.text === 'string' ? r.text : '')).join('');
  });
}

/** Every non-empty `props.taskId` of an `actionItem` block, document order, nesting included. */
export function actionItemTaskIds(blocks: NoteBlock[]): string[] {
  const out: string[] = [];
  const walk = (list: NoteBlock[]) => {
    for (const b of list) {
      if (b.type === 'actionItem') {
        const id = b.props?.taskId;
        if (typeof id === 'string' && id) out.push(id);
      }
      if (Array.isArray(b.children)) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

/**
 * FR-MTG-022 backstop: the persisted document may hold no embedded binary. The palette excludes
 * media blocks, so this should never fire; it is the save-time guard if a paste path slips past it.
 */
export function assertNoBinary(doc: unknown): void {
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (/^\s*data:/i.test(v)) throw new Error('Minutes may not contain embedded binary content');
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) Object.values(v).forEach(walk);
  };
  walk(doc);
}
