'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  MessageSquareQuote,
  Play,
  RefreshCw,
  ShieldAlert,
  SkipForward,
  Timer,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { E2EResult, TaskRecord } from '@/lib/firm-forge/types'
import { post } from './api'
import { useFirms, useRuns, qk } from './queries'
import { consumePendingE2ERun, subscribeE2ERun, type E2ERunRequest } from './e2e-bus'
import { CodeBlock } from './code-block'
import { SectionTitle, forgeCard, monoCls, scrollbarCls } from './section-title'
import { StatusBadge, stepTone } from './status-badge'
import { StatChip } from './stat-chip'
import { Busy, ConnectingNote, EmptyState, LoadingCards } from './empty-state'

// module-level cache so switching tabs keeps the last result visible
const lastResults: Record<string, E2EResult> = {}

const RUN_MESSAGES = [
  'Rendering firm…',
  'Seeding state…',
  'Probing harness…',
  'Worker is claiming tasks…',
  'Waiting for the LLM…',
]

/** Thin amber bar that slides while the pipeline runs. */
function RunningBar() {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" aria-hidden="true">
      <motion.div
        className="h-full w-1/3 rounded-full bg-amber-600"
        animate={{ x: ['0%', '300%'] }}
        transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
      />
    </div>
  )
}

// ---- typed views over the unknown `result` payloads ---------------------------

function jobAnswer(task: TaskRecord | null): string | undefined {
  const result = task?.result as { answer?: string } | undefined
  return typeof result?.answer === 'string' ? result.answer : undefined
}

function inferenceContent(task: TaskRecord | null): string | undefined {
  const result = task?.result as
    | { choices?: { message?: { content?: string } }[] }
    | undefined
  return typeof result?.choices?.[0]?.message?.content === 'string'
    ? result.choices[0].message.content
    : undefined
}

function echoPayload(task: TaskRecord | null): unknown {
  const result = task?.result as { echo?: unknown } | undefined
  if (result && 'echo' in result) return result.echo
  return task?.payload ?? null
}

// ---- step timeline -------------------------------------------------------------

function StepRow({ index, name, status, detail, ms }: { index: number; name: string; status: 'pass' | 'fail' | 'skip'; detail: string; ms: number }) {
  const long = detail.length > 140
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-stone-100 font-mono text-[11px] font-semibold text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
          {index}
        </span>
        {index < 9 ? <span className="mt-1 w-px flex-1 bg-stone-200 dark:bg-stone-800" aria-hidden="true" /> : null}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {status === 'pass' ? (
            <CheckCircle2 className="size-4 shrink-0 text-green-600 dark:text-green-500" />
          ) : status === 'fail' ? (
            <XCircle className="size-4 shrink-0 text-red-600 dark:text-red-500" />
          ) : (
            <SkipForward className="size-4 shrink-0 text-stone-400" />
          )}
          <p className="text-sm font-medium text-stone-800 dark:text-stone-200">{name}</p>
          <StatusBadge tone="muted" icon={<Timer />}>{ms >= 0 ? `${ms} ms` : '—'}</StatusBadge>
          <StatusBadge tone={stepTone(status)}>{status}</StatusBadge>
        </div>
        {long ? (
          <Collapsible className="mt-1">
            <CollapsibleTrigger className="font-mono text-[11px] text-amber-700 underline-offset-2 hover:underline dark:text-amber-400">
              show detail
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className={`mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-stone-200 bg-stone-50 p-2 font-mono text-[11px] text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400 ${scrollbarCls}`}>
                {detail}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
            {detail}
          </p>
        )}
      </div>
    </li>
  )
}

// ---- result cards --------------------------------------------------------------

function ResultCard({
  title,
  icon,
  children,
  tone = 'default',
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  tone?: 'default' | 'bad'
}) {
  return (
    <Card className={forgeCard}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

// ---- panel ----------------------------------------------------------------------

export function E2eLabPanel() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: firmsData, isLoading, isError, error, refetch } = useFirms()
  const firms = useMemo(
    () => [...(firmsData?.firms ?? [])].sort((a, b) => a.firmId.localeCompare(b.firmId)),
    [firmsData],
  )

  // dbId is only ever set by the user picking a firm in the select; everything
  // else derives a default (first firm, or the firm an auto-run requested).
  const [dbId, setDbId] = useState<string | null>(null)
  const [messageIndex, setMessageIndex] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  // set at mount (pending request from the Overview CTA) or via the bus while mounted
  const [request, setRequest] = useState<E2ERunRequest | null>(() => consumePendingE2ERun())

  const effectiveDbId = useMemo(() => {
    if (dbId && firms.some((f) => f.id === dbId)) return dbId
    if (request?.firmDbId && firms.some((f) => f.id === request.firmDbId)) return request.firmDbId
    return firms[0]?.id ?? null
  }, [dbId, request, firms])

  const runMutation = useMutation({
    mutationFn: (id: string) => post<E2EResult>(`/api/firms/${id}/e2e`),
    retry: false,
    onMutate: () => {
      setElapsed(0)
      setMessageIndex(0)
    },
    onSuccess: (result, id) => {
      lastResults[id] = result
      toast({
        title: result.ok ? 'End-to-end run passed' : 'End-to-end run failed',
        description: result.ok
          ? 'Task answered, inference real, governance refusal landed, bare path exercised.'
          : 'A hard step failed — open the step timeline for the script output.',
      })
      void queryClient.invalidateQueries({ queryKey: qk.runs(id) })
      void queryClient.invalidateQueries({ queryKey: qk.firms })
      void queryClient.invalidateQueries({ queryKey: qk.health })
    },
    onError: (err: Error) => {
      toast({ title: 'E2E run failed', description: err.message, variant: 'destructive' })
    },
  })

  const runsQuery = useRuns(effectiveDbId)
  const result = effectiveDbId ? (runMutation.data ?? lastResults[effectiveDbId] ?? null) : null
  const firm = firms.find((f) => f.id === effectiveDbId) ?? null

  // self-heal: a firm deleted underneath us ("firm not found") refreshes the firms list
  useEffect(() => {
    const msg =
      (runsQuery.error as Error | null)?.message ?? (runMutation.error as Error | null)?.message ?? ''
    if (/firm not found/i.test(msg)) {
      void queryClient.invalidateQueries({ queryKey: qk.firms })
    }
  }, [runsQuery.error, runMutation.error, queryClient])

  // ---- auto-run wiring (Overview "Run full E2E" CTA) ----
  useEffect(() => subscribeE2ERun(setRequest), [])

  const firedToken = useRef(0)
  useEffect(() => {
    if (!request || runMutation.isPending || firms.length === 0) return
    if (firedToken.current === request.token) return
    firedToken.current = request.token
    const target =
      request.firmDbId && firms.some((f) => f.id === request.firmDbId) ? request.firmDbId : firms[0].id
    runMutation.mutate(target)
  }, [request, firms, runMutation])

  // ---- running animation ----
  useEffect(() => {
    if (!runMutation.isPending) return
    const start = Date.now()
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [runMutation.isPending])

  useEffect(() => {
    if (!runMutation.isPending) return
    const timer = setInterval(() => setMessageIndex((i) => (i + 1) % RUN_MESSAGES.length), 2500)
    return () => clearInterval(timer)
  }, [runMutation.isPending])

  if (isLoading) return <LoadingCards count={2} />
  if (isError) {
    return <ConnectingNote error={error} onRetry={() => refetch()} hint="Firms list unavailable — the backend may still be starting." />
  }
  if (firms.length === 0) {
    return (
      <EmptyState
        icon={<FlaskConical />}
        title="No firm to verify"
        description="The pipeline needs a firm. Create one in the Firms tab first."
      />
    )
  }

  const passed = result ? result.steps.filter((s) => s.status === 'pass').length : 0
  const timedOut = runMutation.isError && /timeout|504|aborted/i.test((runMutation.error as Error)?.message ?? '')

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="stage 11 · verify"
        title="E2E Lab"
        description="The golden path: seed state, probe the harness over real HTTP, drain the queue with the rendered worker, answer through the model plane, refuse a gated action, exercise the notebook path, write the manifest."
      />

      {/* controls */}
      <Card className={forgeCard}>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="e2e-firm" className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
                firm
              </label>
              <Select
                value={effectiveDbId ?? undefined}
                onValueChange={(value) => {
                  setDbId(value)
                  runMutation.reset()
                }}
                disabled={runMutation.isPending}
              >
                <SelectTrigger id="e2e-firm" className="h-11 w-full sm:max-w-md" aria-label="Firm to verify">
                  <SelectValue placeholder="Pick a firm" />
                </SelectTrigger>
                <SelectContent>
                  {firms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      <span className={monoCls}>{f.firmId}</span>
                      <span className="ml-2 text-stone-500">{f.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                onClick={() => effectiveDbId && runMutation.mutate(effectiveDbId)}
                disabled={runMutation.isPending || !effectiveDbId}
                className="h-11 border border-amber-700/60 bg-amber-600 font-semibold text-stone-950 shadow-sm hover:bg-amber-500"
              >
                {runMutation.isPending ? (
                  <Busy>{RUN_MESSAGES[messageIndex]}</Busy>
                ) : (
                  <>
                    <Play className="mr-1.5 size-4" /> Run E2E
                  </>
                )}
              </Button>
            </div>
          </div>

          {runMutation.isPending ? (
            <div className="space-y-2">
              <RunningBar />
              <p className="font-mono text-[11px] text-stone-500">
                elapsed {elapsed}s · typically 60-120s — you can switch tabs, the run keeps going and lands in
                history
              </p>
            </div>
          ) : null}

          {runMutation.isError ? (
            <Alert variant={timedOut ? 'default' : 'destructive'} className={timedOut ? 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:border-amber-600/40 dark:bg-amber-950/40 dark:text-amber-300' : undefined}>
              <AlertTriangle className="size-4" />
              <AlertTitle>{timedOut ? 'The pipeline ran out of time' : 'E2E run failed'}</AlertTitle>
              <AlertDescription className="space-y-2">
                <span className="block break-all">
                  {timedOut
                    ? 'This run does real work — worker loops, HTTP probes and an LLM call — and occasionally outgrows the request window. Nothing is corrupted; simply try again.'
                    : (runMutation.error as Error).message}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => effectiveDbId && runMutation.mutate(effectiveDbId)}
                  className="h-9 border-amber-600/50 bg-transparent text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                >
                  <RefreshCw className="mr-1 size-3" /> Retry run
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <>
          {/* summary */}
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={result.ok ? 'ok' : 'bad'} icon={result.ok ? <CheckCircle2 /> : <XCircle />}>
              {result.ok ? 'e2e pass' : 'e2e fail'}
            </StatusBadge>
            <StatChip label="steps" value={`${passed}/${result.steps.length}`} />
            <StatChip label="firm" value={result.manifest?.firm_id ?? firm?.firmId ?? '—'} mono />
            <StatChip label="verified at" value={result.manifest?.verified_at ? new Date(result.manifest.verified_at).toLocaleString() : '—'} />
            <StatChip label="commit" value={result.manifest?.commit?.slice(0, 12) ?? '—'} mono title={result.manifest?.commit} />
          </div>

          {/* steps timeline */}
          <Card className={forgeCard}>
            <CardHeader>
              <CardTitle className="text-base">Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <ol aria-label="E2E steps" className="max-w-3xl">
                {result.steps.map((step, i) => (
                  <StepRow key={`${step.name}-${i}`} index={i + 1} {...step} />
                ))}
              </ol>
            </CardContent>
          </Card>

          {/* results grid */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ResultCard title="Job answer (real LLM)" icon={<MessageSquareQuote className="size-4 text-amber-600 dark:text-amber-500" />}>
              {jobAnswer(result.results.jobTask) ? (
                <blockquote className="border-l-2 border-amber-600/70 bg-amber-500/5 px-4 py-3 text-sm italic leading-relaxed text-stone-700 dark:text-stone-300">
                  {jobAnswer(result.results.jobTask)}
                </blockquote>
              ) : (
                <p className="text-sm text-stone-500">Not available — the job step did not complete.</p>
              )}
              <p className="mt-2 font-mono text-[11px] text-stone-400">
                task {result.results.jobTask?.id ?? 'verify-1'} · worker {result.results.jobTask?.worker ?? '—'}
              </p>
            </ResultCard>

            <ResultCard title="Inference (model plane)" icon={<FlaskConical className="size-4 text-amber-600 dark:text-amber-500" />}>
              {inferenceContent(result.results.inferenceTask) ? (
                <blockquote className="border-l-2 border-amber-600/70 bg-amber-500/5 px-4 py-3 text-sm italic leading-relaxed text-stone-700 dark:text-stone-300">
                  {inferenceContent(result.results.inferenceTask)}
                </blockquote>
              ) : (
                <p className="text-sm text-stone-500">Not available — the inference step did not complete.</p>
              )}
              <p className="mt-2 font-mono text-[11px] text-stone-400">
                task {result.results.inferenceTask?.id ?? 'verify-2'} · choices[0].message.content
              </p>
            </ResultCard>

            <ResultCard title="Governance refusal" icon={<ShieldAlert className="size-4 text-red-600 dark:text-red-500" />} tone="bad">
              {result.results.governanceTask?.last_error ? (
                <>
                  <div className="rounded-lg border border-red-300/70 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/40">
                    <p className="break-words font-mono text-xs text-red-800 dark:text-red-400">
                      {result.results.governanceTask.last_error}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StatusBadge tone="bad">intended failure</StatusBadge>
                    <StatusBadge tone="muted">attempts: {result.results.governanceTask.attempts ?? '—'}</StatusBadge>
                    <StatusBadge tone="muted">queue/failed</StatusBadge>
                  </div>
                </>
              ) : (
                <p className="text-sm text-stone-500">Not available — the governance task did not land in queue/failed.</p>
              )}
            </ResultCard>

            <ResultCard title="Bare / notebook path" icon={<Play className="size-4 text-amber-600 dark:text-amber-500" />}>
              {result.results.bareTask ? (
                <CodeBlock
                  code={JSON.stringify(echoPayload(result.results.bareTask), null, 2)}
                  maxHeight="max-h-56"
                  label={`task ${result.results.bareTask.id} · echo payload`}
                />
              ) : (
                <p className="text-sm text-stone-500">Not available — the bare worker step did not complete.</p>
              )}
            </ResultCard>
          </div>

          {/* manifest */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className={forgeCard}>
              <CardHeader>
                <CardTitle className="text-base">manifest.json</CardTitle>
              </CardHeader>
              <CardContent>
                <CodeBlock code={JSON.stringify(result.manifest, null, 2)} maxHeight="max-h-96" label="ws/manifest.json" />
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:border-amber-600/40 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertTriangle className="size-4" />
                <AlertTitle>What is a stand-in</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-amber-700 dark:text-amber-400/90">
                    {(result.manifest?.mocked ?? []).map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                    {(result.manifest?.mocked ?? []).length === 0 ? <li>nothing mocked</li> : null}
                  </ul>
                </AlertDescription>
              </Alert>

              <Card className={forgeCard}>
                <CardHeader>
                  <CardTitle className="text-base">Worker logs</CardTitle>
                </CardHeader>
                <CardContent>
                  {result.logs ? (
                    <Collapsible>
                      <CollapsibleTrigger className="font-mono text-[11px] text-amber-700 underline-offset-2 hover:underline dark:text-amber-400">
                        show logs (secret-free)
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <pre className={`mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-stone-200 bg-stone-50 p-3 font-mono text-[11px] leading-relaxed text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400 ${scrollbarCls}`}>
                          {result.logs}
                        </pre>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : (
                    <p className="text-sm text-stone-500">No logs captured.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : null}

      {/* history */}
      <Card className={forgeCard}>
        <CardHeader>
          <CardTitle className="text-base">Run history</CardTitle>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <p className="text-sm text-stone-500">Loading runs…</p>
          ) : runsQuery.isError ? (
            <p className="text-sm text-stone-500">History unavailable ({(runsQuery.error as Error).message}).</p>
          ) : !runsQuery.data?.runs.length ? (
            <p className="text-sm text-stone-500">No runs recorded for this firm yet.</p>
          ) : (
            <ol className="max-h-96 space-y-2 overflow-y-auto pe-1">
              {runsQuery.data.runs.slice(0, 10).map((run) => (
                <li key={run.id}>
                  <Collapsible>
                    <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${forgeCard}`}>
                      <StatusBadge tone={run.status === 'pass' ? 'ok' : 'bad'}>{run.kind}</StatusBadge>
                      <StatusBadge tone={run.status === 'pass' ? 'ok' : 'bad'}>{run.status}</StatusBadge>
                      <span className="min-w-0 flex-1 truncate text-xs text-stone-600 dark:text-stone-400">
                        {run.summary ?? `${run.steps.filter((s) => s.status === 'pass').length}/${run.steps.length} steps passed`}
                      </span>
                      <time className="shrink-0 font-mono text-[11px] text-stone-400" dateTime={run.createdAt}>
                        {new Date(run.createdAt).toLocaleString()}
                      </time>
                      <CollapsibleTrigger className="rounded p-1 text-stone-400 hover:text-amber-600 dark:hover:text-amber-400" aria-label="Toggle run steps">
                        <span className="font-mono text-[11px] underline underline-offset-2">steps</span>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <ol className="mt-1 space-y-1 rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60">
                        {run.steps.map((step, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs">
                            {step.status === 'pass' ? (
                              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-green-600 dark:text-green-500" />
                            ) : step.status === 'fail' ? (
                              <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-600 dark:text-red-500" />
                            ) : (
                              <SkipForward className="mt-0.5 size-3.5 shrink-0 text-stone-400" />
                            )}
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-300">{step.name}</span>
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-stone-500">{step.detail}</span>
                            <span className="shrink-0 font-mono text-[10px] text-stone-400">{step.ms}ms</span>
                          </li>
                        ))}
                      </ol>
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
