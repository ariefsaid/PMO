import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';
import { Button } from '../components/ui/Button';

// -----------------------------------------------------------------------
// RequireAuth — DESIGN.md token-pure reskin (IA-3 / RIS identity)
// No gray-* / dark: / primary-NNN utilities.
// Loading → centered spinner on tinted ground.
// ProfileError → tinted destructive banner with retry.
// -----------------------------------------------------------------------

/** Full-page loading state — tinted secondary ground, centered spinner */
const AuthLoading: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    aria-label="Authenticating…"
    className="flex min-h-[100dvh] items-center justify-center bg-secondary/35"
  >
    {/* Accessible spinner — matches Button's Spinner implementation */}
    <svg
      className="size-7 animate-spin text-primary"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
    <span className="sr-only">Authenticating…</span>
  </div>
);

/** Full-page profile-error state — destructive tinted banner + retry */
const ProfileErrorPage: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex min-h-[100dvh] items-center justify-center bg-secondary/35 px-4">
    <div className="w-full max-w-sm rounded-lg border border-destructive/30 bg-destructive/[0.07] p-5">
      <p
        className="text-[14px] font-semibold"
        style={{ color: 'hsl(0 72% 42%)' }}
        role="alert"
        aria-live="assertive"
      >
        Unable to load your profile.
      </p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{message}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() => window.location.reload()}
      >
        Retry
      </Button>
    </div>
  </div>
);

export const RequireAuth: React.FC = () => {
  const { session, loading, profileError } = useAuth();

  if (loading) return <AuthLoading />;
  if (!session) return <Navigate to="/login" replace />;
  if (profileError) return <ProfileErrorPage message={profileError} />;

  return <Outlet />;
};
