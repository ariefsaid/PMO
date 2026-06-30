/**
 * Tests for useAssistantHotkey
 * AC-AP-003 (part 1): ⌘J toggles via the document hotkey
 * FR-AP-004: flag-gated
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, fireEvent } from '@testing-library/react';

// Import AFTER potential module mock
let useAssistantHotkey: (opts: { enabled: boolean; onToggle: () => void }) => void;

describe('useAssistantHotkey', () => {
  beforeEach(async () => {
    // Dynamic import so the module is loaded fresh each test suite
    const mod = await import('./useAssistantHotkey');
    useAssistantHotkey = mod.useAssistantHotkey;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC-AP-003 ⌘J toggles via the document hotkey', () => {
    const onToggle = vi.fn();
    renderHook(() => useAssistantHotkey({ enabled: true, onToggle }));

    // First press — should call onToggle
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);

    // Second press — should call onToggle again
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('AC-AP-003 Ctrl+J also toggles (Windows/Linux)', () => {
    const onToggle = vi.fn();
    renderHook(() => useAssistantHotkey({ enabled: true, onToggle }));

    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('AC-AP-003 uppercase J also triggers', () => {
    const onToggle = vi.fn();
    renderHook(() => useAssistantHotkey({ enabled: true, onToggle }));

    fireEvent.keyDown(document, { key: 'J', metaKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('flag-off: enabled=false → keydown does NOT call onToggle (FR-AP-001)', () => {
    const onToggle = vi.fn();
    renderHook(() => useAssistantHotkey({ enabled: false, onToggle }));

    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('cleans up the event listener on unmount', () => {
    const onToggle = vi.fn();
    const { unmount } = renderHook(() =>
      useAssistantHotkey({ enabled: true, onToggle }),
    );
    unmount();

    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });
});
