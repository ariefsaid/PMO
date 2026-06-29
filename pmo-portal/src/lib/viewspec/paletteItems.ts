/**
 * Pure helper: maps a list of user views to PaletteItem[] for the 'Views' ⌘K group.
 * Extracted here so App.tsx can remain a component-only export file (react-refresh).
 * Exported for unit-testing (AC-VR-016 / FR-VR-070..074); has no side-effects.
 */
import type { PaletteItem } from '@/src/components/shell';

export function buildViewsPaletteItems(
  views: { id: string; name: string; description?: string | null }[] | undefined,
  navigate: (path: string) => void,
): PaletteItem[] {
  if (!views || views.length === 0) return [];
  return views.map((view) => ({
    id: `view-${view.id}`,
    group: 'Views',
    title: view.name,
    sub: view.description ?? undefined,
    icon: 'grid' as const,
    run: () => navigate(`/views/${view.id}`),
  }));
}
