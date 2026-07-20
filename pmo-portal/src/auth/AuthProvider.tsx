import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/src/lib/supabase/client';
import { trackAuthLogoutSucceeded } from '@/src/lib/analytics';
import { AuthContext, type Profile } from './AuthContext';

type ProfileErrorKind = 'not_provisioned' | 'load_error';

type ProfileResult =
  | { profile: Profile; error: null; errorKind: null }
  | { profile: null; error: string; errorKind: ProfileErrorKind };

// PostgREST returns PGRST116 ("Cannot coerce the result to a single JSON object") when
// .single() matches zero (or more than one) rows — here, zero rows means the signed-in
// user has no `profiles` row yet (e.g. SSO sign-in before being invited to an org). That
// is a distinct, non-retryable state from a transient/generic load failure.
function classifyProfileError(error: { code?: string; message?: string | null }): ProfileErrorKind {
  if (error.code === 'PGRST116') return 'not_provisioned';
  if (/coerce the result to a single JSON object|multiple \(or no\) rows/i.test(error.message ?? '')) {
    return 'not_provisioned';
  }
  return 'load_error';
}

async function loadProfile(userId: string): Promise<ProfileResult> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) return { profile: null, error: error.message, errorKind: classifyProfileError(error) };
  return { profile: data, error: null, errorKind: null };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileErrorKind, setProfileErrorKind] = useState<ProfileErrorKind | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const apply = async (s: Session | null) => {
      if (!active) return;
      setSession(s);
      if (s?.user) {
        const result = await loadProfile(s.user.id);
        if (!active) return;
        if (result.error) {
          setCurrentUser(null);
          setProfileError(result.error);
          setProfileErrorKind(result.errorKind);
        } else {
          setCurrentUser(result.profile);
          setProfileError(null);
          setProfileErrorKind(null);
        }
      } else {
        setCurrentUser(null);
        setProfileError(null);
        setProfileErrorKind(null);
      }
      if (active) setLoading(false);
    };
    // AUDIT-M11 (2026-07-04 audit): a rejected getSession() must not strand the app on the
    // loading screen forever — treat it as signed-out and let the login flow take over.
    supabase.auth
      .getSession()
      .then(({ data }) => apply(data.session))
      .catch(() => void apply(null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      void apply(s);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signInWithMagicLink = useCallback(async (email: string) => {
    // shouldCreateUser: false — magic links must NOT auto-create accounts for unknown emails.
    // Prod also requires enable_signup=false in the Supabase project auth config (flag only; not set here).
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin,
      },
    });
    return { error: error?.message ?? null };
  }, []);

  const signInWithMicrosoft = useCallback(async () => {
    // Entra ID (work/school) sign-in — Supabase provider name is `azure`. Multi-tenant: the
    // provider's tenant is configured server-side (GoTrue), never in client code. Sign-ups are
    // still gated by the project's signup/invite policy — OAuth is an authentication method,
    // not an enrollment bypass. Origin-rooted redirectTo (D-AUTHF-8; no open redirect).
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'openid profile email',
        redirectTo: window.location.origin,
      },
    });
    return { error: error?.message ?? null };
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    // FR-AUTHF-015/050: origin-rooted redirectTo (no open redirect; D-AUTHF-8).
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });
    return { error: error?.message ?? null };
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    // FR-AUTHF-035: clear invite_pending in the SAME updateUser call (idempotent for the pure-reset
    // case, where the flag was never set). data == user_metadata (supabase-js v2).
    const { error } = await supabase.auth.updateUser({
      password,
      data: { invite_pending: false },
    });
    return { error: error?.message ?? null };
  }, []);

  const resendEmailConfirmation = useCallback(async (email: string) => {
    // FR-AUTHF-041/050: origin-rooted emailRedirectTo (D-AUTHF-8).
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    // auth_logout_succeeded (2026-07-13 wiring plan; FIX 2 — a failed signOut is not a
    // "succeeded" event) — role rides the already-registered super-property (set at
    // `identify()`), so nothing needs to be passed explicitly, and nothing here needs
    // to race the `onAuthStateChange` reset that clears it.
    if (!error) trackAuthLogoutSucceeded();
  }, []);

  const value = useMemo(
    () => ({
      session,
      currentUser,
      role: currentUser?.role ?? null,
      loading,
      profileError,
      profileErrorKind,
      signInWithPassword,
      signInWithMagicLink,
      signInWithMicrosoft,
      requestPasswordReset,
      updatePassword,
      resendEmailConfirmation,
      signOut,
    }),
    [
      session,
      currentUser,
      loading,
      profileError,
      profileErrorKind,
      signInWithPassword,
      signInWithMagicLink,
      signInWithMicrosoft,
      requestPasswordReset,
      updatePassword,
      resendEmailConfirmation,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
