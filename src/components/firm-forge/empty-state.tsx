import type { ReactNode } from 'react'
import { Loader2, RefreshCw, Unplug } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Loading state: a few skeletons aligned with card layouts. */
export function LoadingCards({ count = 2, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-4', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-stone-200 p-6 dark:border-amber-900/40">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

/**
 * Backend-not-ready state. The backend lands in parallel with the frontend, so
 * any query can fail while it boots — panels keep rendering with this notice.
 */
export function ConnectingNote({
  error,
  onRetry,
  hint = 'The forge backend is still warming up — panels fill in once it answers.',
}: {
  error: unknown
  onRetry?: () => void
  hint?: string
}) {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error')
  return (
    <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">
      <Unplug className="size-4" />
      <AlertTitle>Connecting to the forge backend…</AlertTitle>
      <AlertDescription className="mt-1 flex flex-wrap items-center gap-3 text-amber-700/90 dark:text-amber-400/90">
        <span className="min-w-0">
          {hint}
          <span className="mt-1 block break-all font-mono text-[11px] opacity-70">{message}</span>
        </span>
        {onRetry ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetry}
            className="h-9 border-amber-600/50 bg-transparent text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
          >
            <RefreshCw className="mr-1 size-3.5" /> Retry
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

/** Neutral empty state card. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700',
        className,
      )}
    >
      {icon ? <div className="text-stone-400 dark:text-stone-500 [&_svg]:size-7">{icon}</div> : null}
      <p className="text-sm font-medium text-stone-700 dark:text-stone-300">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs leading-relaxed text-stone-500 dark:text-stone-400">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

/** Inline spinner + label for busy buttons/rows. */
export function Busy({ children }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      {children}
    </span>
  )
}
