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
