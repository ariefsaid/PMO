import React, { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useWaitingForYou } from '@/src/hooks/useWaitingForYou';

/**
 * The Approvals badge reads the SAME shared list as the home and the inbox (`useWaitingForYou`), so the three can never
 * disagree (fix-waiting item 1). While the list refreshes, keep the last complete count for this signed-in user and role
 * until the next complete read replaces it; a partial read (a kind still loading or failed) never shows as the total.
 */
const LiveCount: React.FC<{ badge: boolean }> = ({ badge }) => {
  const { t } = useTranslation();
  const auth = useContext(AuthContext);
  const currentUser = auth?.currentUser;
  const role = auth?.role ?? null;
  const { effectiveRole } = useEffectiveRole();
  const scopeKey = JSON.stringify([currentUser?.org_id ?? null, currentUser?.id ?? null, role, effectiveRole]);
  const waiting = useWaitingForYou();
  const [retained, setRetained] = useState<{ scope: string; count: number } | null>(null);
  useEffect(() => {
    setRetained((current) => current?.scope === scopeKey ? current : null);
  }, [scopeKey]);
  useEffect(() => {
    if (currentUser && role && waiting.count !== undefined) setRetained({ scope: scopeKey, count: waiting.count });
  }, [currentUser, role, scopeKey, waiting.count]);

  const visibleCount = waiting.count !== undefined ? waiting.count : retained?.scope === scopeKey ? retained.count : null;
  if (visibleCount === null) return null;

  return (
    <span className={badge ? 'absolute -right-3 -top-1.5 inline-flex' : 'ml-auto inline-flex shrink-0 items-center gap-1.5'}>
      <span
        className={badge
          ? 'tabular inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] font-semibold leading-4 text-primary-foreground'
          : 'tabular text-support text-muted-foreground'}
        aria-hidden="true"
      >
        {visibleCount}
      </span>
      <span className="sr-only">
        , {t('shell.rail.approvalsCountSuffix', '{{count}} pending', { count: visibleCount })}
      </span>
    </span>
  );
};

export const ApprovalsNavCount: React.FC<{ badge?: boolean }> = ({ badge = false }) => {
  const auth = useContext(AuthContext);
  // A bare render (no signed-in person) has nothing to count.
  if (!auth?.currentUser || !auth.role) return null;
  return <LiveCount badge={badge} />;
};
