// Shared primitive library — single import surface for the 6 program surfaces.
export { cn } from './cn';
export { Icon, type IconProps } from './icons';
export { ICON_PATHS, type IconName } from './iconPaths';
export { chartTheme, type ChartTheme } from './chartTheme';

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { Checkbox, type CheckboxProps } from './Checkbox';
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
export {
  ConfirmDialog,
  type ConfirmDialogProps,
  type ConfirmTone,
  type ConfirmSurface,
} from './ConfirmDialog';
export { Drawer, type DrawerProps } from './Drawer';

export { Kanban, KanbanColumn, KanbanCard, type KanbanColumnProps, type KanbanCardProps } from './Kanban';
export { KanbanStageIndicator, type KanbanStageItem, type KanbanStageIndicatorProps } from './KanbanStageIndicator';
export {
  LifecycleStepper,
  type LifecycleStep,
  type StepState,
  type LifecycleStepperProps,
} from './LifecycleStepper';
export { Funnel, type FunnelStage, type FunnelProps } from './Funnel';
export { GateNotice, type GateNoticeProps } from './GateNotice';
export { AccessDenied, type AccessDeniedProps } from './AccessDenied';
export { PageHeader, type PageStat, type PageHeaderProps } from './PageHeader';
export { RecordHeader, type RecordHeaderProps } from './RecordHeader';
export { ListPage, type ListPageProps } from './ListPage';
export { tabId, tabPanelId } from './tabIds';
export { Tabs, type TabItem, type TabsProps } from './Tabs';
export { StatTiles, type StatTile, type StatTilesProps } from './StatTiles';
export {
  TimesheetGrid,
  type TimesheetDay,
  type TimesheetGridRow,
  type TimesheetGridProps,
} from './TimesheetGrid';
export { ErrBanner, type ErrBannerProps } from './ErrBanner';
export { ApprovalRow, type ApprovalRowProps } from './ApprovalRow';
export { ProjectNameLink, type ProjectNameLinkProps } from './ProjectNameLink';
export { HoursBar, type HoursBarProps } from './HoursBar';
export { RecordActionZone, type RecordActionZoneProps } from './RecordActionZone';
export { EntryList, type EntryListProps } from './EntryList';
export { ProjectNameLink, type ProjectNameLinkProps } from './ProjectNameLink';

// --- CRUD form primitives (Phase 1, crud-components §2) ---
export {
  FieldShell,
  FieldError,
  TextField,
  NumberField,
  TextArea,
  SelectField,
  FormRow,
  FormGrid,
  FormSection,
  FormActions,
  type FieldShellProps,
  type FieldErrorProps,
  type TextFieldProps,
  type NumberFieldProps,
  type TextAreaProps,
  type SelectFieldProps,
  type SelectOption,
  type FormGridProps,
  type FormSectionProps,
  type FormActionsProps,
} from './FormFields';
export { Combobox, type ComboboxProps, type ComboboxOption } from './Combobox';
export {
  EntityFormModal,
  type EntityFormModalProps,
  type ErrorSummaryItem,
} from './EntityFormModal';
export {
  useEntityForm,
  type UseEntityForm,
  type UseEntityFormOptions,
  type ValidateFn,
  type FieldProps,
} from './useEntityForm';
export { ProjectNameLink, type ProjectNameLinkProps } from './ProjectNameLink';
