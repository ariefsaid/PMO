import React from 'react';
import { Icon } from '../src/components/ui/icons';
import type { IconName } from '../src/components/ui/icons';

type IconProps = { className?: string };
type LegacyIcon = React.FC<IconProps>;

const legacyIcon = (name: IconName): LegacyIcon => ({ className }) => (
  <Icon name={name} className={className} />
);

// Compatibility exports intentionally delegate to the single shared Lucide facade.
export const DashboardIcon = legacyIcon('dashboard');
export const ProjectsIcon = legacyIcon('projects');
export const ProcurementIcon = legacyIcon('procurement');
export const TimesheetsIcon = legacyIcon('clock');
export const TasksIcon = legacyIcon('tasks');
export const CompaniesIcon = legacyIcon('companies');
export const ReportsIcon = legacyIcon('reports');
export const AdminIcon = legacyIcon('admin');
export const UserIcon = legacyIcon('user');
export const BuildingOfficeIcon = legacyIcon('companies');
export const CalendarDaysIcon = legacyIcon('cal');
export const CurrencyDollarIcon = legacyIcon('dollar');
export const CheckCircleIcon = legacyIcon('circle-check');
export const ClockIcon = legacyIcon('clock');
export const PlusIcon = legacyIcon('plus');
export const ClipboardDocumentCheckIcon = legacyIcon('clipboard-check');
export const ChartBarIcon = legacyIcon('chart-column');
export const PencilSquareIcon = legacyIcon('pencil');
export const TrashIcon = legacyIcon('trash');
export const Squares2X2Icon = legacyIcon('cards');
export const TableCellsIcon = legacyIcon('table');
export const FunnelIcon = legacyIcon('funnel');
export const DocumentIcon = legacyIcon('doc');
export const CloudArrowUpIcon = legacyIcon('cloud-upload');
export const EyeIcon = legacyIcon('eye');
