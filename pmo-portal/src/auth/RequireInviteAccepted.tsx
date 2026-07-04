import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';

/**
 * Sibling invite-pending gate (FR-AUTHF-034, I-1 GATE decision). Mounts INSIDE <RequireAuth />
 * (session + profile already resolved) and WRAPS the protected shell. While the signed-in user
 * carries user_metadata.invite_pending === true (the §1.2 INVITE_PENDING flag stamped by GTM
 * item 1a issuance), every protected route redirects to /update-password so an invitee cannot
 * browse the app passwordless. /update-password sits OUTSIDE this boundary → no loop
 * (NFR-AUTHF-REL-002); the success path clears invite_pending in the same updateUser call
 * (FR-AUTHF-035). A recovery-only session (flag absent/false) is NOT redirected (D-AUTHF-14).
 *
 * NOT a security boundary — user_metadata is user-writable; RLS bounds reads either way
 * (FR-AUTHF-034 honesty note). This is a UX / lockout-prevention gate.
 */
export const RequireInviteAccepted: React.FC = () => {
  const { session } = useAuth();
  const invitePending = session?.user?.user_metadata?.invite_pending === true;
  if (invitePending) return <Navigate to="/update-password" replace />;
  return <Outlet />;
};
