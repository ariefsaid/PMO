import React, { forwardRef, startTransition, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  useCreateBlockNote,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import { useTheme } from '@/src/hooks/useTheme';
import { minutesDictionary } from '@/src/components/meetings/minutesDictionary';
import { richNoteSchema } from './richNoteSchema';
import { noteBlockTypeItems } from './notePalette';
import './richNote.css';

/**
 * RichNoteEditor — the small rich-text note editor (#2062). Replaces the plain textareas on
 * approval notes and activity notes (gap review shot 18): paragraphs, bullet/numbered lists,
 * bold/italic and links, nothing else — the schema (`richNoteSchema`) is the hard gate.
 *
 * Storage contract (#2062, no migration): the column stays plain text and stores MARKDOWN.
 * `initialValue` is parsed through `tryParseMarkdownToBlocks` on mount — legacy plain-text
 * rows parse as markdown (plain text is valid markdown), so old rows keep rendering and old
 * callers see the same string shape. Every change is reported out as markdown via
 * `blocksToMarkdownLossy`; `getMarkdown()` is the save-time read (the onChange stream is a
 * transition and may lag one keystroke, exactly like the minutes editor).
 *
 * Behaviour from the library (#2042): BlockNote owns the editing model, toolbar and history.
 * The look comes only from DESIGN.md tokens via `richNote.css` (same seam as the minutes).
 */
export interface RichNoteEditorHandle {
  /** The live document as markdown — Save must read this, not the deferred onChange copy. */
  getMarkdown(): string;
}

export interface RichNoteEditorProps {
  /** Stored note text (markdown or legacy plain text); parsed once on mount. */
  initialValue: string;
  /** Every edit, serialised as markdown. Not called for the mount-time seed. */
  onChange: (markdown: string) => void;
  /** Accessible name — must sit on the role=textbox element itself (WCAG 4.1.2). */
  ariaLabel: string;
  /** Hint shown on the empty, focused editor (BlockNote's placeholder mechanism). */
  placeholder?: string;
  /** Read-only render (default false — editing). */
  editable?: boolean;
  /** Escape pressed in the editor: the caller decides what cancel means. */
  onCancel?: () => void;
  testId?: string;
}

const RichNoteEditor = forwardRef<RichNoteEditorHandle, RichNoteEditorProps>(function RichNoteEditor(
  { initialValue, onChange, ariaLabel, placeholder, editable = true, onCancel, testId = 'rich-note-editor' },
  ref,
) {
  const { i18n } = useTranslation();
  const { theme } = useTheme();

  // Fixed per editor instance: rebuilding on a locale switch would re-seed from the saved text and drop unsaved edits.
  // The minutes dictionary localises the toolbar; a note's own placeholder replaces the default
  // "type / for commands" hint — notes have no slash menu, so that hint would be a lie.
  const [dictionary] = React.useState(() => {
    const base = minutesDictionary(i18n.language);
    if (!placeholder) return base;
    return { ...base, placeholders: { ...base.placeholders, default: placeholder } };
  });
  const editor = useCreateBlockNote(
    {
      schema: richNoteSchema,
      dictionary,
      // WCAG 4.1.2: the name belongs on the element that carries role=textbox (axe aria-input-field-name).
      domAttributes: { editor: { 'aria-label': ariaLabel } },
    },
    [],
  );

  // Seed once from the stored text. Mounting is NOT an edit: the seed suppresses onChange, so a
  // parent's dirty check stays clean until the author actually types.
  const seeding = useRef(true);
  useEffect(() => {
    let cancelled = false;
    const seed = async () => {
      if (!initialValue.trim()) {
        seeding.current = false;
        return;
      }
      const parsed = await editor.tryParseMarkdownToBlocks(initialValue);
      if (cancelled) return;
      if (parsed.length) editor.replaceBlocks(editor.document, parsed as never);
      seeding.current = false;
    };
    void seed();
    return () => {
      cancelled = true;
    };
    // initialValue is the STORED text — parsed once per editor instance; later prop changes are
    // the author's own echoes (onChange out), never a new seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useImperativeHandle(
    ref,
    () => ({
      getMarkdown: () => editor.blocksToMarkdownLossy(editor.document as never),
    }),
    [editor],
  );

  const toMarkdown = useCallback(
    () => editor.blocksToMarkdownLossy(editor.document as never),
    [editor],
  );

  // Escape cancels — but only while editing; a read-only note has nothing to cancel.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && editable) onCancel?.();
    },
    [editable, onCancel],
  );

  // The formatting toolbar: the block-type picker limited to the note palette, then bold /
  // italic / link. Underline, strike, code and colour buttons would render null anyway — their
  // styles are not in the schema — so they are simply not mounted.
  const toolbar = useMemo(
    () =>
      function NoteFormattingToolbar() {
        return (
          <FormattingToolbar>
            <BlockTypeSelect key="blockTypeSelect" items={noteBlockTypeItems(dictionary)} />
            <BasicTextStyleButton key="boldStyleButton" basicTextStyle="bold" />
            <BasicTextStyleButton key="italicStyleButton" basicTextStyle="italic" />
            <CreateLinkButton key="createLinkButton" />
          </FormattingToolbar>
        );
      },
    [dictionary],
  );

  return (
    <div className="rich-note-editor" data-testid={testId} onKeyDown={onKeyDown}>
      <BlockNoteView
        editor={editor}
        theme={theme}
        editable={editable}
        slashMenu={false}
        formattingToolbar={false}
        // A transition, not a sync update: a sync parent re-render per keystroke hits React's
        // nested-update limit (the minutes editor hit it first — AC-MRT-001's lesson).
        onChange={() => {
          if (seeding.current) return;
          startTransition(() => onChange(toMarkdown()));
        }}
      >
        {editable && <FormattingToolbarController formattingToolbar={toolbar} />}
      </BlockNoteView>
    </div>
  );
});

export default RichNoteEditor;
