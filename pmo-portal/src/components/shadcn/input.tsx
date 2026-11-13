import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/src/components/shadcn/cn"
import { formControlShell } from "@/src/components/ui/FormFields"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        formControlShell,
        "min-w-0 transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground aria-invalid:border-destructive aria-invalid:enabled:hover:border-destructive aria-invalid:focus-visible:ring-3 aria-invalid:focus-visible:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
