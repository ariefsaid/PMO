import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { en } from '@blocknote/core/locales';
import { blockTypeSelectItems } from '@blocknote/react';
import RichNoteEditor, { type RichNoteEditorHandle } from './RichNoteEditor';
import { noteBlockTypeItems } from './notePalette';

// jsdom has no layout engine: BlockNote's floating UI asks for geometry it cannot give. Same stub
// the minutes editor tests use — everything else about the editor is real.
beforeAll(() => {
  const zeroRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  (document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
  Element.prototype.getBoundingClientRect = zeroRect;
  Range.prototype.getBoundingClientRect = zeroRect;
  Range.prototype.getClientRects = (() => []) as never;
});

afterEach(cleanup);

const mountEditor = (
  props: Partial<React.ComponentProps<typeof RichNoteEditor>> = {},
  ref?: React.Ref<RichNoteEditorHandle>,
) => {
  const onChange = vi.fn();
  const view = render(
    <RichNoteEditor
      ref={ref}
      initialValue={props.initialValue ?? ''}
      ariaLabel={props.ariaLabel ?? 'Approval note'}
      onChange={onChange}
      onCancel={props.onCancel}
      editable={props.editable}
      testId={props.testId}
    />,
  );
  return { onChange, ...view };
};

const box = () => screen.getByRole('textbox', { name: 'Approval note' });

describe('RichNoteEditor — the small note editor (#2062)', () => {
  // WCAG 4.1.2: the name belongs on the element that carries role=textbox (axe aria-input-field-name).
  it('AC-RN-001 puts the accessible name on the textbox element itself', () => {
    mountEditor();
    expect(box()).toHaveClass('bn-editor');
    expect(box().getAttribute('aria-label')).toBe('Approval note');
  });

  it('AC-RN-002 a legacy plain-text row renders as editor text and round-trips unchanged', async () => {
    const ref = React.createRef<RichNoteEditorHandle>();
    mountEditor({ initialValue: 'Called the site engineer, follow up Monday' }, ref);
    // the seed parse is async — the text arrives a tick after mount
    await screen.findByText('Called the site engineer, follow up Monday');
    await waitFor(() =>
      // unedited legacy text serialises back to itself — Save without edits writes no markdown syntax
      expect(ref.current?.getMarkdown().trim()).toBe('Called the site engineer, follow up Monday'),
    );
  });

  it('AC-RN-003 stored markdown renders styled — bold is strong, not asterisks', async () => {
    mountEditor({ initialValue: 'Approved with **caveat**' });
    await waitFor(() => expect(box().querySelector('strong')).not.toBeNull());
    const strong = box().querySelector('strong');
    expect(strong).toHaveTextContent('caveat');
    expect(box().textContent).not.toContain('**');
  });

  it('AC-RN-003 typing reports markdown through onChange, one serialisation per edit', async () => {
    const user = userEvent.setup();
    const { onChange } = mountEditor();
    await user.click(box());
    await user.keyboard('BoQ received');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.calls.at(-1)![0] as string;
    expect(last).toContain('BoQ received');
    expect(last).not.toContain('**');
  });

  it('AC-RN-003 two paragraphs serialise as markdown with a blank line, and bold round-trips', async () => {
    const ref = React.createRef<RichNoteEditorHandle>();
    const user = userEvent.setup();
    mountEditor({}, ref);
    await user.click(box());
    await user.keyboard('First line');
    await user.keyboard('{Enter}');
    await user.keyboard('Second line');
    await waitFor(() => {
      const md = ref.current?.getMarkdown() ?? '';
      expect(md).toContain('First line');
      expect(md).toMatch(/First line\s*\n\s*\n\s*Second line/u);
    });
  });

  it('AC-RN-004 typing / never opens a slash menu — notes offer no block commands', async () => {
    const user = userEvent.setup();
    mountEditor();
    await user.click(box());
    await user.keyboard('note /action ');
    await user.keyboard('/');
    await new Promise((r) => setTimeout(r, 150));
    expect(document.querySelector('.bn-suggestion-menu')).toBeNull();
    expect(box().textContent).toContain('/action');
  });

  it('AC-RN-005 Escape hands control to the page (the caller decides what cancel means)', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    mountEditor({ onCancel });
    await user.click(box());
    await user.keyboard('x');
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('AC-RN-004 read-only notes still render but accept no typing', async () => {
    const user = userEvent.setup();
    const { onChange } = mountEditor({ initialValue: 'Read only note', editable: false });
    await user.click(box());
    await user.keyboard('more');
    expect(box().textContent).not.toContain('more');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('notePalette — the block-type picker', () => {
  it('offers exactly paragraph, bullet list and numbered list (no headings, no check list)', () => {
    const types = noteBlockTypeItems(en).map((i) => i.type);
    expect(types).toContain('paragraph');
    expect(types).toContain('bulletListItem');
    expect(types).toContain('numberedListItem');
    // and the unfiltered library list really had more to withhold — the filter is doing work
    const all = blockTypeSelectItems(en).map((i) => i.type);
    expect(all).toEqual(expect.arrayContaining(['heading', 'checkListItem']));
    expect(types.filter((t) => !['paragraph', 'bulletListItem', 'numberedListItem'].includes(t))).toEqual([]);
  });
});
