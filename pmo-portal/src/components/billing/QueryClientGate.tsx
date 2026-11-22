import React, { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';

/**
 * Renders its children only inside a QueryClientProvider (#2680). The billing-step add-ons are optional surfaces on screens
 * that are also rendered without a data layer (previews, isolated component tests): with no provider they render nothing,
 * so the host screen is exactly what it was before.
 */
export const QueryClientGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const client = useContext(QueryClientContext);
  return client ? <>{children}</> : null;
};
