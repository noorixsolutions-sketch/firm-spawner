import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Compact label:value chip used in environment cards and hero stats. */
export function StatChip({
  label,
  value,
  tone = 'default',
  mono = false,
  icon,
  title,
}: {
  label: string
  value: ReactNode
  tone?: 'default' | 'ok' | 'warn' | 'bad' | 'muted'
  mono?: boolean
  icon?: ReactNode
  title?: string
}) {
  const toneCls = {
    default: 'border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700/70 dark:bg-stone-800/60 dark:text-stone-300',
    ok: 'border-green-300/70 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-400',
    warn: 'border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400',
    bad: 'border-red-300/70 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400',
    muted: 'border-stone-200 bg-transparent text-stone-500 dark:border-stone-800 dark:text-stone-500',
  }[tone]

  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs leading-4 [&_svg]:size-3 [&_svg]:shrink-0',
        toneCls,
      )}
    >
      {icon}
      <span className="shrink-0 font-medium opacity-70">{label}</span>
      <span className={cn('truncate', mono && 'font-mono text-[11px]')}>{value}</span>
    </span>
  )
}
