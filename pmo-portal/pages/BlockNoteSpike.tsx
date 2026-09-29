import React, { useCallback, useMemo, useState } from 'react';
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  type Block,
} from '@blocknote/core';
import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from '@blocknote/core/extensions';
import {
  createReactBlockSpec,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import { PageHeader } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import './BlockNoteSpike.css';

// action-item block start
const ActionItem = createReactBlockSpec(
  {
    type: 'actionItem',
    content: 'inline',
    propSchema: {
      assignee: { default: '' },
      dueDate: { default: '' },
    },
  },
  {
    render: ({ block, editor, contentRef }) => (
      <div className="blocknote-action-item">
        <div className="blocknote-action-item__body">
          <span className="blocknote-action-item__marker" aria-hidden="true">○</span>
          <div className="blocknote-action-item__title" ref={contentRef} />
        </div>
        <div className="blocknote-action-item__fields" contentEditable={false}>
          <label>
            <span>Assignee</span>
            <select
              aria-label="Assignee"
              value={block.props.assignee}
              onChange={(event) => editor.updateBlock(block, { props: { assignee: event.target.value } })}
            >
              <option value="">Unassigned</option>
              <option value="member-a">Member A</option>
              <option value="member-b">Member B</option>
            </select>
          </label>
          <label>
            <span>Due date</span>
            <input
              aria-label="Due date"
              type="date"
              value={block.props.dueDate}
              onChange={(event) => editor.updateBlock(block, { props: { dueDate: event.target.value } })}
            />
          </label>
        </div>
      </div>
    ),
  },
);
// action-item block end

const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, actionItem: ActionItem() },
});

type SpikeBlock = Block<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>;

const initialContent = [
  { type: 'heading', content: 'Meeting notes, without the ceremony', props: { level: 1 } },
  { type: 'paragraph', content: 'Type / to explore blocks. Try /action to add a structured follow-up.' },
  {
    type: 'actionItem',
    content: 'Confirm the next project checkpoint',
    props: { assignee: '', dueDate: '2026-09-18' },
  },
] as const;

const BlockNoteSpike: React.FC = () => {
  const { theme } = useTheme();
  const editor = useCreateBlockNote({ schema, initialContent: initialContent as never });
  const [document, setDocument] = useState<SpikeBlock[]>(() => editor.document as SpikeBlock[]);

  const getItems = useCallback(
    async (query: string) => {
      const actionItemMenuItem = {
        title: 'Action item',
        subtext: 'Add an owner and due date',
        aliases: ['action', 'task', 'todo'],
        group: 'Basic blocks',
        onItemClick: () =>
          insertOrUpdateBlockForSlashMenu(editor, {
            type: 'actionItem',
            props: { assignee: '', dueDate: '' },
          }),
      };
      return filterSuggestionItems(
        [...getDefaultReactSlashMenuItems(editor), actionItemMenuItem],
        query,
      );
    },
    [editor],
  );

  const json = useMemo(() => JSON.stringify(document, null, 2), [document]);

  return (
    <main className="blocknote-spike">
      <PageHeader
        surface="bare"
        name="BlockNote meeting editor"
        meta="Throwaway prototype · edits live in component state only"
      />
      <div className="blocknote-spike__intro">
        <p>Explore live note-taking with a typed action item. The inspector makes the document shape visible.</p>
        <span className="blocknote-spike__badge">No persistence</span>
      </div>
      <div className="blocknote-spike__grid">
        <section className="blocknote-spike__panel" aria-labelledby="editor-heading">
          <div className="blocknote-spike__panel-heading">
            <div>
              <span className="blocknote-spike__eyebrow">Editor</span>
              <h2 id="editor-heading">Meeting canvas</h2>
            </div>
            <span className="blocknote-spike__hint">Press / for commands</span>
          </div>
          <div className="blocknote-spike__editor">
            <BlockNoteView
              editor={editor}
              theme={theme}
              slashMenu={false}
              onChange={() => setDocument(editor.document as SpikeBlock[])}
            >
              <SuggestionMenuController triggerCharacter="/" getItems={getItems} />
            </BlockNoteView>
          </div>
        </section>
        <section className="blocknote-spike__panel blocknote-spike__json-panel" aria-labelledby="json-heading">
          <div className="blocknote-spike__panel-heading">
            <div>
              <span className="blocknote-spike__eyebrow">Inspector</span>
              <h2 id="json-heading">Document JSON</h2>
            </div>
            <span className="blocknote-spike__hint">In memory</span>
          </div>
          <pre aria-label="Current document JSON">{json}</pre>
        </section>
      </div>
    </main>
  );
};

export default BlockNoteSpike;
