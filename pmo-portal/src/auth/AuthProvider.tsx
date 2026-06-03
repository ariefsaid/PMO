import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/src/lib/supabase/client';
import { AuthContext, type Profile } from './AuthContext';

type ProfileResult =
  | { profile: Profile; error: null }
  | { profile: null; error: string };

async function loadProfile(userId: string): Promise<ProfileResult> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) return { profile: null, error: error.message };
  return { profile: data, error: null };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
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
        } else {
          setCurrentUser(result.profile);
          setProfileError(null);
        }
      } else {
        setCurrentUser(null);
        setProfileError(null);
      }
      if (active) setLoading(false);
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
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

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      session,
      currentUser,
      role: currentUser?.role ?? null,
      loading,
      profileError,
      signInWithPassword,
      signInWithMagicLink,
      signOut,
    }),
    [session, currentUser, loading, profileError, signInWithPassword, signInWithMagicLink, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
