import { Anvil } from 'lucide-react'

export function Footer() {
  return (
    <footer className="mt-auto border-t border-stone-200 bg-stone-100/60 pb-[env(safe-area-inset-bottom)] dark:border-amber-900/40 dark:bg-stone-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-1.5 px-4 py-5 text-center sm:px-6">
        <span aria-hidden="true" className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
          <span className="h-px w-8 bg-amber-600/40 dark:bg-amber-500/30" />
          <Anvil className="size-3" />
          <span className="h-px w-8 bg-amber-600/40 dark:bg-amber-500/30" />
        </span>
        <p className="font-mono text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
          company-spawner · free-only policy enforced by scripts · secrets are names, never values
        </p>
      </div>
    </footer>
  )
}
