import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserRow, UserRole } from '@/src/lib/db/adminUsers';

/**
 * Directory presentation helpers for Administration › Users (CROSS-65 / XG01-002): the role
 * labels, avatar initials/hue and the avatar tile, moved off AdminUsers. Pure presentation —
 * no data, no authorization, no mutations.
 */

/**
 * The five user_role enum values, ordered for the role <select>, with their display names. A role is
 * NAMED in many places (pill, both selects, the manager combobox, confirm titles, toasts), so its
 * translation lives here once. The stored enum value (`UserRole`) is never translated.
 */
export function useRoleLabels(): {
  label: (role: UserRole) => string;
  options: { value: UserRole; label: string }[];
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const labels: Record<UserRole, string> = {
      Engineer: t('admin.roles.engineer', 'Engineer'),
      'Project Manager': t('admin.roles.projectManager', 'Project Manager'),
      Finance: t('admin.roles.finance', 'Finance'),
      Executive: t('admin.roles.executive', 'Executive'),
      Admin: t('admin.roles.admin', 'Admin'),
    };
    const order: UserRole[] = ['Engineer', 'Project Manager', 'Finance', 'Executive', 'Admin'];
    return {
      label: (role) => labels[role],
      options: order.map((value) => ({ value, label: labels[value] })),
    };
  }, [t]);
}

/** Deterministic two-letter initials for the avatar tile. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Stable avatar background from the categorical palette (token-driven hues only).
 * These `--avatar-*` tokens are AA-hardened solids (index.css) — same H/S family as
 * `--primary`/`--violet`/`--success`/`--warning`/`--muted-foreground` but darkened so
 * BOLD WHITE initials clear 4.5:1 in both themes (the raw tokens do not — e.g. raw
 * `--warning` is 1.97:1 with white text). Exported so tests can enumerate every hue
 * the picker can return and re-verify contrast (the durable AA gate).
 */
// eslint-disable-next-line react-refresh/only-export-components -- token array co-located with the Avatar it feeds; HMR-only lint concern
export const AVATAR_HUES = [
  'hsl(var(--avatar-1))',
  'hsl(var(--avatar-2))',
  'hsl(var(--avatar-3))',
  'hsl(var(--avatar-4))',
  'hsl(var(--avatar-5))',
];
export function avatarHue(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

export const Avatar: React.FC<{ user: UserRow; size?: number }> = ({ user, size = 30 }) => (
  <span
    aria-hidden
    className="grid shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
    style={{ width: size, height: size, background: avatarHue(user.id) }}
  >
    {initialsOf(user.full_name)}
  </span>
);
