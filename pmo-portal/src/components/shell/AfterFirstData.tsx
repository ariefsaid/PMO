import React, { useContext, useEffect, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';

const IDLE_MS = 300; // nothing fetched at all (cached or offline): do not wait for a fetch that never comes
const CEILING_MS = 4000; // a page that never goes quiet still gets its badge

import { AfterFirstDataContext } from './afterFirstDataContext';

/**
 * Holds secondary reads (the Approvals badge, on rail and phone bar alike) until the first screen's data settled or a ceiling,
 * so they do not compete with it on a slow link. Display timing only: same reads, same number, a moment later.
 */
export const AfterFirstData: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useContext(QueryClientContext);
  const [ready, setReady] = useState(!queryClient);
  useEffect(() => {
    if (!queryClient || ready) return;
    let sawFetch = false;
    const open = () => { unsubscribe(); clearTimeout(idle); clearTimeout(cap); setReady(true); };
    // (const timers below are read by `open` only after they exist: it runs from a later callback)
    const check = (idleElapsed = false) => {
      if (queryClient.isFetching() > 0) { sawFetch = true; return; }
      if (sawFetch || idleElapsed) open();
    };
    const unsubscribe = queryClient.getQueryCache().subscribe(() => check());
    const idle = setTimeout(() => check(true), IDLE_MS);
    const cap = setTimeout(open, CEILING_MS);
    return () => { unsubscribe(); clearTimeout(idle); clearTimeout(cap); };
  }, [queryClient, ready]);
  return <AfterFirstDataContext.Provider value={ready}>{children}</AfterFirstDataContext.Provider>;
};
