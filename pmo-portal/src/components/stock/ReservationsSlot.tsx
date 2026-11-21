import React, { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';

/** Mounts reservation add-ons only where a query client exists, so a screen rendered without one (a bare unit test of an older screen) shows no new control and loads nothing. */
export const ReservationsSlot: React.FC<{ children: React.ReactNode }> = ({ children }) => (useContext(QueryClientContext) ? <>{children}</> : null);
