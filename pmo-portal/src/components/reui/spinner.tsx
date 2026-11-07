import { cn } from "@/src/components/reui/cn"

import { IconPlaceholder } from "@/src/components/reui/icon-placeholder"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <IconPlaceholder
      lucide="Loader2Icon"
      tabler="IconLoader"
      hugeicons="Loading03Icon"
      phosphor="SpinnerIcon"
      remixicon="RiLoaderLine"
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
