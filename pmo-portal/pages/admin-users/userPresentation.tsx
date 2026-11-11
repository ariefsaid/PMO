import React from 'react';
import type { UserRow } from '@/src/lib/db/adminUsers';
import { avatarHue, initialsOf } from './avatar';

/**
 * Directory presentation for Administration › Users (CROSS-65 / XG01-002): the avatar tile.
 * Role labels live in roleLabels.ts, the hue/initial helpers in avatar.ts — pure presentation,
 * no data, no authorization, no mutations. The tile is a FIXED 30px in the directory row —
 * the single size the layout is built around (no callers vary it).
 */
export const Avatar: React.FC<{ user: Pick<UserRow, 'id' | 'full_name'> }> = ({ user }) => (
  <span
    aria-hidden
    className="grid shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
    style={{ width: 30, height: 30, background: avatarHue(user.id) }}
  >
    {initialsOf(user.full_name)}
  </span>
);
