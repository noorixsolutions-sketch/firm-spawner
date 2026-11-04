'use client'

import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Activity,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  Hammer,
  Lock,
  Play,
  Server,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useToast } from '@/hooks/use-toast'
import type { FirmDef, TestRunDef } from '@/lib/firm-forge/types'
import { useFirms, useHealth, qk, runSelfTest } from './queries'
import { requestE2ERun } from './e2e-bus'
import { SectionTitle, forgeCard, monoCls, scrollbarCls } from './section-title'
import { StatusBadge, type Tone } from './status-badge'
import { StatChip } from './stat-chip'
import { Busy, ConnectingNote, LoadingCards } from './empty-state'
import type { TabKey } from './header'

// ---- 12-stage workflow tracker (SKILL.md stages 0-11) ------------------------

const STAGES: { n: number; name: string; gate?: boolean }[] = [
  { n: 0, name: 'Inventory' },
  { n: 1, name: 'Business discovery' },
  { n: 2, name: 'Capability decomposition' },
  { n: 3, name: 'Research & compare' },
  { n: 4, name: 'Operator decides', gate: true },
  { n: 5, name: 'Guided provisioning' },
  { n: 6, name: 'Compose' },
  { n: 7, name: 'Render & validate' },
  { n: 8, name: 'Approve', gate: true },
  { n: 9, name: 'Publish', gate: true },
  { n: 10, name: 'Deploy (gate per step)', gate: true },
  { n: 11, name: 'Verify' },
]

function StageTracker({ onOpenE2E }: { onOpenE2E: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {STAGES.map((stage) => {
        const done = stage.n <= 7
        const tone: Tone = done ? 'ok' : 'warn'
        return (
          <motion.div
            key={stage.n}
            whileHover={{ y: -2 }}
            className={`flex items-center gap-3 rounded-lg ${forgeCard} px-3 py-2.5`}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-stone-100 font-mono text-xs font-semibold text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
              {stage.n}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                {stage.name}
                {stage.gate ? (
                  <Lock className="size-3 shrink-0 text-amber-600 dark:text-amber-500" aria-label="operator gate" />
                ) : null}
              </p>
              <p className="text-[11px] text-stone-500 dark:text-stone-500">
                {done
                  ? 'done in this workspace'
                  : stage.n === 11
                    ? 'run it in the E2E Lab'
                    : 'operator-gated — outside the sandbox'}
              </p>
            </div>
            {stage.n === 11 ? (
              <Button
                type="button"
                size="sm"
                onClick={onOpenE2E}
                className="h-9 shrink-0 border border-amber-700/60 bg-amber-600 text-xs font-semibold text-stone-950 shadow-sm hover:bg-amber-500"
              >
                <Play className="mr-1 size-3" /> E2E Lab
              </Button>
            ) : (
              <StatusBadge tone={tone} className="shrink-0">
                {done ? 'done' : 'gated'}
              </StatusBadge>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

// ---- environment card --------------------------------------------------------

function EnvironmentCard() {
  const { data, isLoading, isError, error, refetch } = useHealth()

  if (isLoading) {
    return (
      <Card className={forgeCard}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="size-4 text-amber-600 dark:text-amber-500" /> Environment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-stone-500">Probing python, skill, harness and tooling…</p>
        </CardContent>
      </Card>
    )
  }

  if (isError || !data) {
    return (
      <Card className={forgeCard}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="size-4 text-amber-600 dark:text-amber-500" /> Environment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ConnectingNote error={error} onRetry={() => refetch()} />
        </CardContent>
      </Card>
    )
  }

  const tests = data.skill?.tests ?? null

  return (
    <Card className={forgeCard}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="size-4 text-amber-600 dark:text-amber-500" /> Environment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <StatChip
            label="python3"
            value={data.python?.version || 'unknown'}
            mono
            tone={data.python?.yaml && data.python?.pytest ? 'ok' : 'warn'}
          />
          <StatChip label="yaml" value={data.python?.yaml ? 'importable' : 'missing'} tone={data.python?.yaml ? 'ok' : 'bad'} />
          <StatChip label="pytest" value={data.python?.pytest ? 'present' : 'missing'} tone={data.python?.pytest ? 'ok' : 'bad'} />
          <StatChip label="git" value={data.git ? 'ok' : 'missing'} tone={data.git ? 'ok' : 'warn'} />
          <StatChip
            label="docker"
            value={data.docker ? 'present' : 'absent — platforms build images'}
            tone={data.docker ? 'warn' : 'muted'}
          />
          <StatChip
            label="harness"
            value={data.harness?.up ? `up (${data.harness.firmId})` : 'not seeded'}
            tone={data.harness?.up ? 'ok' : 'warn'}
            mono={!data.harness?.up}
          />
          <StatChip
            label="skill tests"
            value={tests ? `${tests.passed} passed / ${tests.failed} failed` : 'not run yet'}
            tone={tests ? (tests.failed > 0 ? 'bad' : 'ok') : 'muted'}
          />
        </div>
        <div className="space-y-1.5 border-t border-stone-200 pt-3 dark:border-stone-800">
          <p className="flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
            <span className="font-medium text-stone-600 dark:text-stone-300">workspaces</span>
            <code className={monoCls}>{data.workspacesDir}</code>
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
            <span className="font-medium text-stone-600 dark:text-stone-300">harness url</span>
            <code className={monoCls}>{data.harness?.url || '—'}</code>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ---- self-test card ----------------------------------------------------------

function SelfTestCard() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const selfTest = useMutation({
    mutationFn: runSelfTest,
    retry: false,
    onSuccess: (result) => {
      toast({
        title: result.ok ? 'Self-test passed' : 'Self-test failed',
        description: `${result.passed} passed / ${result.failed} failed (python3 -m pytest tests -q)`,
      })
      void queryClient.invalidateQueries({ queryKey: qk.health })
    },
    onError: (err: Error) => {
      toast({
        title: 'Self-test could not run',
        description: err.message,
        variant: 'destructive',
      })
    },
  })

  const result = selfTest.data

  return (
    <Card className={forgeCard}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4 text-amber-600 dark:text-amber-500" /> Skill self-test
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Runs the skill&apos;s own pytest suite (<code className={monoCls}>python3 -m pytest tests -q</code> in{' '}
          <code className={monoCls}>firm-spawner/</code>). Deterministic scripts stay the authority.
        </p>
        <Button
          type="button"
          onClick={() => selfTest.mutate()}
          disabled={selfTest.isPending}
          className="h-11 w-full border border-amber-700/60 bg-amber-600 font-semibold text-stone-950 shadow-sm hover:bg-amber-500 sm:w-auto"
        >
          {selfTest.isPending ? <Busy>Running pytest…</Busy> : 'Run self-test'}
        </Button>
        {selfTest.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Self-test failed to start</AlertTitle>
            <AlertDescription>{(selfTest.error as Error).message}</AlertDescription>
          </Alert>
        ) : null}
        {result ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge tone={result.ok ? 'ok' : 'bad'} icon={result.ok ? <CheckCircle2 /> : null}>
                {result.passed} passed
              </StatusBadge>
              <StatusBadge tone={result.failed > 0 ? 'bad' : 'muted'}>{result.failed} failed</StatusBadge>
            </div>
            <pre
              className={`max-h-96 overflow-auto rounded-lg border border-stone-800 bg-stone-950 p-3 font-mono text-[11px] leading-relaxed text-stone-300 dark:border-amber-900/40 ${scrollbarCls}`}
              aria-label="pytest output tail"
            >
              {result.output || '(no output)'}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---- latest E2E card ---------------------------------------------------------

function latestE2eRun(firms: FirmDef[]): { firm: FirmDef; run: TestRunDef } | null {
  let best: { firm: FirmDef; run: TestRunDef } | null = null
  for (const firm of firms) {
    const run = firm.lastRun
    if (run && run.kind === 'e2e' && (!best || run.createdAt > best.run.createdAt)) {
      best = { firm, run }
    }
  }
  return best
}

function LatestE2eCard({ onRunE2E }: { onRunE2E: (firmDbId: string) => void }) {
  const { data, isLoading, isError, error, refetch } = useFirms()

  if (isLoading) return <LoadingCards count={1} />
  if (isError) return <ConnectingNote error={error} onRetry={() => refetch()} hint="Firms list unavailable — the backend may still be starting." />

  const latest = data ? latestE2eRun(data.firms) : null
  const firmCount = data?.firms.length ?? 0

  return (
    <Card className={forgeCard}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="size-4 text-amber-600 dark:text-amber-500" /> End-to-end pipeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {latest ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge tone={latest.run.status === 'pass' ? 'ok' : 'bad'} icon={<Activity />}>
                {latest.run.status === 'pass' ? 'last run passed' : 'last run failed'}
              </StatusBadge>
              <StatChip label="firm" value={latest.firm.firmId} mono />
              <StatChip
                label="steps"
                value={`${latest.run.steps.filter((s) => s.status === 'pass').length}/${latest.run.steps.length}`}
              />
              <StatChip label="at" value={new Date(latest.run.createdAt).toLocaleString()} />
            </div>
            {latest.run.summary ? (
              <p className="text-sm text-stone-600 dark:text-stone-400">{latest.run.summary}</p>
            ) : null}
            <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
              Seed state, probe the harness over HTTP, drain the queue with the real worker, answer through the
              workspace model plane, refuse a gated action, exercise the bare/notebook path — then write the
              manifest.
            </p>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-stone-600 dark:text-stone-400">
            No end-to-end run recorded yet. The pipeline seeds state, probes the harness over real HTTP, runs the
            rendered worker (<code className={monoCls}>worker.py --once</code>), answers a job through the model
            plane, lands a governance refusal in <code className={monoCls}>queue/failed</code> and exercises the
            notebook path — then writes <code className={monoCls}>manifest.json</code>.
          </p>
        )}
        <Button
          type="button"
          disabled={firmCount === 0}
          onClick={() => {
            const firmId = latest?.firm.id ?? data?.firms[0]?.id ?? null
            if (firmId) onRunE2E(firmId)
          }}
          className="h-11 w-full border border-amber-700/60 bg-amber-600 font-semibold text-stone-950 shadow-sm hover:bg-amber-500 sm:w-auto"
        >
          <Play className="mr-1.5 size-4" /> Run full E2E
        </Button>
      </CardContent>
    </Card>
  )
}

// ---- panel -------------------------------------------------------------------

export function OverviewPanel({ onNavigate }: { onNavigate: (tab: TabKey) => void }) {
  const { data: firmsData } = useFirms()
  const firmCount = firmsData?.firms.length ?? 0
  const latest = useMemo(() => (firmsData ? latestE2eRun(firmsData.firms) : null), [firmsData])

  function runE2E(firmDbId: string) {
    requestE2ERun(firmDbId)
    onNavigate('e2e')
  }

  return (
    <div className="space-y-6">
      {/* hero */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className={`relative overflow-hidden rounded-xl ${forgeCard} p-6`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-amber-500/10 blur-2xl"
        />
        <div className="flex flex-wrap items-start gap-4">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-amber-700/50 bg-gradient-to-b from-amber-500/20 to-amber-700/10 text-amber-600 dark:text-amber-400"
          >
            <Hammer className="size-6" />
          </span>
          <div className="min-w-0 max-w-3xl">
            <h2 className="text-xl font-bold tracking-tight text-stone-900 sm:text-2xl dark:text-stone-100">
              The forge is lit
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
              This workspace wraps the <code className={monoCls}>company-spawner</code> skill: spawn firms from the
              template, compose their agents and values, render + validate + secret-scan with the skill&apos;s
              deterministic Python scripts, and run a <em>real</em> end-to-end pipeline — seed state, harness over
              HTTP, the actual worker draining the queue, an LLM answer, a governance refusal. Free-only policy and
              secret hygiene are enforced by scripts, not promises.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <StatChip label="firms" value={firmCount} />
              <StatChip
                label="last e2e"
                value={latest ? (latest.run.status === 'pass' ? 'pass' : 'fail') : 'not run'}
                tone={latest ? (latest.run.status === 'pass' ? 'ok' : 'bad') : 'muted'}
              />
              <StatChip label="policy" value="allow_paid: false" mono tone="warn" />
              <StatChip label="secrets" value="names, never values" tone="muted" />
            </div>
          </div>
        </div>
      </motion.section>

      <SectionTitle
        eyebrow="SKILL.md · workflow"
        title="Twelve stages"
        description="Stages 0-7 are done inside this workspace (template inventory, demo firm composed, rendered and validated). Stages 8-10 need the operator outside the sandbox; stage 11 is the E2E Lab."
      />
      <StageTracker onOpenE2E={() => onNavigate('e2e')} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EnvironmentCard />
        <div className="space-y-4">
          <LatestE2eCard onRunE2E={runE2E} />
          <SelfTestCard />
        </div>
      </div>
    </div>
  )
}
