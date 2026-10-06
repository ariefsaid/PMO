import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import i18n from 'i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { getTask } = vi.hoisted(() => ({ getTask: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { task: { get: getTask } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import MinutesEditor, { type MinutesEditorHandle, type MinutesEditorProps } from './MinutesEditor';

// jsdom has no layout engine: the floating slash menu asks for geometry it cannot give. Everything else is real.
beforeAll(() => {
  const zeroRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  (document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
  Element.prototype.getBoundingClientRect = zeroRect;
  Range.prototype.getBoundingClientRect = zeroRect;
  Range.prototype.getClientRects = (() => []) as never;
});

const para = (text: string) => ({ type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }) as never;
const emptyBullet = { type: 'bulletListItem', props: {}, content: [], children: [] } as never;

const handles: React.RefObject<MinutesEditorHandle | null>[] = [];
const mount = (props: Partial<MinutesEditorProps> = {}) => {
  const ref = React.createRef<MinutesEditorHandle>();
  handles.push(ref);
  const cb = { onReady: vi.fn(), onChange: vi.fn(), onRequestAction: vi.fn() };
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MinutesEditor ref={ref} initialBlocks={[emptyBullet]} editable tasksExternal={false} {...cb} {...props} />
    </QueryClientProvider>,
  );
  return { ref, ...cb, ...view };
};
const box = () => screen.getByRole('textbox', { name: 'Meeting minutes' });
/** The doc most recently reported through onChange. */
const lastDoc = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)![0] as Array<{ type: string; props: { taskId?: string }; content?: Array<{ text: string }> }>;
const textOf = (b: { content?: Array<{ text: string }> }) => (b.content ?? []).map((r) => r.text).join('');

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

describe('MinutesEditor — real BlockNote in the DOM', () => {
  // WCAG 4.1.2: the element WITH role=textbox needs the name; a label on a wrapper div does not count (axe aria-input-field-name).
  it.each([
    ['editable', true],
    ['read-only', false],
  ])('AC-MTG-023 the %s minutes text box has an accessible name on the textbox element itself', (_n, editable) => {
    mount({ editable });
    expect(box()).toHaveClass('bn-editor');
    expect(box().getAttribute('aria-label')).toBe('Meeting minutes');
    // …and no stray label on a role-less wrapper
    expect(document.querySelector('.bn-container')?.hasAttribute('aria-label')).toBe(false);
  });

  // BlockNote injects one <style> of CSS rules for placeholders; a per-block-type rule shows "List" on every empty bullet.
  it.each([
    ['editable', true],
    ['read-only', false],
  ])('AC-MTG-022 (%s) no per-block-type placeholder rule is injected — an empty bullet shows no "List"', (_n, editable) => {
    mount({ editable });
    const blob = Array.from(document.styleSheets).flatMap((s) => Array.from(s.cssRules).map((r) => r.cssText)).join('\n');
    // non-vacuous: the focus-scoped rule IS there, so the sheet was parsed
    expect(blob).toMatch(/data-is-empty-and-focused/);
    expect(blob).not.toMatch(/content-type="bulletListItem"/);
    expect(blob).not.toMatch(/"List"/);
  });

  it('AC-MTG-021 reports its normalised starting document ONCE, as the dirty-check baseline', () => {
    const { onReady, onChange } = mount({ initialBlocks: [para('Agenda')] });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0].map((b: { type: string }) => b.type)).toEqual(['paragraph']);
    expect(textOf(onReady.mock.calls[0][0][0])).toBe('Agenda');
    expect(onChange).not.toHaveBeenCalled(); // mounting is not an edit
  });

  it('AC-MTG-021 an empty saved document still gives the editor a block and a baseline', () => {
    const { onReady } = mount({ initialBlocks: [] });
    expect(onReady.mock.calls[0][0]).toHaveLength(1);
    expect(onReady.mock.calls[0][0][0].type).toBe('paragraph');
  });

  it('AC-MTG-021 typing reports the edited document through onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = mount({ initialBlocks: [] });
    await user.click(box());
    await user.keyboard('Order flange samples');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(textOf(lastDoc(onChange)[0])).toBe('Order flange samples');
  });

  it('read-only: the text box is not editable, shows the saved text, and typing / opens no menu', async () => {
    const user = userEvent.setup();
    const { onChange } = mount({ editable: false, initialBlocks: [para('Agenda')] });
    expect(box()).toHaveAttribute('contenteditable', 'false');
    expect(box()).toHaveTextContent('Agenda');
    await user.click(box());
    await user.keyboard('/');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('AC-MTG-022 the slash menu opens with "Action item" FIRST and no check list', async () => {
    const user = userEvent.setup();
    mount({ initialBlocks: [] });
    await user.click(box());
    await user.keyboard('/');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveTextContent('Action item');
    expect(options.map((o) => o.textContent).join('|')).not.toMatch(/Check List/i);
    expect(options.map((o) => o.textContent).join('|')).toMatch(/Bullet List/);
  });

  it('§8.5 with externally-owned tasks /action is not offered', async () => {
    const user = userEvent.setup();
    mount({ initialBlocks: [], tasksExternal: true });
    await user.click(box());
    await user.keyboard('/');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent).join('|')).not.toMatch(/Action item/);
  });

  it('AC-MTG-060 choosing "Action item" asks the page for the modal with the line text — and changes nothing yet', async () => {
    const user = userEvent.setup();
    const { onRequestAction, onChange } = mount({ initialBlocks: [] });
    await user.click(box());
    await user.keyboard('Confirm crane schedule /');
    await user.click((await screen.findAllByRole('option'))[0]);
    expect(onRequestAction).toHaveBeenCalledTimes(1);
    expect(onRequestAction.mock.calls[0][0].trim()).toBe('Confirm crane schedule');
    // the line is untouched until a task exists (a cancelled modal must lose nothing)
    expect(textOf(lastDoc(onChange)[0]).trim()).toBe('Confirm crane schedule');
  });

  it('AC-MTG-060 once the task exists the invoking line is REPLACED by the block, which shows the live task', async () => {
    getTask.mockResolvedValue({ id: 't1', name: 'Confirm crane schedule', status: 'Not Started', end_date: null, assignee: null });
    const user = userEvent.setup();
    const { ref, onChange } = mount({ initialBlocks: [] });
    await user.click(box());
    await user.keyboard('Confirm crane schedule /');
    await user.click((await screen.findAllByRole('option'))[0]);
    act(() => ref.current!.insertActionItem('t1'));
    const doc = lastDoc(onChange);
    expect(doc.map((b) => b.type)).toEqual(['actionItem']);
    expect(doc[0].props.taskId).toBe('t1');
    expect(JSON.stringify(doc)).not.toContain('Confirm crane schedule'); // no duplicated text
    expect(await screen.findByTestId('action-item')).toHaveTextContent('Confirm crane schedule');
  });

  it('AC-MTG-060 with no remembered line the block goes at the end of the document', async () => {
    getTask.mockResolvedValue(null);
    const { ref, onChange } = mount({ initialBlocks: [para('Agenda')] });
    act(() => ref.current!.insertActionItem('t9'));
    expect(lastDoc(onChange).map((b) => b.type)).toEqual(['paragraph', 'actionItem']);
    expect(lastDoc(onChange)[1].props.taskId).toBe('t9');
    expect(await screen.findByTestId('action-item-tombstone')).toBeInTheDocument(); // an unresolved id degrades, never crashes
  });

  it('FR-MTG-023 the dictionary is fixed per editor instance: a locale switch neither re-seeds nor re-translates', async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage('id');
    const { onReady } = mount({ initialBlocks: [] });
    await i18n.changeLanguage('en'); // after mount
    await user.click(box());
    await user.keyboard('/');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent).join('|')).toMatch(/Judul 1/); // still Bahasa
    expect(onReady).toHaveBeenCalledTimes(1); // and the editor was not rebuilt
  });

  it('dark theme: the editor follows the app theme', () => {
    document.documentElement.classList.add('dark');
    try {
      mount();
      expect(document.querySelector('.bn-container')).toHaveAttribute('data-color-scheme', 'dark');
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });
});
