import type { MouseEvent } from 'react';

/** Reveal the owning disclosure before following a dashboard note fragment. */
export function revealDashboardNote(event: MouseEvent<HTMLAnchorElement>) {
  const disclosure = document.getElementById(event.currentTarget.hash.slice(1))?.closest('details');
  if (disclosure) disclosure.open = true;
}
