/**
 * useAssistantHotkey — registers ⌘J / Ctrl+J on the document to toggle the AssistantPanel.
 * Mirrors the CommandPalette ⌘K handler pattern from App.tsx.
 * FR-AP-004: only registered when enabled (FEATURES.agentAssistant).
 */
import { useLayoutEffect } from 'react';

interface UseAssistantHotkeyOptions {
  /** When false (flag off), no listener is registered. */
  enabled: boolean;
  onToggle: () => void;
}

export function useAssistantHotkey({ enabled, onToggle }: UseAssistantHotkeyOptions): void {
  // Attach before paint. Once the shell control is visible, the shortcut is
  // already live; an ordinary effect left a one-frame race in loaded CI runs.
  useLayoutEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        onToggle();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onToggle]);
}
