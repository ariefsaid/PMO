import React from 'react';
import { Link } from 'react-router-dom';
import { ListState, Icon } from '@/src/components/ui';
import type { IconName } from '@/src/components/ui';

interface PlaceholderPageProps {
  title: string;
}

/**
 * C5 / B-10 — a calm, on-brand placeholder for routes that exist in the IA but have no
 * surface yet. Built on the design-system `ListState variant="empty"` (52px secondary icon
 * tile + foreground title + muted sub) — no emoji, no legacy `text-gray-*` / `dark:` classes,
 * no dead CTA. Copy is brief and concrete (no buzzwords, no em-dash). Left-aligned (per audit).
 *
 * B-10 (AC-W2-IA-005): every placeholder is given a keyboard-reachable "Back to Dashboard"
 * link so a user who lands here via deep-link or ⌘K has a clear next step (not a blank
 * dead-end). Consistent with OD-UX-3: honest placeholder + a way back.
 */
interface PlaceholderMeta {
  icon: IconName;
  sub: string;
}

/** Per-route icon + concrete supporting copy. */
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
    <div>
      {/* C-MIN-3: page-level h1 so screen readers and document.querySelector('h1')
          find a level-1 heading. Token: DESIGN.md page-title (24px / 700 / –0.02em),
          matching Companies, MyTasks, Incidents etc. */}
      <h1 className="text-[24px] font-bold tracking-[-0.02em]">{title}</h1>
      <ListState
        variant="empty"
        icon={meta.icon}
        sub={meta.sub}
        className="items-start py-12 text-left"
      />
      {/* B-10 (AC-W2-IA-005): keyboard-reachable back action so a user who lands here via
          a deep-link or stale ⌘K entry has a clear next step (OD-W2-5 / OD-UX-3 precedent:
          honest placeholder with a way back). Rendered as a <Link> — a navigation action,
          not a form submit — so it gets the correct role="link" without wrapping a disabled
          button that can't receive focus. */}
      <div className="mt-4">
        <Link
          to="/"
          className="inline-flex h-7 items-center gap-[7px] rounded-lg border border-transparent bg-transparent px-[9px] text-[13px] font-medium text-foreground transition-colors hover:bg-accent [&_svg]:size-[15px] [&_svg]:shrink-0"
        >
          <Icon name="back" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
};

export default PlaceholderPage;
