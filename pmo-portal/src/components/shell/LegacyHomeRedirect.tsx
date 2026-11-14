import React from 'react';
import { Navigate, useLocation } from 'react-router';

/** Keep old `/home` links working by returning them to the dashboard route. */
export const LegacyHomeRedirect: React.FC = () => {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: '/', search, hash }} replace />;
};

export default LegacyHomeRedirect;
