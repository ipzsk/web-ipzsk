import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Local copy so src/media has no dependency on src/ui; dedupe later.
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
