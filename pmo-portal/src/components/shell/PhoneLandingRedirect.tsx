import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';

/**
 * #2061 — on a phone, the app opens on the my-queue Home instead of the executive dashboard.
 *
 * Fires ONCE per app run (a ref, not a route guard) and only for a landing on `/`: a phone user
 * who then opens Dashboard from the More drawer stays there, and every deep link (`/projects/:id`,
 * `/procurement/:id/:tab`, …) is untouched — nothing but the root is redirected.
 *
 * Desktop never redirects (`useIsNarrow` is false at ≥640px), so today's landing is unchanged.
 * Search and hash are carried across so a shared root URL keeps its query.
 */
export const PhoneLandingRedirect: React.FC = () => {
  const isNarrow = useIsNarrow();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const landed = useRef(false);

  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    if (isNarrow && pathname === '/') {
      navigate({ pathname: '/home', search, hash }, { replace: true });
    }
  }, [isNarrow, pathname, search, hash, navigate]);

  return null;
};

export default PhoneLandingRedirect;
