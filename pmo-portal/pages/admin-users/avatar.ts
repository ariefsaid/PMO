import { initials } from '@/src/lib/initials';

/** Deterministic two-letter initials for the avatar tile (#1459: the one shared helper). */
export function initialsOf(name: string): string {
  return initials(name, { style: 'tile' });
}

/**
 * Stable avatar background from the categorical palette (token-driven hues only).
 * These `--avatar-*` tokens are AA-hardened solids (index.css) — same H/S family as
 * `--primary`/`--violet`/`--success`/`--warning`/`--muted-foreground` but darkened so
 * BOLD WHITE initials clear 4.5:1 in both themes (the raw tokens do not — e.g. raw
 * `--warning` is 1.97:1 with white text). Exported so tests can enumerate every hue
 * the picker can return and re-verify contrast (the durable AA gate).
 */
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
