import React from 'react';
import { NavLink } from 'react-router-dom';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { UserRole } from '@/types';
import { cn } from '@/src/components/ui/cn';
import { Icon, type IconName } from '@/src/components/ui/icons';
import { useWorkspaceTabsOptional } from './WorkspaceTabsProvider';

// Map profiles.role string → UserRole enum explicitly (preserved from Sidebar.tsx).
// A future enum rename is a compile error here rather than a silent nav bug.
const ROLE_MAP: Record<string, UserRole> = {
  [UserRole.Executive]: UserRole.Executive,
  [UserRole.ProjectManager]: UserRole.ProjectManager,
  [UserRole.Finance]: UserRole.Finance,
  [UserRole.Engineer]: UserRole.Engineer,
  [UserRole.Admin]: UserRole.Admin,
};

function toUserRole(role: string | null): UserRole | null {
  if (!role) return null;
  return ROLE_MAP[role] ?? null;
}

interface NavItem {
  to: string;
  text: string;
  icon: IconName;
  roles: UserRole[];
  /** Owning rail group. */
  group: 'Overview' | 'Sales' | 'Delivery' | 'Workforce';
  /** When set, the item is a tracked workspace module (opens a module tab). */
  moduleKey?: string;
}

// Role arrays preserved VERBATIM from Sidebar.tsx getNavItems (AC-AUTH-003/009/010/011).
const ALL_ITEMS: NavItem[] = [
  { to: '/', text: 'Dashboard', icon: 'grid', group: 'Overview', moduleKey: 'dashboard', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/projects', text: 'Projects', icon: 'folder', group: 'Delivery', moduleKey: 'projects', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/sales', text: 'Sales Pipeline', icon: 'pipe', group: 'Sales', moduleKey: 'sales', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/procurement', text: 'Procurement', icon: 'cart', group: 'Delivery', moduleKey: 'procurement', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/timesheets', text: 'Timesheets', icon: 'clock', group: 'Workforce', moduleKey: 'timesheets', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Engineer, UserRole.Admin] },
  { to: '/approvals', text: 'Approvals', icon: 'check', group: 'Workforce', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Engineer, UserRole.Admin] },
  { to: '/tasks', text: 'Tasks', icon: 'table', group: 'Delivery', roles: [UserRole.ProjectManager, UserRole.Engineer, UserRole.Admin] },
  { to: '/companies', text: 'Companies', icon: 'doc', group: 'Sales', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/reports', text: 'Reports', icon: 'cols', group: 'Overview', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
];

const GROUP_ORDER: NavItem['group'][] = ['Overview', 'Sales', 'Delivery', 'Workforce'];

/** Base classes shared by every nav anchor (primary items + Administration foot). */
const NAV_LINK_BASE =
  'flex h-9 w-full items-center gap-[11px] rounded-md px-2.5 text-[13.5px] font-medium transition-colors [&_svg]:size-[17px] [&_svg]:shrink-0';

export const Rail: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
  const { effectiveRole } = useEffectiveRole();
  const ws = useWorkspaceTabsOptional();
  const role = toUserRole(effectiveRole);

  if (!role) return null;

  const items = ALL_ITEMS.filter((i) => i.roles.includes(role));

  /**
   * Build the onClick handler for a nav item.
   *
   * For module items: call openModule() so the workspace tab strip opens/refocuses
   * the correct tab. The NavLink still navigates via its href — openModule only
   * manages tab state (it already calls navigate internally, but the router-driven
   * URL change from the anchor click is the canonical source of truth and harmless
   * to call twice for the same path).
   *
   * For non-module items: just fire onNavigate (e.g. close mobile drawer).
   */
  const makeClickHandler = (item: NavItem) => () => {
    if (item.moduleKey && ws) ws.openModule(item.moduleKey);
    onNavigate?.();
  };

  const renderItem = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/'}
      onClick={makeClickHandler(item)}
      className={({ isActive }: { isActive: boolean }) =>
        cn(
          NAV_LINK_BASE,
          isActive
            ? 'bg-primary/10 font-semibold text-primary'
            : 'text-foreground hover:bg-accent'
        )
      }
    >
      <Icon name={item.icon} />
      <span>{item.text}</span>
    </NavLink>
  );

  return (
    <aside
      className="flex min-h-0 flex-col border-r border-border bg-card"
      style={{ gridArea: 'rail' }}
      aria-label="Primary navigation"
    >
      <div
        className="flex flex-shrink-0 items-center gap-2.5 border-b border-border px-4"
        style={{ height: 'var(--header-h)' }}
      >
        <span
          className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-primary text-sm font-bold text-primary-foreground"
          aria-hidden
        >
          P
        </span>
        <span className="text-[15px] font-bold tracking-[-0.01em]">PMO Portal</span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {GROUP_ORDER.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <React.Fragment key={group}>
              <div className="px-2 pb-1.5 pt-3.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {group}
              </div>
              {groupItems.map(renderItem)}
            </React.Fragment>
          );
        })}
      </nav>

      {(role === UserRole.Executive || role === UserRole.Admin) && (
        <div className="flex-shrink-0 border-t border-border p-2.5">
          <NavLink
            to="/administration"
            onClick={onNavigate}
            className={({ isActive }: { isActive: boolean }) =>
              cn(
                NAV_LINK_BASE,
                isActive
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'text-foreground hover:bg-accent'
              )
            }
          >
            <Icon name="admin" />
            <span>Administration</span>
          </NavLink>
        </div>
      )}
    </aside>
  );
};
