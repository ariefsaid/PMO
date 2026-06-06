// Shared primitive library — single import surface for the 6 program surfaces.
export { cn } from './cn';
export { Icon, type IconProps } from './icons';
export { ICON_PATHS, type IconName } from './iconPaths';
export { chartTheme, type ChartTheme } from './chartTheme';

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { StatusPill, Badge, type StatusVariant, type StatusPillProps, type BadgeProps } from './StatusPill';
export { Card, CardHead, CardPad, type CardProps } from './Card';
export { KPITile, type KPITileProps, type KPITone, type KPIDelta, type KPIDualLens } from './KPITile';
export {
  DataTable,
  Toolbar,
  SearchMini,
  TableFoot,
  type Column,
  type ColAlign,
  type SortState,
  type RowMenuItem,
  type DataTableProps,
} from './DataTable';
export { ViewToggle, type ViewOption, type ViewToggleProps } from './ViewToggle';
export { ProgressBar, type ProgressBarProps, type ProgressTone } from './ProgressBar';
export { ListState, type ListStateProps } from './ListState';
export { Tooltip, type TooltipProps } from './Tooltip';
export { ToastProvider, ToastView, useToast, type ToastKind } from './Toast';

export { Kanban, KanbanColumn, KanbanCard, type KanbanColumnProps, type KanbanCardProps } from './Kanban';
export {
  LifecycleStepper,
  type LifecycleStep,
  type StepState,
  type LifecycleStepperProps,
} from './LifecycleStepper';
export { Funnel, type FunnelStage, type FunnelProps } from './Funnel';
export { GateNotice, type GateNoticeProps } from './GateNotice';
export { PageHeader, type PageStat, type PageHeaderProps } from './PageHeader';
export { Tabs, type TabItem, type TabsProps } from './Tabs';
export { StatTiles, type StatTile, type StatTilesProps } from './StatTiles';
