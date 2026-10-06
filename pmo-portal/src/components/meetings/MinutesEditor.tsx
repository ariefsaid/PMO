import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import {
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import { useTheme } from '@/src/hooks/useTheme';
import type { NoteBlock } from '@/src/lib/meetingNotes';
import { minutesSchema } from './minutesSchema';
import { minutesDictionary } from './minutesDictionary';
import { minutesBlockTypeItems, minutesSlashItems } from './minutesSlashMenu';
import { placeActionItem } from './placeActionItem';
import './minutesTailwind.css';
import './minutesEditor.css';

/** What the page can ask of the editor once an action-item task exists (DD-MTG-8 flow). */
export interface MinutesEditorHandle {
  /** Place an `actionItem` block referencing `taskId` where /action was invoked. No task write. */
  insertActionItem(taskId: string): void;
}

export interface MinutesEditorProps {
  /** The stored document, already upgraded to BlockNote blocks (`upgradeNotes`). */
  initialBlocks: NoteBlock[];
  editable: boolean;
  /** §8.5: tasks are externally owned — `/action` is not offered. */
  tasksExternal: boolean;
  /** The editor's normalised starting document — the baseline the page's dirty check compares to. */
  onReady: (blocks: NoteBlock[]) => void;
  onChange: (blocks: NoteBlock[]) => void;
  /** `/action` was chosen on a line holding `lineText` — the page opens the prefilled task modal. */
  onRequestAction: (lineText: string) => void;
}

/**
 * The slash menu's floating wrapper. `elementProps` REPLACES BlockNote's own (it spreads ours last), so the
 * two it sets — keep the editor from blurring on a scrollbar click, and stack above the page — are restated.
 * The class lets `minutesEditor.css` inset the menu from the viewport edge on a phone.
 */
const SLASH_POPOVER = {
  elementProps: {
    className: 'minutes-slash-popover',
    onMouseDownCapture: (e: React.MouseEvent) => e.preventDefault(),
    style: { zIndex: 80 },
  },
};

/**
 * The BlockNote minutes editor (#805). Lazy-loaded by `MeetingDetail` (FR-MTG-026) — everything that
 * pulls `@blocknote/*` is reachable only from this module.
 */
const MinutesEditor = forwardRef<MinutesEditorHandle, MinutesEditorProps>(function MinutesEditor(
  { initialBlocks, editable, tasksExternal, onReady, onChange, onRequestAction },
  ref,
) {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();

  // Fixed per editor instance: rebuilding on a locale switch would re-seed from the saved blocks and drop unsaved edits.
  const [dictionary] = React.useState(() => minutesDictionary(i18n.language));
  const editor = useCreateBlockNote(
    {
      schema: minutesSchema,
      dictionary,
      initialContent: initialBlocks.length ? (initialBlocks as never) : undefined,
      // WCAG 4.1.2: the name belongs on the element that carries role=textbox, not on a wrapper div (axe aria-input-field-name).
      domAttributes: { editor: { 'aria-label': t('meetingDetail.minutes.editorLabel', 'Meeting minutes') } },
      // FR-MTG-022: no upload path exists, so a pasted/dropped file can never become an embedded blob.
      uploadFile: undefined,
    },
    [],
  );

  useEffect(() => {
    onReady(editor.document as unknown as NoteBlock[]);
    // baseline is taken once per editor instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // The block /action was invoked on, remembered across the modal round-trip.
  const pendingBlockId = React.useRef<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      insertActionItem(taskId: string) {
        const blockId = pendingBlockId.current;
        pendingBlockId.current = null;
        placeActionItem(editor, blockId, taskId);
      },
    }),
    [editor],
  );

  const getItems = useCallback(
    async (query: string) =>
      filterSuggestionItems(
        minutesSlashItems(editor, {
          t,
          tasksExternal,
          onRequestAction: (blockId, lineText) => {
            pendingBlockId.current = blockId;
            onRequestAction(lineText);
          },
        }),
        query,
      ),
    [editor, t, tasksExternal, onRequestAction],
  );

  // The formatting toolbar's block-type picker, minus the check list (DD-MTG-10).
  const toolbar = useMemo(
    () =>
      function MinutesFormattingToolbar() {
        return <FormattingToolbar blockTypeSelectItems={minutesBlockTypeItems(dictionary)} />;
      },
    [dictionary],
  );

  return (
    <div className="minutes-editor" data-testid="minutes-blocknote">
      <BlockNoteView
        editor={editor}
        theme={theme}
        editable={editable}
        slashMenu={false}
        formattingToolbar={false}
        onChange={() => onChange(editor.document as unknown as NoteBlock[])}
      >
        {editable && <FormattingToolbarController formattingToolbar={toolbar} />}
        {editable && (
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={getItems}
            floatingUIOptions={SLASH_POPOVER}
          />
        )}
      </BlockNoteView>
    </div>
  );
});

export default MinutesEditor;
