import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ---- forge design tokens (shared class constants) --------------------------

/** Card surface: parchment in light, charcoal + copper border in dark. */
export const forgeCard =
  'border border-stone-200 bg-white shadow-sm dark:border-amber-900/40 dark:bg-stone-900/70'

/** Thin custom scrollbar for overflow areas (webkit + firefox). */
export const scrollbarCls =
  'scrollbar-thin [scrollbar-width:thin] [scrollbar-color:theme(colors.stone.600)_transparent] dark:[scrollbar-color:theme(colors.amber.900)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700 [&::-webkit-scrollbar-track]:bg-transparent'

/** Hide scrollbar entirely (tab strips). */
export const noScrollbarCls =
  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:appearance-none'

/** Mono text for ids / paths / code. */
export const monoCls = 'font-mono text-xs'

/** Primary amber CTA (forge accent). */
export const amberBtn =
  'bg-amber-600 text-stone-950 hover:bg-amber-500 border border-amber-700/60 shadow-sm'

/** Subtle hover-lift wrapper for interactive cards. */
export const liftCard =
  'transition-transform duration-150 hover:-translate-y-0.5 focus-visible:-translate-y-0.5'

// ---- section title ----------------------------------------------------------

export function SectionTitle({
  eyebrow,
  title,
  description,
  actions,
  className,
  as: Tag = 'section',
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  className?: string
  as?: 'section' | 'div'
}) {
  return (
    <Tag className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-600 dark:text-amber-500">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-100">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-stone-600 dark:text-stone-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </Tag>
  )
}

/** Small field label used across editor forms. */
export function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {children}
      </span>
      {hint ? <span className="font-mono text-[10px] text-stone-400 dark:text-stone-500">{hint}</span> : null}
    </span>
  )
}
