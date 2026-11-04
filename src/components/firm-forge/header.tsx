'use client'

import { useTheme } from 'next-themes'
import { Anvil, CheckCircle2, CircleSlash, Moon, Sun, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useHealth } from './queries'
import { StatusBadge } from './status-badge'
import { noScrollbarCls } from './section-title'

export const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'firms', label: 'Firms' },
  { key: 'build', label: 'Build' },
  { key: 'e2e', label: 'E2E Lab' },
  { key: 'eligibility', label: 'Eligibility' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'playbook', label: 'Playbook' },
] as const

export type TabKey = (typeof TABS)[number]['key']

export function isTabKey(value: string | null | undefined): value is TabKey {
  return !!value && TABS.some((t) => t.key === value)
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Toggle light or dark theme"
      title="Toggle light / dark"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="size-11 shrink-0 border-stone-300 bg-white text-stone-600 hover:bg-stone-100 hover:text-amber-600 dark:border-amber-900/40 dark:bg-stone-900 dark:text-stone-400 dark:hover:text-amber-400"
    >
      {/* CSS-driven icons: no hydration mismatch, no mounted state */}
      <Sun className="size-4 dark:hidden" aria-hidden="true" />
      <Moon className="hidden size-4 dark:block" aria-hidden="true" />
    </Button>
  )
}

function HealthChips() {
  const { data, isLoading, isError, refetch } = useHealth()

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5" aria-label="Probing workspace health">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <button type="button" onClick={() => refetch()} className="cursor-pointer" title="Retry health probe">
        <StatusBadge tone="muted" icon={<CircleSlash />}>
          backend offline
        </StatusBadge>
      </button>
    )
  }

  const pythonOk = data.python?.yaml && data.python?.pytest
  const tests = data.skill?.tests ?? null
  const skillTitle = tests
    ? `last pytest run: ${tests.passed} passed / ${tests.failed} failed`
    : 'skill present; pytest not run yet'

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Workspace health">
      <StatusBadge
        tone={pythonOk ? 'ok' : 'warn'}
        icon={pythonOk ? <CheckCircle2 /> : <XCircle />}
        title={data.python?.version ? `python3 ${data.python.version}` : 'python3'}
      >
        Python
      </StatusBadge>
      <StatusBadge
        tone={data.skill?.present ? 'ok' : 'bad'}
        icon={data.skill?.present ? <CheckCircle2 /> : <XCircle />}
        title={skillTitle}
      >
        Skill{tests ? ` · ${tests.passed}/${tests.passed + tests.failed}` : ''}
      </StatusBadge>
      <StatusBadge
        tone={data.harness?.up ? 'ok' : 'bad'}
        icon={data.harness?.up ? <CheckCircle2 /> : <XCircle />}
        title={data.harness?.up ? `harness up (${data.harness.firmId})` : 'harness not seeded yet — run the E2E'}
      >
        Harness
      </StatusBadge>
      {data.docker ? (
        <StatusBadge tone="warn" title="docker present in this sandbox">Docker</StatusBadge>
      ) : (
        <StatusBadge tone="muted" title="no docker here — image platforms build the containers">
          Docker · platform builds
        </StatusBadge>
      )}
    </div>
  )
}

export function Header({ activeTab, onTabChange }: { activeTab: TabKey; onTabChange: (tab: TabKey) => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-stone-50/95 backdrop-blur dark:border-amber-900/40 dark:bg-stone-950/95">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-3 py-3 sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-amber-700/50 bg-gradient-to-b from-amber-500/20 to-amber-700/10 text-amber-600 dark:text-amber-400"
            >
              <Anvil className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold tracking-tight text-stone-900 sm:text-lg dark:text-stone-100">
                Firm Forge
              </h1>
              <p className="truncate font-mono text-[11px] text-stone-500 dark:text-stone-400">
                company-spawner workspace
              </p>
            </div>
          </div>
          <div className="order-3 flex w-full items-center justify-between gap-3 sm:order-2 sm:ml-auto sm:w-auto">
            <HealthChips />
          </div>
          <div className="order-2 ml-auto sm:order-3 sm:ml-0">
            <ThemeToggle />
          </div>
        </div>
        <nav aria-label="Workspace sections" className="pb-3">
          <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as TabKey)}>
            <TabsList
              className={`h-auto w-full max-w-full justify-start overflow-x-auto rounded-lg border border-stone-200 bg-stone-100/70 p-1 dark:border-amber-900/40 dark:bg-stone-900 sm:w-auto sm:justify-center ${noScrollbarCls}`}
            >
              {TABS.map((tab) => (
                <TabsTrigger
                  key={tab.key}
                  value={tab.key}
                  className="h-11 shrink-0 rounded-md px-3 text-xs font-medium text-stone-600 data-[state=active]:border data-[state=active]:border-amber-700/60 data-[state=active]:bg-amber-600 data-[state=active]:text-stone-950 data-[state=active]:shadow-sm sm:px-4 sm:text-sm dark:text-stone-400 dark:data-[state=active]:bg-amber-600 dark:data-[state=active]:text-stone-950"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </nav>
      </div>
    </header>
  )
}
