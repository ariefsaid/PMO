import { describe, it, expect } from 'vitest';
import { isSelfAuthored, type ClickUpHistoryItem } from './selfAuthored.ts';

describe('isSelfAuthored — the echo-loop break (PMO writes with a real ClickUp user, so our own writes fire webhooks back at us)', () => {
  it('drops (true) when every history_items entry is authored by our own actor id', () => {
    const items: ClickUpHistoryItem[] = [{ user: { id: 42 } }, { user: { id: 42 } }];
    expect(isSelfAuthored(items, 42)).toBe(true);
  });

  it('keeps (false) when a history_items entry is authored by a DIFFERENT actor', () => {
    const items: ClickUpHistoryItem[] = [{ user: { id: 42 } }, { user: { id: 99 } }];
    expect(isSelfAuthored(items, 42)).toBe(false);
  });

  it('keeps (false) when the only entry is authored by a different actor', () => {
    const items: ClickUpHistoryItem[] = [{ user: { id: 99 } }];
    expect(isSelfAuthored(items, 42)).toBe(false);
  });

  it('is safe on an empty history_items array — keeps (false), never drops without positive proof', () => {
    expect(isSelfAuthored([], 42)).toBe(false);
  });

  it('is safe on a missing/malformed user id — keeps (false), never drops on ambiguous data', () => {
    const items: ClickUpHistoryItem[] = [{ user: undefined }];
    expect(isSelfAuthored(items, 42)).toBe(false);
  });

  it('matches across the number/string boundary (ClickUp ids can arrive as either)', () => {
    const items: ClickUpHistoryItem[] = [{ user: { id: '42' } }];
    expect(isSelfAuthored(items, 42)).toBe(true);
  });
});
