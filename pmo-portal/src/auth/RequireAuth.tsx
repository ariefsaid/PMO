import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';

export const RequireAuth: React.FC = () => {
  const { session, loading } = useAuth();
  if (loading)
    return (
      <div role="status" aria-live="polite" className="p-8 text-gray-500">
        Loading…
      </div>
    );
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
};
