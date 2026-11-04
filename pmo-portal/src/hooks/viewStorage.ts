/**
 * sessionStorage key for the per-surface "view preference" map (e.g. Sales
 * Pipeline kanban|table, Projects board|table). Shared by the `use*View` hooks;
 * each surface reads/writes its own key inside the map.
 *
 * The literal value is preserved verbatim from the former tab store so any
 * preferences already persisted in a user's session survive the shell-nav
 * refactor that removed the tabbed-workspace layer.
 */
export const VIEWS_STORAGE_KEY = 'pmo.workspace.views';

/** Typed per-surface access to the shared session preference map. */
export function createViewStorage<K extends string, V extends string>(
  surfaceKey: K,
  values: readonly V[],
  fallback: V,
) {
  const isView = (value: unknown): value is V => values.some((candidate) => candidate === value);

  const read = (): V => {
    if (typeof sessionStorage === 'undefined') return fallback;
    try {
      const raw = sessionStorage.getItem(VIEWS_STORAGE_KEY);
      if (!raw) return fallback;
      const map = JSON.parse(raw) as Record<string, unknown> | null;
      const view = map && typeof map === 'object' ? map[surfaceKey] : undefined;
      return isView(view) ? view : fallback;
    } catch {
      return fallback;
    }
  };

  const write = (view: V): void => {
    if (typeof sessionStorage === 'undefined') return;
    try {
      let map: Record<string, unknown> = {};
      const raw = sessionStorage.getItem(VIEWS_STORAGE_KEY);
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            map = parsed as Record<string, unknown>;
          }
        } catch {
          /* Corrupt map: write a fresh preference map. */
        }
      }
      map[surfaceKey] = view;
      sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* Storage is best-effort; view preferences never block the page. */
    }
  };

  return { read, write };
}
