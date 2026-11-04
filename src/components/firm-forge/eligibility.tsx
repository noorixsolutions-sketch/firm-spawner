'use client'

import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  CreditCard,
  Gavel,
  Pencil,
  Play,
  Plus,
  Scale,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import type { DecisionDef, EvidenceDef, EvidenceInput, EligibilityResult } from '@/lib/firm-forge/types'
import { del, patch, post } from './api'
import { useDecisions, useEvidence, useFirms, qk } from './queries'
import { ChipsInput } from './chips-input'
import { SectionTitle, FieldLabel, forgeCard, monoCls } from './section-title'
import { StatusBadge, eligibilityTone } from './status-badge'
import { StatChip } from './stat-chip'
import { Busy, ConnectingNote, EmptyState } from './empty-state'

const NEEDS = ['batch', 'persistent_serving', 'interactive', 'experimentation'] as const

const CAPABILITIES = ['inference', 'state_storage', 'control_plane_hosting', 'batch_compute'] as const
const EXECUTIONS = ['persistent_service', 'interactive_api', 'batch_worker', 'ephemeral_notebook'] as const
const PRICING_MODELS = [
  'free_forever',
  'open_source_self_host',
  'free_tier',
  'trial',
  'paid_only',
  'discontinued',
] as const
const COMPUTE_COSTS = ['none', 'user_owned', 'paid'] as const

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// ---- record form dialog --------------------------------------------------------

interface RecordFormState {
  provider: string
  capability: string
  execution: string
  pricingModel: string
  cardRequired: boolean
  computeCost: string
  sourceUrl: string
  verifiedAt: string
  termsExcerpt: string
  limits: string[]
  restrictions: string[]
}

const EMPTY_FORM: RecordFormState = {
  provider: '',
  capability: 'inference',
  execution: 'interactive_api',
  pricingModel: 'free_tier',
  cardRequired: false,
  computeCost: 'none',
  sourceUrl: '',
  verifiedAt: today(),
  termsExcerpt: '',
  limits: [],
  restrictions: [],
}

function RecordDialog({
  onOpenChange,
  initial,
  submitting,
  onSubmit,
}: {
  onOpenChange: (open: boolean) => void
  initial: EvidenceDef | null
  submitting: boolean
  onSubmit: (input: EvidenceInput) => void
}) {
  // mounted per open (keyed by record), so the form initializes once — no effects
  const [form, setForm] = useState<RecordFormState>(() =>
    initial
      ? {
          provider: initial.provider,
          capability: initial.capability,
          execution: initial.execution,
          pricingModel: initial.pricingModel,
          cardRequired: initial.cardRequired,
          computeCost: initial.computeCost || 'none',
          sourceUrl: initial.sourceUrl,
          verifiedAt: initial.verifiedAt?.slice(0, 10) ?? today(),
          termsExcerpt: initial.termsExcerpt,
          limits: initial.limits ?? [],
          restrictions: initial.restrictions ?? [],
        }
      : EMPTY_FORM,
  )

  const set = (patch: Partial<RecordFormState>) => setForm((f) => ({ ...f, ...patch }))

  function submit() {
    if (!form.provider.trim() || !form.sourceUrl.trim()) {
      return
    }
    onSubmit({
      provider: form.provider.trim(),
      capability: form.capability,
      execution: form.execution,
      pricingModel: form.pricingModel,
      cardRequired: form.cardRequired,
      computeCost: form.computeCost,
      sourceUrl: form.sourceUrl.trim(),
      verifiedAt: form.verifiedAt,
      termsExcerpt: form.termsExcerpt.trim(),
      limits: form.limits,
      restrictions: form.restrictions,
    })
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit record — ${initial.provider}` : 'Add evidence record'}</DialogTitle>
          <DialogDescription>
            Provider evidence is the only input to the eligibility gate. Verified dates and excerpts come from the
            official page, not from memory.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rec-provider">
              <FieldLabel>provider</FieldLabel>
            </Label>
            <Input
              id="rec-provider"
              value={form.provider}
              onChange={(e) => set({ provider: e.target.value })}
              className={`h-11 ${monoCls}`}
              placeholder="kaggle"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>capability</FieldLabel>
            <Select value={form.capability} onValueChange={(capability) => set({ capability })}>
              <SelectTrigger className="h-11 w-full" aria-label="Capability">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAPABILITIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    <span className={monoCls}>{c}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel>execution</FieldLabel>
            <Select value={form.execution} onValueChange={(execution) => set({ execution })}>
              <SelectTrigger className="h-11 w-full" aria-label="Execution">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXECUTIONS.map((e) => (
                  <SelectItem key={e} value={e}>
                    <span className={monoCls}>{e}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel>pricing model</FieldLabel>
            <Select value={form.pricingModel} onValueChange={(pricingModel) => set({ pricingModel })}>
              <SelectTrigger className="h-11 w-full" aria-label="Pricing model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICING_MODELS.map((p) => (
                  <SelectItem key={p} value={p}>
                    <span className={monoCls}>{p}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel>compute cost</FieldLabel>
            <Select value={form.computeCost} onValueChange={(computeCost) => set({ computeCost })}>
              <SelectTrigger className="h-11 w-full" aria-label="Compute cost">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPUTE_COSTS.map((c) => (
                  <SelectItem key={c} value={c}>
                    <span className={monoCls}>{c}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel>verified at</FieldLabel>
            <Input
              id="rec-verified"
              type="date"
              value={form.verifiedAt}
              onChange={(e) => set({ verifiedAt: e.target.value })}
              className={`h-11 ${monoCls}`}
              aria-label="Verified at"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rec-source">
              <FieldLabel hint="https:// only">source url</FieldLabel>
            </Label>
            <Input
              id="rec-source"
              value={form.sourceUrl}
              onChange={(e) => set({ sourceUrl: e.target.value })}
              className={`h-11 ${monoCls}`}
              placeholder="https://www.kaggle.com/docs/notebooks"
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800 sm:col-span-2">
            <div>
              <p className="text-sm font-medium text-stone-800 dark:text-stone-200">Card required</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Selectable only when disclosed — the gate treats it as payment_method_required.
              </p>
            </div>
            <Switch
              checked={form.cardRequired}
              onCheckedChange={(cardRequired) => set({ cardRequired })}
              aria-label="Card required"
              className="data-[state=checked]:border-amber-700 data-[state=checked]:bg-amber-600"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rec-terms">
              <FieldLabel hint="short quote, not a paraphrase">terms excerpt</FieldLabel>
            </Label>
            <Textarea
              id="rec-terms"
              value={form.termsExcerpt}
              onChange={(e) => set({ termsExcerpt: e.target.value })}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel hint="e.g. 30h/week">limits</FieldLabel>
            <ChipsInput values={form.limits} onChange={(limits) => set({ limits })} placeholder="30h/week" />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>restrictions</FieldLabel>
            <ChipsInput
              values={form.restrictions}
              onChange={(restrictions) => set({ restrictions })}
              placeholder="no commercial use"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-11 border-stone-300 dark:border-stone-700"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={submitting || !form.provider.trim() || !form.sourceUrl.trim()}
            className="h-11 border border-amber-700/60 bg-amber-600 font-semibold text-stone-950 shadow-sm hover:bg-amber-500"
          >
            {submitting ? <Busy>Saving…</Busy> : initial ? 'Save record' : 'Add record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- panel ----------------------------------------------------------------------

export function EligibilityPanel() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const evidenceQuery = useEvidence()
  const firmsQuery = useFirms()

  const [need, setNeed] = useState<(typeof NEEDS)[number]>('batch')
  const [gateResults, setGateResults] = useState<EligibilityResult[] | null>(null)
  const [selectable, setSelectable] = useState<string[]>([])
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<EvidenceDef | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EvidenceDef | null>(null)

  // decisions
  const firms = useMemo(
    () => [...(firmsQuery.data?.firms ?? [])].sort((a, b) => a.firmId.localeCompare(b.firmId)),
    [firmsQuery.data],
  )
  const [firmDbId, setFirmDbId] = useState<string | null>(null)
  const [decisionForm, setDecisionForm] = useState({ capability: '', choice: '', evidence: '', verifiedAt: today() })

  // firmDbId is only set by the user; the default (first firm) is derived
  const effectiveFirmDbId =
    firmDbId && firms.some((f) => f.id === firmDbId) ? firmDbId : (firms[0]?.id ?? null)

  const decisionsQuery = useDecisions(effectiveFirmDbId)

  const gateMutation = useMutation({
    mutationFn: () => post<{ results: EligibilityResult[]; selectable: string[] }>('/api/eligibility', { need }),
    retry: false,
    onSuccess: (data) => {
      setGateResults(data.results ?? [])
      setSelectable(data.selectable ?? [])
      toast({
        title: 'Gate run complete',
        description: `${data.selectable?.length ?? 0} selectable provider(s) for need "${need}".`,
      })
    },
    onError: (err: Error) => {
      toast({ title: 'Gate run failed', description: err.message, variant: 'destructive' })
    },
  })

  const createMutation = useMutation({
    mutationFn: (input: EvidenceInput) => post<{ record: EvidenceDef }>('/api/evidence', input),
    retry: false,
    onSuccess: ({ record }) => {
      toast({ title: 'Record added', description: `${record.provider} · ${record.capability}` })
      setDialogOpen(false)
      void queryClient.invalidateQueries({ queryKey: qk.evidence })
    },
    onError: (err: Error) => toast({ title: 'Could not add record', description: err.message, variant: 'destructive' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: EvidenceInput }) =>
      patch<{ record: EvidenceDef }>(`/api/evidence/${id}`, input),
    retry: false,
    onSuccess: ({ record }) => {
      toast({ title: 'Record updated', description: `${record.provider} · ${record.capability}` })
      setDialogOpen(false)
      void queryClient.invalidateQueries({ queryKey: qk.evidence })
    },
    onError: (err: Error) => toast({ title: 'Could not update record', description: err.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del<{ ok: boolean }>(`/api/evidence/${id}`),
    retry: false,
    onSuccess: () => {
      toast({ title: 'Record deleted' })
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: qk.evidence })
    },
    onError: (err: Error) => toast({ title: 'Could not delete record', description: err.message, variant: 'destructive' }),
  })

  const decisionMutation = useMutation({
    mutationFn: (input: { firmId: string; capability: string; choice: string; evidence: string; verifiedAt: string }) =>
      post<{ decision: DecisionDef }>('/api/decisions', input),
    retry: false,
    onSuccess: ({ decision }) => {
      toast({ title: 'Decision recorded', description: `${decision.capability} → ${decision.choice}` })
      setDecisionForm({ capability: '', choice: '', evidence: '', verifiedAt: today() })
      void queryClient.invalidateQueries({ queryKey: qk.decisions(effectiveFirmDbId ?? '') })
    },
    onError: (err: Error) => toast({ title: 'Could not record decision', description: err.message, variant: 'destructive' }),
  })

  const records = useMemo(
    () => [...(evidenceQuery.data?.records ?? [])].sort((a, b) => a.provider.localeCompare(b.provider)),
    [evidenceQuery.data],
  )

  const statusByProvider = useMemo(() => {
    const map = new Map<string, EligibilityResult>()
    for (const r of gateResults ?? []) map.set(`${r.provider}::${r.capability}`, r)
    return map
  }, [gateResults])

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="stage 3 · research & compare"
        title="Eligibility"
        description="Provider evidence records feed scripts/eligibility.py — the deterministic, free-only gate. Statuses below come from the script, never from guesswork."
      />

      {/* toolbar */}
      <Card className={forgeCard}>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <FieldLabel hint="what the firm needs">need</FieldLabel>
            <Select value={need} onValueChange={(value: (typeof NEEDS)[number]) => setNeed(value)}>
              <SelectTrigger className="h-11 w-full sm:max-w-xs" aria-label="Need">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NEEDS.map((n) => (
                  <SelectItem key={n} value={n}>
                    <span className={monoCls}>{n}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            onClick={() => gateMutation.mutate()}
            disabled={gateMutation.isPending}
            className="h-11 border border-amber-700/60 bg-amber-600 font-semibold text-stone-950 shadow-sm hover:bg-amber-500"
          >
            {gateMutation.isPending ? <Busy>Running eligibility.py…</Busy> : (
              <>
                <Play className="mr-1.5 size-4" /> Run gate
              </>
            )}
          </Button>
        </CardContent>
        {gateResults ? (
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatChip label="selectable" value={selectable.length} tone="ok" />
              {selectable.map((p) => (
                <StatusBadge key={p} tone="ok" icon={<Check />}>
                  {p}
                </StatusBadge>
              ))}
            </div>
            <ol className="max-h-96 space-y-1.5 overflow-y-auto pe-1">
              {gateResults.map((r, i) => (
                <li key={`${r.provider}-${i}`}>
                  <details className={`group rounded-lg px-3 py-2 ${forgeCard}`}>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                      <ChevronDown className="size-3.5 shrink-0 text-stone-400 transition-transform group-open:rotate-180" />
                      <span className={`shrink-0 text-sm font-medium ${monoCls} text-stone-800 dark:text-stone-200`}>
                        {r.provider}
                      </span>
                      <span className={`shrink-0 text-xs ${monoCls} text-stone-500`}>{r.capability}</span>
                      <StatusBadge
                        tone={eligibilityTone(r.status)}
                        icon={r.status === 'payment_method_required' ? <CreditCard /> : undefined}
                      >
                        {r.status}
                      </StatusBadge>
                      {r.selectable ? (
                        <StatusBadge tone="ok" icon={<Check />}>selectable</StatusBadge>
                      ) : (
                        <StatusBadge tone="muted" icon={<X />}>rejected</StatusBadge>
                      )}
                    </summary>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {r.disclosures.length ? (
                        <div>
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-500">
                            disclosures
                          </p>
                          <ul className="list-disc space-y-0.5 pl-4 text-xs text-stone-600 dark:text-stone-400">
                            {r.disclosures.map((d, j) => (
                              <li key={j}>{d}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {r.reasons.length ? (
                        <div>
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-500">
                            reasons
                          </p>
                          <ul className="list-disc space-y-0.5 pl-4 text-xs text-stone-600 dark:text-stone-400">
                            {r.reasons.map((reason, j) => (
                              <li key={j}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <p className="break-all font-mono text-[11px] text-stone-400 sm:col-span-2">
                        {r.source_url} · verified {r.verified_at}
                      </p>
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </CardContent>
        ) : null}
      </Card>

      {/* records */}
      <SectionTitle
        eyebrow="stage 3 evidence"
        title="Evidence records"
        description="Raw provider evidence — quotes, limits, card requirements — with verification dates. The gate derives every status from these."
        actions={
          <Button
            type="button"
            onClick={() => {
              setEditingRecord(null)
              setDialogOpen(true)
            }}
            className="h-11 border border-amber-700/60 bg-amber-600 font-semibold text-stone-950 shadow-sm hover:bg-amber-500"
          >
            <Plus className="mr-1.5 size-4" /> Add record
          </Button>
        }
      />

      <Card className={forgeCard}>
        <CardContent className="overflow-x-auto">
          {evidenceQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-stone-500">Loading records…</p>
          ) : evidenceQuery.isError ? (
            <ConnectingNote
              error={evidenceQuery.error}
              onRetry={() => evidenceQuery.refetch()}
              hint="Evidence records unavailable — the backend may still be starting."
            />
          ) : records.length === 0 ? (
            <EmptyState
              icon={<Scale />}
              title="No evidence records"
              description="Add one — provider, capability, pricing model, a real source URL and a short terms quote."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" aria-label="Expand" />
                  <TableHead>provider</TableHead>
                  <TableHead>capability</TableHead>
                  <TableHead>execution</TableHead>
                  <TableHead>pricing model</TableHead>
                  <TableHead>verified_at</TableHead>
                  <TableHead>status</TableHead>
                  <TableHead className="text-center">selectable</TableHead>
                  <TableHead className="w-24" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => {
                  const gate = statusByProvider.get(`${record.provider}::${record.capability}`)
                  const expanded = expandedRecord === record.id
                  return (
                    <Fragment key={record.id}>
                      <motion.tr
                        whileHover={{ backgroundColor: 'rgba(245,245,244,0.5)' }}
                        className="cursor-pointer"
                        onClick={() => setExpandedRecord(expanded ? null : record.id)}
                      >
                        <TableCell>
                          <ChevronDown
                            className={`size-3.5 text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                          />
                        </TableCell>
                        <TableCell className={`font-medium ${monoCls} text-amber-700 dark:text-amber-400`}>
                          {record.provider}
                        </TableCell>
                        <TableCell className={monoCls}>{record.capability}</TableCell>
                        <TableCell className={monoCls}>{record.execution}</TableCell>
                        <TableCell className={monoCls}>{record.pricingModel}</TableCell>
                        <TableCell className={monoCls}>{record.verifiedAt?.slice(0, 10)}</TableCell>
                        <TableCell>
                          {gate ? (
                            <StatusBadge
                              tone={eligibilityTone(gate.status)}
                              icon={gate.status === 'payment_method_required' ? <CreditCard /> : undefined}
                            >
                              {gate.status}
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="muted">run the gate</StatusBadge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {gate ? (
                            gate.selectable ? (
                              <Check className="mx-auto size-4 text-green-600 dark:text-green-500" aria-label="selectable" />
                            ) : (
                              <X className="mx-auto size-4 text-red-500" aria-label="not selectable" />
                            )
                          ) : (
                            <span className="font-mono text-[11px] text-stone-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${record.provider}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingRecord(record)
                                setDialogOpen(true)
                              }}
                              className="size-9 text-stone-500 hover:text-amber-600 dark:hover:text-amber-400"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${record.provider}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteTarget(record)
                              }}
                              className="size-9 text-stone-500 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </motion.tr>
                      {expanded ? (
                        <TableRow
                          key={`${record.id}-detail`}
                          className="bg-stone-50 hover:bg-stone-50 dark:bg-stone-900/40 dark:hover:bg-stone-900/40"
                        >
                          <TableCell colSpan={9}>
                            <div className="grid grid-cols-1 gap-3 p-2 sm:grid-cols-2">
                              <div className="space-y-1">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">source</p>
                                <a
                                  href={record.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="break-all font-mono text-[11px] text-amber-700 underline underline-offset-2 dark:text-amber-400"
                                >
                                  {record.sourceUrl}
                                </a>
                                <p className="text-[11px] font-mono text-stone-400">
                                  compute_cost: {record.computeCost} · card_required: {String(record.cardRequired)}
                                </p>
                              </div>
                              <div className="space-y-1">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
                                  terms excerpt
                                </p>
                                <blockquote className="border-l-2 border-amber-600/60 pl-3 text-xs italic leading-relaxed text-stone-600 dark:text-stone-400">
                                  {record.termsExcerpt || '—'}
                                </blockquote>
                                {record.limits?.length ? (
                                  <p className="font-mono text-[11px] text-stone-500">limits: {record.limits.join(' · ')}</p>
                                ) : null}
                                {record.restrictions?.length ? (
                                  <p className="font-mono text-[11px] text-stone-500">
                                    restrictions: {record.restrictions.join(' · ')}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* decisions */}
      <SectionTitle
        eyebrow="stage 4 · operator decides"
        title="Decisions"
        description="Recorded operator choices per capability — mirrored into the firm repo's decisions.jsonl on save."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className={forgeCard}>
          <CardHeader>
            <CardTitle className="text-base">Add decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {firmsQuery.isLoading ? (
              <p className="text-sm text-stone-500">Loading firms…</p>
            ) : firms.length === 0 ? (
              <p className="text-sm text-stone-500">No firms yet — create one in the Firms tab.</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <FieldLabel>firm</FieldLabel>
                  <Select value={effectiveFirmDbId ?? undefined} onValueChange={setFirmDbId}>
                    <SelectTrigger className="h-11 w-full" aria-label="Firm for decision">
                      <SelectValue placeholder="Pick a firm" />
                    </SelectTrigger>
                    <SelectContent>
                      {firms.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          <span className={monoCls}>{f.firmId}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <FieldLabel>capability</FieldLabel>
                    <Input
                      value={decisionForm.capability}
                      onChange={(e) => setDecisionForm({ ...decisionForm, capability: e.target.value })}
                      className={`h-11 ${monoCls}`}
                      placeholder="inference"
                      aria-label="Decision capability"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel>choice</FieldLabel>
                    <Input
                      value={decisionForm.choice}
                      onChange={(e) => setDecisionForm({ ...decisionForm, choice: e.target.value })}
                      className={`h-11 ${monoCls}`}
                      placeholder="workspace-llm"
                      aria-label="Decision choice"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel>evidence</FieldLabel>
                    <Input
                      value={decisionForm.evidence}
                      onChange={(e) => setDecisionForm({ ...decisionForm, evidence: e.target.value })}
                      className={`h-11 ${monoCls}`}
                      placeholder="provider or record reference"
                      aria-label="Decision evidence"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel>verified at</FieldLabel>
                    <Input
                      type="date"
                      value={decisionForm.verifiedAt}
                      onChange={(e) => setDecisionForm({ ...decisionForm, verifiedAt: e.target.value })}
                      className={`h-11 ${monoCls}`}
                      aria-label="Decision verified at"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  disabled={
                    decisionMutation.isPending ||
                    !effectiveFirmDbId ||
                    !decisionForm.capability.trim() ||
                    !decisionForm.choice.trim()
                  }
                  onClick={() =>
                    effectiveFirmDbId &&
                    decisionMutation.mutate({
                      firmId: effectiveFirmDbId,
                      capability: decisionForm.capability.trim(),
                      choice: decisionForm.choice.trim(),
                      evidence: decisionForm.evidence.trim(),
                      verifiedAt: decisionForm.verifiedAt,
                    })
                  }
                  className="h-11 w-full border border-amber-700/60 bg-amber-600 font-semibold text-stone-950 shadow-sm hover:bg-amber-500"
                >
                  {decisionMutation.isPending ? <Busy>Recording…</Busy> : (
                    <>
                      <Gavel className="mr-1.5 size-4" /> Record decision
                    </>
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card className={forgeCard}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gavel className="size-4 text-amber-600 dark:text-amber-500" /> Recorded decisions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {decisionsQuery.isLoading ? (
              <p className="text-sm text-stone-500">Loading decisions…</p>
            ) : decisionsQuery.isError ? (
              <p className="text-sm text-stone-500">Decisions unavailable ({(decisionsQuery.error as Error).message}).</p>
            ) : !decisionsQuery.data?.decisions.length ? (
              <EmptyState
                icon={<Gavel />}
                title="No decisions for this firm"
                description="Present the comparison, let the operator pick, then record it here."
              />
            ) : (
              <ol className="max-h-96 space-y-2 overflow-y-auto pe-1">
                {decisionsQuery.data.decisions.map((d) => (
                  <li key={d.id} className={`rounded-lg p-3 ${forgeCard}`}>
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-medium ${monoCls} text-amber-700 dark:text-amber-400`}>
                        {d.capability}
                      </span>
                      <span aria-hidden="true" className="text-stone-400">→</span>
                      <span className={`text-sm ${monoCls} text-stone-800 dark:text-stone-200`}>{d.choice}</span>
                    </p>
                    {d.evidence ? (
                      <p className="mt-1 break-words text-xs text-stone-500 dark:text-stone-400">{d.evidence}</p>
                    ) : null}
                    <p className="mt-1 font-mono text-[10px] text-stone-400">
                      verified {d.verifiedAt?.slice(0, 10)} · decided {new Date(d.decidedAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* dialogs */}
      {dialogOpen ? (
        <RecordDialog
          key={editingRecord?.id ?? 'new'}
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) setEditingRecord(null)
          }}
          initial={editingRecord}
          submitting={createMutation.isPending || updateMutation.isPending}
          onSubmit={(input) => {
            if (editingRecord) updateMutation.mutate({ id: editingRecord.id, input })
            else createMutation.mutate(input)
          }}
        />
      ) : null}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete record for {deleteTarget?.provider}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the evidence record from the gate&apos;s inputs. Decisions already recorded are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="h-11 border border-red-700/60 bg-red-600 text-white hover:bg-red-500"
            >
              Delete record
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
