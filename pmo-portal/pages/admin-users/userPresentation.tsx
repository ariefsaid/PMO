import React from 'react';
import type { UserRow } from '@/src/lib/db/adminUsers';
import { avatarHue, initialsOf } from './avatar';

/**
 * Directory presentation for Administration › Users (CROSS-65 / XG01-002): the avatar tile.
 * Role labels live in roleLabels.ts, the hue/initial helpers in avatar.ts — pure presentation,
 * no data, no authorization, no mutations.
 */
export const Avatar: React.FC<{ user: UserRow; size?: number }> = ({ user, size = 30 }) => (
  <span
    aria-hidden
    className="grid shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
    style={{ width: size, height: size, background: avatarHue(user.id) }}
  >
    {initialsOf(user.full_name)}
  </span>
);
