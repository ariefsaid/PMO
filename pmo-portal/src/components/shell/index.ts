export { AppShell, type AppShellProps } from './AppShell';
export { Rail } from './Rail';
export { ContextBar, type ContextBarProps } from './ContextBar';
export { TabStrip, type TabStripProps } from './TabStrip';
export { CommandPalette, type PaletteItem, type CommandPaletteProps } from './CommandPalette';
export { Breadcrumb, type BreadcrumbPart, type BreadcrumbProps } from './Breadcrumb';
export { BackBar, type BackBarProps } from './BackBar';
export {
  WorkspaceTabsProvider,
  useWorkspaceTabs,
  useWorkspaceTabsOptional,
  type WorkspaceContextValue,
} from './WorkspaceTabsProvider';
export {
  type WorkspaceTab,
  type WorkspaceState,
  type TabKind,
  DASHBOARD_TAB,
} from './workspaceTabs';
export { MODULES, moduleTab, tabForPath, breadcrumbForPath } from './routeMatch';
export { deriveBreadcrumb, PLACEHOLDER_TITLES } from './deriveBreadcrumb';
