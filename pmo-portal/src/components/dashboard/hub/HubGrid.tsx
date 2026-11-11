import React from 'react';

export interface HubGridProps {
  children: React.ReactNode;
}

export const HubGrid: React.FC<HubGridProps> = ({ children }) => (
  <div className="grid grid-cols-1 items-start gap-[var(--space-panel-gap)] min-[1280px]:grid-cols-2">{children}</div>
);
