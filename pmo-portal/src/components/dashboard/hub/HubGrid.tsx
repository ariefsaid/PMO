import React from 'react';

export interface HubGridProps {
  children: React.ReactNode;
}

export const HubGrid: React.FC<HubGridProps> = ({ children }) => (
  <div className="grid grid-cols-1 gap-4 min-[1180px]:grid-cols-2">{children}</div>
);
