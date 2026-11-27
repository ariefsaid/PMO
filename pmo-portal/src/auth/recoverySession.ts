import type { AuthChangeEvent } from '@supabase/supabase-js';

// Retain the verified event while a public route's code is still loading.
// Keep this in memory only and bind it to the exact session, never to a URL flag.
let recoveryToken: string | null = null;
export const recoverySession = {
  record(event: AuthChangeEvent, session: { access_token: string } | null) {
    if (event === 'PASSWORD_RECOVERY') recoveryToken = session?.access_token ?? null;
    else if (!session || (recoveryToken && session.access_token !== recoveryToken)) recoveryToken = null;
  },
  matches(session: { access_token?: string } | null) {
    return recoveryToken !== null && session?.access_token === recoveryToken;
  },
};
