import React from 'react';
import { ListState } from '@/src/components/ui';
import type { IconName } from '@/src/components/ui';

interface PlaceholderPageProps {
  title: string;
}

/**
 * C5 — a calm, on-brand placeholder for routes that exist in the IA but have no
 * surface yet (Tasks / Companies / Work Orders / Reports / Administration).
 * Built on the design-system `ListState variant="empty"` (52px secondary icon
 * tile + foreground title + muted sub) — no emoji, no legacy `text-gray-*` /
 * `dark:` classes, no dead CTA. Copy is brief and concrete (no buzzwords, no
 * em-dash). Left-aligned (per audit) rather than the centered ListState default.
 */
interface PlaceholderMeta {
  icon: IconName;
  sub: string;
}

/** Per-route icon (from the existing ICON_PATHS set) + concrete supporting copy. */
const META: Record<string, PlaceholderMeta> = {
  Tasks: { icon: 'check', sub: 'Task tracking arrives in a later release.' },
  Companies: { icon: 'folder', sub: 'Company records arrive in a later release.' },
  'Work Orders': { icon: 'cart', sub: 'Work orders arrive in a later release.' },
  Reports: { icon: 'grid', sub: 'Reporting arrives in a later release.' },
  Administration: { icon: 'admin', sub: 'Administration settings arrive in a later release.' },
};

const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ title }) => {
  const meta = META[title] ?? { icon: 'inbox' as IconName, sub: 'This section arrives in a later release.' };
  return (
    <ListState
      variant="empty"
      icon={meta.icon}
      title={title}
      sub={meta.sub}
      className="items-start py-16 text-left"
    />
  );
};

export default PlaceholderPage;
