import { describe, it, expect } from 'vitest';
import { minutesSchema } from './minutesSchema';

describe('minutesSchema — the typed block and the palette', () => {
  const action = minutesSchema.blockSchema.actionItem;

  it('AC-MTG-002 the actionItem block persists props.taskId only and declares NO inline content (FR-MTG-004)', () => {
    expect(action.content).toBe('none');
    expect(Object.keys(action.propSchema)).toEqual(['taskId']);
    expect(action.propSchema.taskId.default).toBe('');
  });

  it('FR-MTG-006 actionItem is the only custom block type', () => {
    const builtin = new Set([
      'paragraph', 'heading', 'quote', 'codeBlock', 'bulletListItem', 'numberedListItem',
      'checkListItem', 'toggleListItem', 'divider', 'table',
    ]);
    const custom = Object.keys(minutesSchema.blockSchema).filter((k) => !builtin.has(k));
    expect(custom).toEqual(['actionItem']);
  });

  it('AC-MTG-026 / FR-MTG-022 the palette has no image, video, audio or file block', () => {
    for (const t of ['image', 'video', 'audio', 'file']) {
      expect(Object.keys(minutesSchema.blockSchema)).not.toContain(t);
    }
  });
});
