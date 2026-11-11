// Local stand-ins for the shadcn ScrollArea / Tooltip / Popover / icon pieces the ReUI event calendar
// imports. Thin Base UI wrappers styled to DESIGN.md tokens (popover/border/muted).
import * as React from "react"
import { Popover as BasePopover } from "@base-ui/react/popover"
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip"
import { cn } from "@/src/components/ui/cn"

function ScrollArea({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="scroll-area" className={cn("relative min-h-0", className)} {...props}>
      <div data-slot="scroll-area-viewport" className="size-full overflow-auto">
        {children}
      </div>
    </div>
  )
}

const TooltipProvider = BaseTooltip.Provider
const Tooltip = BaseTooltip.Root
const TooltipTrigger = BaseTooltip.Trigger

function TooltipContent({
  side = "top",
  className,
  children,
}: {
  side?: "top" | "bottom" | "left" | "right"
  className?: string
  children?: React.ReactNode
}) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} sideOffset={6} className="z-50">
        <BaseTooltip.Popup
          data-slot="tooltip-content"
          className={cn(
            "bg-foreground text-background rounded-md px-2.5 py-1.5 text-xs shadow-md",
            className
          )}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}

const Popover = BasePopover.Root
const PopoverTrigger = BasePopover.Trigger

function PopoverContent({
  align = "center",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof BasePopover.Popup>, "className"> & {
  align?: "start" | "center" | "end"
  className?: string
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner align={align} sideOffset={4} className="z-50">
        <BasePopover.Popup
          className={cn(
            "bg-popover text-popover-foreground border-border flex flex-col rounded-md border shadow-md outline-hidden",
            className
          )}
          {...props}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}

function IconStack({ className, children }: React.ComponentProps<"div">) {
  return (
    <div data-slot="icon-stack" className={cn("text-muted-foreground", className)}>
      {children}
    </div>
  )
}

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const

function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgProps} {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}
function RepeatIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgProps} {...props}>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  )
}
function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M5 12h14M12 5v14" />
    </svg>
  )
}

export {
  CalendarIcon,
  IconStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  PlusIcon,
  RepeatIcon,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
}
