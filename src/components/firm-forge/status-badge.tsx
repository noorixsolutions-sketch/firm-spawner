import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'accent' | 'orange'

const toneCls: Record<Tone, string> = {
  ok: 'border-green-300 bg-green-100 text-green-800 dark:border-green-900/70 dark:bg-green-950/50 dark:text-green-400',
  warn: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/50 dark:text-amber-400',
  bad: 'border-red-300 bg-red-100 text-red-800 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-400',
  orange:
    'border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-900/70 dark:bg-orange-950/50 dark:text-orange-400',
  muted:
    'border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-400',
  accent:
    'border-amber-500/50 bg-amber-500/15 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
}

export function StatusBadge({
  tone = 'muted',
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone
  icon?: ReactNode
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 [&_svg]:size-3',
        toneCls[tone],
        className,
      )}
    >
      {icon}
      {children}
    </Badge>
  )
}

/** pass / fail / skip step icon tone helper. */
export function stepTone(status: 'pass' | 'fail' | 'skip'): Tone {
  if (status === 'pass') return 'ok'
  if (status === 'fail') return 'bad'
  return 'muted'
}

/** Map an eligibility status string (from scripts/eligibility.py) to a tone. */
export function eligibilityTone(status: string): Tone {
  switch (status) {
    case 'verified_free':
      return 'ok'
    case 'free_with_limits':
      return 'warn'
    case 'payment_method_required':
      return 'orange'
    case 'trial_only':
      return 'muted'
    case 'paid_only':
      return 'bad'
    case 'discontinued':
      return 'bad'
    default:
      return 'muted'
  }
}
