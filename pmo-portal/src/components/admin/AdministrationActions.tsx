import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
/** Page-owned controls join the Administration title row without moving their mutation state. */
export const AdministrationActions: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setTarget(document.getElementById('administration-page-actions')); }, []);
  return target ? createPortal(children, target) : <div className="flex justify-end">{children}</div>;
};
