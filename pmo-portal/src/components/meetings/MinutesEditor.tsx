import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import { useTheme } from '@/src/hooks/useTheme';
import type { NoteBlock } from '@/src/lib/meetingNotes';
import { minutesSchema } from './minutesSchema';
import { minutesDictionary } from './minutesDictionary';
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

const inlineText = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .map((r) => (r && typeof r === 'object' && typeof (r as { text?: unknown }).text === 'string' ? (r as { text: string }).text : ''))
        .join('')
    : '';

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

  const dictionary = useMemo(() => minutesDictionary(i18n.language), [i18n.language]);
  const editor = useCreateBlockNote(
    {
      schema: minutesSchema,
      dictionary,
      initialContent: initialBlocks.length ? (initialBlocks as never) : undefined,
      // FR-MTG-022: no upload path exists, so a pasted/dropped file can never become an embedded blob.
      uploadFile: undefined,
    },
    [dictionary],
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
        const props = { taskId };
        const ref = pendingBlockId.current ? editor.getBlock(pendingBlockId.current) : undefined;
        pendingBlockId.current = null;
        if (ref && ref.type === 'paragraph' && inlineText(ref.content) === '') {
          editor.updateBlock(ref, { type: 'actionItem', props });
        } else if (ref) {
          editor.insertBlocks([{ type: 'actionItem', props }], ref, 'after');
        } else {
          const last = editor.document[editor.document.length - 1];
          editor.insertBlocks([{ type: 'actionItem', props }], last, 'after');
        }
      },
    }),
    [editor],
  );

  const getItems = useCallback(
    async (query: string) => {
      const items = getDefaultReactSlashMenuItems(editor);
      if (!tasksExternal) {
        items.push({
          title: t('meetingDetail.minutes.slash.actionTitle', 'Action item'),
          subtext: t('meetingDetail.minutes.slash.actionSubtext', 'Create a task from this line'),
          group: t('meetingDetail.minutes.slash.actionGroup', 'Basic blocks'),
          aliases: t('meetingDetail.minutes.slash.actionAliases', 'action,task,todo')
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean),
          onItemClick: () => {
            const block = editor.getTextCursorPosition().block;
            pendingBlockId.current = block.id;
            onRequestAction(inlineText(block.content));
          },
        } as (typeof items)[number]);
      }
      return filterSuggestionItems(items, query);
    },
    [editor, t, tasksExternal, onRequestAction],
  );

  return (
    <div className="minutes-editor" data-testid="minutes-blocknote">
      <BlockNoteView
        editor={editor}
        theme={theme}
        editable={editable}
        slashMenu={false}
        onChange={() => onChange(editor.document as unknown as NoteBlock[])}
        aria-label={t('meetingDetail.minutes.editorLabel', 'Meeting minutes')}
      >
        {editable && <SuggestionMenuController triggerCharacter="/" getItems={getItems} />}
      </BlockNoteView>
    </div>
  );
});

export default MinutesEditor;
