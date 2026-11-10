import React from 'react';
import AdminUsers from '../AdminUsers';
import type { AdministrationPanelProps } from './types';

const UsersPanel: React.FC<AdministrationPanelProps> = () => (
  <div data-testid="administration-panel-users" className="min-w-0">
    <AdminUsers embedded />
  </div>
);

export default UsersPanel;
