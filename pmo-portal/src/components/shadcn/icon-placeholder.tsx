import type { ComponentType, SVGProps } from "react"
import {
  ArrowLeftRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CopyIcon,
  CornerDownRightIcon,
  EllipsisVerticalIcon,
  FolderPlusIcon,
  GripVerticalIcon,
  LayersIcon,
  ListFilterIcon,
  ListFilterPlusIcon,
  Loader2Icon,
  LoaderCircleIcon,
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UngroupIcon,
  XIcon,
} from "lucide-react"

// The copied source targets five icon sets via one placeholder; this app uses lucide only.
const ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  ArrowLeftRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CopyIcon,
  CornerDownRightIcon,
  EllipsisVerticalIcon,
  FolderPlusIcon,
  GripVerticalIcon,
  LayersIcon,
  ListFilterIcon,
  ListFilterPlusIcon,
  Loader2Icon,
  LoaderCircleIcon,
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UngroupIcon,
  XIcon,
}

type Props = SVGProps<SVGSVGElement> & { lucide: string; tabler?: string; hugeicons?: string; phosphor?: string; remixicon?: string }

export function IconPlaceholder({ lucide, tabler: _t, hugeicons: _h, phosphor: _p, remixicon: _r, ...props }: Props) {
  const Icon = ICONS[lucide]
  return Icon ? <Icon {...props} /> : null
}
