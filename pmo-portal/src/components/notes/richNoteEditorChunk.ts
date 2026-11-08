import { lazyWithPreload } from '@/src/lib/lazyWithPreload';

/**
 * The lazy RichNoteEditor (#2062) — the approval-note / activity-note editor. Same pattern as the
 * minutes' minutesEditorChunk: everything that pulls `@blocknote/*` is reachable only from the
 * notes editor module family (RichNoteEditor, richNoteSchema, notePalette), so the FR-MTG-026
 * bundle guard stays intact and the editor chunk never lands in the initial bundle. Call sites
 * reach it ONLY through this module, under a Suspense boundary.
 */
export const RichNoteEditor = lazyWithPreload(() => import('./RichNoteEditor'));

/** Fire-and-forget handle for a route entry that wants the chunk warm before it renders. */
export const preloadRichNoteEditor = RichNoteEditor.preload;
