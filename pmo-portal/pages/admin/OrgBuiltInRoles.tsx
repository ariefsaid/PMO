import React from 'react';
import { usePermission } from '@/src/auth/usePermission';
import { SeatReport } from '@/src/components/my/SeatReport';

/**
 * Administration › People › Built-in roles (#2709). Built-in roles are on for every organisation (#2746): an Admin gives people any of the
 * 28 roles from Edit role, and nothing changes until someone is given one. Here the Admin sees the seat report. Admin-only via
 * `can('manage', 'orgAccounting')` (UX); the server enforces it (ADR-0016). The People and crews module hides the section.
 */
const OrgBuiltInRoles: React.FC = () => {
  const canManage = usePermission()('manage', 'orgAccounting');
  return canManage ? <section id="org-built-in-roles" tabIndex={-1} className="scroll-mt-4 mt-6"><SeatReport /></section> : null;
};

export default OrgBuiltInRoles;
