import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';

export const RequireAuth: React.FC = () => {
  const { session, loading, profileError } = useAuth();
  if (loading)
    return (
      <div role="status" aria-live="polite" className="p-8 text-gray-500">
        Loading…
      </div>
    );
  if (!session) return <Navigate to="/login" replace />;
  if (profileError)
    return (
      <div role="alert" className="p-8 text-red-600">
        <p className="font-semibold">Unable to load your profile.</p>
        <p className="mt-1 text-sm text-gray-600">{profileError}</p>
        <button
          className="mt-4 text-sm text-primary-600 underline"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  return <Outlet />;
};
