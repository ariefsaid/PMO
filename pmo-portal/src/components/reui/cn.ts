import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** The copied ReUI/shadcn source relies on twMerge to let a caller's classes win. The app's own `ui/cn` is clsx-only by design. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
