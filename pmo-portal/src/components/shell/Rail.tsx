import React from 'react';
import { NavLink } from 'react-router-dom';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { UserRole } from '@/types';
import { cn } from '@/src/components/ui/cn';
import { Icon, type IconName } from '@/src/components/ui/icons';

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
  group: 'Overview' | 'CRM' | 'Delivery' | 'Workforce';
}

// Role arrays preserved VERBATIM from Sidebar.tsx getNavItems (AC-AUTH-003/009/010/011).
const ALL_ITEMS: NavItem[] = [
  { to: '/', text: 'Dashboard', icon: 'grid', group: 'Overview', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/projects', text: 'Projects', icon: 'folder', group: 'Delivery', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/sales', text: 'Sales Pipeline', icon: 'pipe', group: 'CRM', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/procurement', text: 'Procurement', icon: 'cart', group: 'Delivery', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/timesheets', text: 'Timesheets', icon: 'clock', group: 'Workforce', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Engineer, UserRole.Admin] },
  // B-2 (AC-W2-IXD-003 / OD-W2-2): Approvals nav is limited to roles that CAN approve.
  // Engineer approval stays OFF (OD-W2-2 decision) — an IC landing on /approvals sees only
  // "sheets from your reports" which is misleading. Finance is now included: Finance approves
  // *procurement* (policy.ts `transition: allow([...MASTER_DATA])`) and reaches /approvals
  // only via a dashboard tile without the rail. Fix #7: add Finance to this list.
  { to: '/approvals', text: 'Approvals', icon: 'check', group: 'Workforce', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // Standalone /tasks nav removed — real Tasks CRUD lives in the project Tasks tab
  // (rbac-visibility §M.1: Tasks are reached through project detail, not a top-level nav).
  { to: '/companies', text: 'Companies', icon: 'doc', group: 'CRM', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // Contacts (CRM v1): master-data directory of people, mirrors Companies — Exec·PM·Finance·Admin (Engineer = ○).
  { to: '/contacts', text: 'Contacts', icon: 'doc', group: 'CRM', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // Incidents is visible to EVERY role — any member may file an incident (rbac-visibility.md §A/§G).
  { to: '/incidents', text: 'Incidents', icon: 'alert', group: 'Delivery', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // B-1 (AC-W2-IXD-001 / OD-W2-4): My Tasks — IC (Engineer) own-assigned cross-project list.
  // An Engineer lands on something actionable rather than the all-projects financial table.
  // Admin is included for parity (Admin may also have tasks assigned to them).
  // Executives and managers use the project Tasks tab for their task oversight (OD-W2-4).
  { to: '/my-tasks', text: 'My Tasks', icon: 'check', group: 'Workforce', roles: [UserRole.Engineer, UserRole.Admin] },
  // Reports is demoted from the rail until the module ships (AC-IXD-DASH-004 / IA F8): an unbuilt
  // module must not be a top-slot nav item leading to an empty stub. The /reports <Route> is kept
  // (App.tsx) so a stray deep link still resolves to the honest "arrives later" placeholder.
];

const GROUP_ORDER: NavItem['group'][] = ['Overview', 'CRM', 'Delivery', 'Workforce'];

/** Base classes shared by every nav anchor (primary items + Administration foot). */
const NAV_LINK_BASE =
  'flex h-9 w-full items-center gap-[11px] rounded-md px-2.5 text-[13.5px] font-medium transition-colors [&_svg]:size-[17px] [&_svg]:shrink-0';

/** The two items that get stage-aware active-state overrides on `/projects/:id`. */
const STAGE_AWARE_PATHS = new Set(['/projects', '/sales']);

export interface RailProps {
  onNavigate?: () => void;
  /**
   * Stage-aware active-item override for `/projects/:id` detail routes (Option A, Task D).
   *
   * When non-null, the "Projects" (/projects) and "Sales Pipeline" (/sales) items switch
   * their active class from NavLink's URL-based `isActive` to this override:
   *   'salesPipeline' → Sales Pipeline active, Projects inactive
   *   'projects'      → Projects active, Sales Pipeline inactive
   *   null            → both items fall back to NavLink URL-based behaviour (unchanged)
   */
  railActiveOverride?: 'salesPipeline' | 'projects' | null;
}

export const Rail: React.FC<RailProps> = ({ onNavigate, railActiveOverride }) => {
  const { effectiveRole } = useEffectiveRole();
  const role = toUserRole(effectiveRole);

  if (!role) return null;

  const items = ALL_ITEMS.filter((i) => i.roles.includes(role));

  const renderItem = (item: NavItem) => {
    // For the two stage-aware items, when an override is set, drive active from
    // the override instead of NavLink's built-in URL-prefix matching.
    const isStageAware = railActiveOverride != null && STAGE_AWARE_PATHS.has(item.to);

    if (isStageAware) {
      const overrideActive =
        (item.to === '/projects' && railActiveOverride === 'projects') ||
        (item.to === '/sales' && railActiveOverride === 'salesPipeline');
      return (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          // Ignore NavLink's built-in isActive; use the override decision.
          className={() =>
            cn(
              NAV_LINK_BASE,
              overrideActive
                ? 'bg-primary/10 font-semibold text-primary'
                : 'text-foreground hover:bg-accent',
            )
          }
        >
          <Icon name={item.icon} />
          <span>{item.text}</span>
        </NavLink>
      );
    }

    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/'}
        onClick={onNavigate}
        className={({ isActive }: { isActive: boolean }) =>
          cn(
            NAV_LINK_BASE,
            isActive
              ? 'bg-primary/10 font-semibold text-primary'
              : 'text-foreground hover:bg-accent',
          )
        }
      >
        <Icon name={item.icon} />
        <span>{item.text}</span>
      </NavLink>
    );
  };

  return (
    <div
      className="flex min-h-0 flex-col border-r border-border bg-card"
      style={{ gridArea: 'rail' }}
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

      <nav aria-label="Primary navigation" className="min-h-0 flex-1 overflow-y-auto p-2.5">
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
    </div>
  );
};
