'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Download, FolderTree, Hammer, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { BuildResult } from '@/lib/firm-forge/types'
import { post } from './api'
import { useFirmFile, useFirmFiles, useFirms, qk } from './queries'
import { FileTree, prettyBytes } from './file-tree'
import { CodeBlock } from './code-block'
import { SectionTitle, forgeCard, monoCls, scrollbarCls } from './section-title'
import { StatusBadge } from './status-badge'
import { Busy, ConnectingNote, EmptyState } from './empty-state'

// module-level cache so switching tabs keeps the last build result visible
const lastBuilds: Record<string, BuildResult> = {}

/** Thin amber bar that slides while a long op runs (indeterminate feel). */
function IndeterminateBar() {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" aria-hidden="true">
      <motion.div
        className="h-full w-1/3 rounded-full bg-amber-600"
        animate={{ x: ['0%', '300%'] }}
        transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
      />
    </div>
  )
}

const BUILD_MESSAGES = [
  'Writing values.yaml…',
  'render.py is templating the repo…',
  'Composing agent files + decisions.jsonl…',
  'validate.py is checking the schema…',
  'scan_secrets.py is hunting for values…',
]

function StepCard({
  title,
  ok,
  subtitle,
  detail,
}: {
  title: string
  ok: boolean
  subtitle: string
  detail?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl p-4 ${forgeCard}`}
    >
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="size-5 shrink-0 text-green-600 dark:text-green-500" />
        ) : (
          <XCircle className="size-5 shrink-0 text-red-600 dark:text-red-500" />
        )}
        <p className="flex-1 text-sm font-semibold text-stone-800 dark:text-stone-200">{title}</p>
        <StatusBadge tone={ok ? 'ok' : 'bad'}>{ok ? 'pass' : 'fail'}</StatusBadge>
      </div>
      <p className="mt-2 font-mono text-[11px] text-stone-500 dark:text-stone-400">{subtitle}</p>
      {detail ? <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{detail}</p> : null}
    </motion.div>
  )
}

export function BuildPanel() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: firmsData, isLoading, isError, error, refetch } = useFirms()
  const firms = useMemo(
    () => [...(firmsData?.firms ?? [])].sort((a, b) => a.firmId.localeCompare(b.firmId)),
    [firmsData],
  )

  const [dbId, setDbId] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [messageIndex, setMessageIndex] = useState(0)

  // dbId is only set by the user; the default (first firm) is derived, not effected.
  const effectiveDbId = dbId && firms.some((f) => f.id === dbId) ? dbId : (firms[0]?.id ?? null)

  const firm = firms.find((f) => f.id === effectiveDbId) ?? null

  const filesQuery = useFirmFiles(effectiveDbId)
  const fileQuery = useFirmFile(effectiveDbId, selectedPath)

  const buildMutation = useMutation({
    mutationFn: (id: string) => post<BuildResult>(`/api/firms/${id}/build`),
    retry: false,
    onMutate: () => setMessageIndex(0),
    onSuccess: (result, id) => {
      lastBuilds[id] = result
      if (result.ok) {
        toast({
          title: 'Build passed',
          description: `rendered ${result.render.filesRendered ?? 0} files · validate ok · secret scan clean`,
        })
      } else {
        toast({
          title: 'Build finished with problems',
          description: 'Check the step cards below — errors are the scripts talking, not opinions.',
          variant: 'destructive',
        })
      }
      setSelectedPath(null)
      void queryClient.invalidateQueries({ queryKey: qk.files(id) })
      void queryClient.invalidateQueries({ queryKey: qk.runs(id) })
      void queryClient.invalidateQueries({ queryKey: qk.firms })
    },
    onError: (err: Error) => {
      toast({ title: 'Build failed to run', description: err.message, variant: 'destructive' })
    },
  })

  const result = effectiveDbId ? (buildMutation.data ?? lastBuilds[effectiveDbId] ?? null) : null

  // self-heal: a firm deleted underneath us ("firm not found") refreshes the firms list,
  // which re-derives the selection to a firm that still exists
  useEffect(() => {
    const msg =
      (filesQuery.error as Error | null)?.message ??
      (fileQuery.error as Error | null)?.message ??
      (buildMutation.error as Error | null)?.message ??
      ''
    if (/firm not found/i.test(msg)) {
      void queryClient.invalidateQueries({ queryKey: qk.firms })
    }
  }, [filesQuery.error, fileQuery.error, buildMutation.error, queryClient])

  useEffect(() => {
    if (!buildMutation.isPending) return
    const timer = setInterval(() => setMessageIndex((i) => (i + 1) % BUILD_MESSAGES.length), 2200)
    return () => clearInterval(timer)
  }, [buildMutation.isPending])
  const tree = filesQuery.data?.tree ?? []
  const hasFiles = tree.length > 0

  if (isLoading) return <LoadingBuild />
  if (isError) {
    return (
      <ConnectingNote
        error={error}
        onRetry={() => refetch()}
        hint="Firms list unavailable — the forge backend may still be starting."
      />
    )
  }
  if (firms.length === 0) {
    return (
      <EmptyState
        icon={<Hammer />}
        title="No firms to build"
        description="Compose a firm first — the Firms tab creates one from the demo values."
      />
    )
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="stage 7 · render & validate"
        title="Build"
        description="Runs the real pipeline: values.yaml → render.py → agent composition → validate.py → scan_secrets.py. Errors below come straight from the scripts."
      />

      {/* controls */}
      <Card className={forgeCard}>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="build-firm" className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
              firm
            </label>
            <Select value={effectiveDbId ?? undefined} onValueChange={(value) => { setDbId(value); setSelectedPath(null) }}>
              <SelectTrigger id="build-firm" className="h-11 w-full sm:max-w-md" aria-label="Firm to build">
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
          <div className="flex items-end gap-2">
            <Button
              type="button"
              onClick={() => effectiveDbId && buildMutation.mutate(effectiveDbId)}
              disabled={buildMutation.isPending || !effectiveDbId}
              className="h-11 border border-amber-700/60 bg-amber-600 font-semibold text-stone-950 shadow-sm hover:bg-amber-500"
            >
              {buildMutation.isPending ? (
                <Busy>{BUILD_MESSAGES[messageIndex]}</Busy>
              ) : (
                <>
                  <Hammer className="mr-1.5 size-4" /> Build firm
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              asChild
              disabled={!hasFiles}
              className="h-11 border-stone-300 dark:border-stone-700"
            >
              <a
                href={effectiveDbId ? `/api/firms/${effectiveDbId}/download` : undefined}
                download={firm ? `firm-${firm.firmId}.tar.gz` : undefined}
                aria-disabled={!hasFiles}
                className={hasFiles ? undefined : 'pointer-events-none opacity-50'}
              >
                <Download className="mr-1.5 size-4" /> Download repo
              </a>
            </Button>
          </div>
        </CardContent>
        {buildMutation.isPending ? (
          <CardContent className="space-y-2">
            <IndeterminateBar />
            <p className="font-mono text-[11px] text-stone-500">
              pipeline running — render · validate · secret scan
            </p>
          </CardContent>
        ) : null}
      </Card>

      {/* step cards */}
      {result ? (
        <section aria-label="Build steps" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StepCard
              title="Render"
              ok={result.render.ok}
              subtitle={`render.py · files_rendered: ${result.render.filesRendered ?? 0}`}
            />
            <StepCard
              title="Validate"
              ok={result.validate.ok}
              subtitle={`validate.py · ${result.validate.errors.length} error(s) · ${result.validate.warnings.length} warning(s)`}
            />
            <StepCard
              title="Secret scan"
              ok={result.scan.ok}
              subtitle={`scan_secrets.py · ${result.scan.findings} finding(s)`}
            />
          </div>

          {result.render.errors && result.render.errors.length ? (
            <Alert variant="destructive">
              <XCircle className="size-4" />
              <AlertTitle>render.py errors</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
                  {result.render.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {result.validate.errors.length ? (
            <Alert variant="destructive">
              <XCircle className="size-4" />
              <AlertTitle>validate.py errors</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
                  {result.validate.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {result.validate.warnings.length ? (
            <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:border-amber-600/40 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="size-4" />
              <AlertTitle>validate.py warnings</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5 font-mono text-xs text-amber-700 dark:text-amber-400/90">
                  {result.validate.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {result.scan.findings > 0 ? (
            <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:border-amber-600/40 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="size-4" />
              <AlertTitle>Secret scan findings ({result.scan.findings})</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5 font-mono text-xs text-amber-700 dark:text-amber-400/90">
                  {result.scan.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <p className={`text-xs text-stone-500 dark:text-stone-500 ${monoCls}`}>workspace: {result.workspace}</p>
        </section>
      ) : null}

      {/* file browser */}
      <section aria-label="Rendered repository browser" className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className={forgeCard}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FolderTree className="size-4 text-amber-600 dark:text-amber-500" /> Files
              <span className="ml-auto font-mono text-[11px] text-stone-400">
                {firm ? `workspaces/${firm.firmId}` : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filesQuery.isLoading ? (
              <p className="text-sm text-stone-500">Loading file tree…</p>
            ) : filesQuery.isError || !hasFiles ? (
              <EmptyState
                icon={<Hammer />}
                title="No build yet"
                description="Compose a firm and press Build — the rendered repo (Docker image sources, notebooks, compose, constitution) appears here."
                className="border-dashed"
              />
            ) : (
              <ScrollArea className="max-h-[560px] pr-2">
                <FileTree tree={tree} selectedPath={selectedPath} onSelect={setSelectedPath} />
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className={`min-h-[320px] ${forgeCard}`}>
          <CardHeader>
            <CardTitle className="text-sm">File viewer</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedPath ? (
              <EmptyState
                icon={<FolderTree />}
                title="Pick a file"
                description="Values, agent YAML, notebooks, Dockerfiles, compose — everything the template renders."
              />
            ) : fileQuery.isLoading ? (
              <p className="text-sm text-stone-500">Reading {selectedPath}…</p>
            ) : fileQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Cannot read file</AlertTitle>
                <AlertDescription>{(fileQuery.error as Error).message}</AlertDescription>
              </Alert>
            ) : fileQuery.data ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`min-w-0 break-all ${monoCls} text-amber-700 dark:text-amber-400`}>
                    {fileQuery.data.path}
                  </p>
                  <StatusBadge tone="muted">{prettyBytes(fileQuery.data.size)}</StatusBadge>
                  {fileQuery.data.truncated ? <StatusBadge tone="warn">truncated at 200KB</StatusBadge> : null}
                </div>
                <pre
                  className={`max-h-[560px] overflow-auto rounded-lg border border-stone-800 bg-stone-950 p-3 font-mono text-xs leading-relaxed text-stone-300 dark:border-amber-900/40 ${scrollbarCls}`}
                >
                  {fileQuery.data.content}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function LoadingBuild() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className={`h-20 animate-pulse rounded-xl ${forgeCard}`} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={`h-24 animate-pulse rounded-xl ${forgeCard}`} />
        ))}
      </div>
    </div>
  )
}
