'use client'

import { Suspense, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Anvil } from 'lucide-react'
import { Providers } from '@/components/firm-forge/providers'
import { Header, isTabKey, type TabKey } from '@/components/firm-forge/header'
import { Footer } from '@/components/firm-forge/footer'
import { OverviewPanel } from '@/components/firm-forge/overview'
import { FirmsPanel } from '@/components/firm-forge/firms'
import { BuildPanel } from '@/components/firm-forge/build'
import { E2eLabPanel } from '@/components/firm-forge/e2e-lab'
import { EligibilityPanel } from '@/components/firm-forge/eligibility'
import { CataloguePanel } from '@/components/firm-forge/catalogue'
import { PlaybookPanel } from '@/components/firm-forge/playbook'

function Workspace() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const rawTab = searchParams.get('tab')
  const tab: TabKey = isTabKey(rawTab) ? rawTab : 'overview'

  const setTab = useCallback(
    (next: TabKey) => {
      router.replace(`${pathname}?tab=${next}`, { scroll: false })
    },
    [router, pathname],
  )

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 font-sans text-stone-800 antialiased dark:bg-stone-950 dark:text-stone-200">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-stone-950 focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Header activeTab={tab} onTabChange={setTab} />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {tab === 'overview' ? <OverviewPanel onNavigate={setTab} /> : null}
            {tab === 'firms' ? <FirmsPanel /> : null}
            {tab === 'build' ? <BuildPanel /> : null}
            {tab === 'e2e' ? <E2eLabPanel /> : null}
            {tab === 'eligibility' ? <EligibilityPanel /> : null}
            {tab === 'catalogue' ? <CataloguePanel /> : null}
            {tab === 'playbook' ? <PlaybookPanel /> : null}
          </motion.div>
        </AnimatePresence>
      </main>
      <Footer />
    </div>
  )
}

function WorkspaceFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-50 text-stone-500 dark:bg-stone-950 dark:text-stone-400">
      <motion.span
        aria-hidden="true"
        animate={{ rotate: [0, -8, 0] }}
        transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
        className="flex size-14 items-center justify-center rounded-xl border border-amber-700/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      >
        <Anvil className="size-7" />
      </motion.span>
      <p className="font-mono text-xs uppercase tracking-[0.25em]">lighting the forge…</p>
    </div>
  )
}

export default function Home() {
  return (
    <Providers>
      <Suspense fallback={<WorkspaceFallback />}>
        <Workspace />
      </Suspense>
    </Providers>
  )
}
