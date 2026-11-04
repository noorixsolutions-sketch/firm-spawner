'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Boxes, FilePlus2, Plus, Save, Trash2, UserPlus, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import type { AgentDef, FirmDef, FirmInput } from '@/lib/firm-forge/types'
import { del, patch, post } from './api'
import { useCatalogue, useFirms, qk } from './queries'
import { ChipsInput } from './chips-input'
import { CodeBlock } from './code-block'
import { SectionTitle, FieldLabel, forgeCard, monoCls } from './section-title'
import { StatusBadge } from './status-badge'
import { StatChip } from './stat-chip'
import { Busy, ConnectingNote, EmptyState, LoadingCards } from './empty-state'
import { defaultStateBucket, generateValuesYaml } from './values-yaml'

// ---- draft model --------------------------------------------------------------

interface Draft {
  isNew: boolean
  dbId: string | null
  firmId: string
  name: string
  purpose: string
  ownerGmail: string
  repo: string
  stateBucket: string
  inferenceEnabled: boolean
  modelRepo: string
  modelFile: string
  llamaCppRef: string
  ctx: number
  modelBackends: string[]
  harnessRuntime: string
  controlTarget: 'hf-space' | 'local'
  workerTargets: string[]
  kaggleWorkers: number
  colabWorkers: number
  kaggleSchedule: string
  hfSpaceHardware: string
  idleExitSeconds: number
  pluginBindings: string[]
  secretsRequired: string[]
  agents: AgentDef[]
}

const DEMO_DRAFT: Omit<Draft, 'isNew' | 'dbId'> = {
  firmId: 'lumen-research',
  name: 'Lumen Research Co',
  purpose:
    'Answer small research questions with a tiny open model, review every answer, and archive the results.',
  ownerGmail: 'lumen.research.co@gmail.com',
  repo: 'your-github-user/firm-lumen-research',
  stateBucket: 'file:///home/z/my-project/workspaces/lumen-research/state',
  inferenceEnabled: true,
  modelRepo: 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF',
  modelFile: 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
  llamaCppRef: 'b12103',
  ctx: 8192,
  modelBackends: ['workspace-llm'],
  harnessRuntime: 'prime-agent',
  controlTarget: 'local',
  workerTargets: ['local', 'kaggle'],
  kaggleWorkers: 1,
  colabWorkers: 0,
  kaggleSchedule: '0 */6 * * *',
  hfSpaceHardware: 'cpu-basic',
  idleExitSeconds: 900,
  pluginBindings: ['state.store', 'inference.openai_compat', 'governance.human_gate'],
  secretsRequired: ['HF_TOKEN'],
  agents: [
    {
      id: '',
      fileName: 'orchestrator.yaml',
      agentId: 'orchestrator',
      role: 'Splits incoming research questions into tasks, assigns them to the researcher, and reviews results before they are archived.',
      responsibilities: [
        'Maintain the task queue under /state/queue',
        'Review researcher output before a task is marked done',
        'Escalate anything that needs a human decision',
      ],
      plugins: ['state.store'],
      permissions: ['read_state', 'write_state'],
      reportsTo: 'human',
    },
    {
      id: '',
      fileName: 'researcher.yaml',
      agentId: 'researcher',
      role: 'Answers research tasks through the firm inference plugin and drafts the archived result.',
      responsibilities: [
        'Claim tasks from /state/queue/pending',
        'Produce an answer via inference.openai_compat',
        'Write results to /state/queue/done',
      ],
      plugins: ['inference.openai_compat', 'state.store'],
      permissions: ['read_state', 'write_state', 'call_inference'],
      reportsTo: 'orchestrator',
    },
    {
      id: '',
      fileName: 'compliance.yaml',
      agentId: 'compliance',
      role: 'Guards the human-approval gate: refuses spend, external publish, credential change and destructive actions.',
      responsibilities: [
        'Refuse constitution-gated actions with a 422 so they land in queue/failed',
        'Keep the audit log under /state/EVENTS',
      ],
      plugins: ['governance.human_gate', 'state.store'],
      permissions: ['read_state', 'gate_external_action'],
      reportsTo: 'human',
    },
  ],
}

function firmToDraft(firm: FirmDef): Draft {
  return {
    isNew: false,
    dbId: firm.id,
    firmId: firm.firmId,
    name: firm.name,
    purpose: firm.purpose,
    ownerGmail: firm.ownerGmail,
    repo: firm.repo,
    stateBucket: firm.stateBucket,
    inferenceEnabled: firm.inferenceEnabled,
    modelRepo: firm.modelRepo,
    modelFile: firm.modelFile,
    llamaCppRef: firm.llamaCppRef,
    ctx: firm.ctx,
    modelBackends: firm.modelBackends ?? [],
    harnessRuntime: firm.harnessRuntime,
    controlTarget: firm.controlTarget === 'hf-space' ? 'hf-space' : 'local',
    workerTargets: firm.workerTargets ?? [],
    kaggleWorkers: firm.kaggleWorkers,
    colabWorkers: firm.colabWorkers,
    kaggleSchedule: firm.kaggleSchedule,
    hfSpaceHardware: firm.hfSpaceHardware,
    idleExitSeconds: firm.idleExitSeconds,
    pluginBindings: firm.pluginBindings ?? [],
    secretsRequired: firm.secretsRequired ?? [],
    agents: firm.agents ?? [],
  }
}

function draftToInput(draft: Draft): FirmInput {
  return {
    firmId: draft.firmId.trim(),
    name: draft.name.trim(),
    purpose: draft.purpose.trim(),
    ownerGmail: draft.ownerGmail.trim(),
    repo: draft.repo.trim(),
    stateBucket: draft.stateBucket.trim() || defaultStateBucket(draft.firmId.trim()),
    inferenceEnabled: draft.inferenceEnabled,
    modelRepo: draft.modelRepo.trim(),
    modelFile: draft.modelFile.trim(),
    llamaCppRef: draft.llamaCppRef.trim(),
    ctx: Number(draft.ctx) || 0,
    modelBackends: draft.modelBackends,
    harnessRuntime: draft.harnessRuntime.trim(),
    controlTarget: draft.controlTarget,
    workerTargets: draft.workerTargets,
    kaggleWorkers: Number(draft.kaggleWorkers) || 0,
    colabWorkers: Number(draft.colabWorkers) || 0,
    kaggleSchedule: draft.kaggleSchedule.trim(),
    hfSpaceHardware: draft.hfSpaceHardware.trim(),
    idleExitSeconds: Number(draft.idleExitSeconds) || 0,
    pluginBindings: draft.pluginBindings,
    secretsRequired: draft.secretsRequired,
    agents: draft.agents.map((a) => ({
      ...a,
      fileName: a.fileName.trim(),
      agentId: a.agentId.trim(),
      role: a.role.trim(),
      responsibilities: a.responsibilities.map((r) => r.trim()).filter(Boolean),
      plugins: a.plugins,
      permissions: a.permissions,
      reportsTo: a.reportsTo.trim() || 'human',
    })),
  }
}

const FIRM_ID_RE = /^[a-z][a-z0-9-]{2,30}$/
const UPPER_SNAKE_RE = /^[A-Z][A-Z0-9_]*$/
const UNSAFE_TEXT = /["\\{}]|\n|\r/

function validateDraft(draft: Draft): string[] {
  const errors: string[] = []
  if (!FIRM_ID_RE.test(draft.firmId.trim())) {
    errors.push('firmId must match ^[a-z][a-z0-9-]{2,30}$')
  }
  for (const field of ['name', 'purpose'] as const) {
    const value = draft[field].trim()
    if (!value) errors.push(`${field} is required`)
    if (UNSAFE_TEXT.test(value)) errors.push(`${field} must not contain " \\ { } or newlines (render.py rejects them)`)
  }
  const invalidSecrets = draft.secretsRequired.filter((s) => !UPPER_SNAKE_RE.test(s))
  if (invalidSecrets.length) errors.push(`secrets must be UPPER_SNAKE names: ${invalidSecrets.join(', ')}`)
  const allowed = ['kaggle', 'colab', 'hf-job', 'local']
  const badTargets = draft.workerTargets.filter((t) => !allowed.includes(t))
  if (badTargets.length) errors.push(`worker targets must be one of ${allowed.join(' / ')}`)
  const badFiles = draft.agents.filter((a) => !a.fileName.trim().endsWith('.yaml'))
  if (badFiles.length) errors.push('every agent fileName must end in .yaml')
  return errors
}

// ---- agent editor --------------------------------------------------------------

const REPORTS_TO_PRESETS = ['human', 'orchestrator', 'researcher', 'compliance']

function AgentCard({
  agent,
  pluginIds,
  catalogueOk,
  onChange,
  onRemove,
}: {
  agent: AgentDef
  pluginIds: string[]
  catalogueOk: boolean
  onChange: (agent: AgentDef) => void
  onRemove: () => void
}) {
  const set = (patch: Partial<AgentDef>) => onChange({ ...agent, ...patch })

  return (
    <Card className={`space-y-4 p-4 ${forgeCard}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 font-mono text-xs text-amber-700 dark:text-amber-400">
          <UserPlus className="size-3.5 shrink-0" />
          <span className="truncate">{agent.fileName || 'new-agent.yaml'}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove agent ${agent.agentId || 'unnamed'}`}
          className="h-9 border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <Trash2 className="mr-1 size-3" /> Remove
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`file-${agent.id}`} className="text-xs">
            <FieldLabel hint="constitution/agents/">fileName</FieldLabel>
          </Label>
          <Input
            id={`file-${agent.id}`}
            value={agent.fileName}
            onChange={(e) => set({ fileName: e.target.value })}
            className={`h-11 ${monoCls} `}
            placeholder="researcher.yaml"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`id-${agent.id}`} className="text-xs">
            <FieldLabel>agentId</FieldLabel>
          </Label>
          <Input
            id={`id-${agent.id}`}
            value={agent.agentId}
            onChange={(e) => set({ agentId: e.target.value })}
            className={`h-11 ${monoCls}`}
            placeholder="researcher"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`role-${agent.id}`} className="text-xs">
          <FieldLabel>role</FieldLabel>
        </Label>
        <Textarea
          id={`role-${agent.id}`}
          value={agent.role}
          onChange={(e) => set({ role: e.target.value })}
          rows={2}
          placeholder="What this agent does for the firm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`resp-${agent.id}`} className="text-xs">
          <FieldLabel hint="one per line">responsibilities</FieldLabel>
        </Label>
        <Textarea
          id={`resp-${agent.id}`}
          value={agent.responsibilities.join('\n')}
          onChange={(e) => set({ responsibilities: e.target.value.split('\n') })}
          rows={4}
          className={monoCls}
          placeholder={'Claim tasks from /state/queue/pending\nWrite results to /state/queue/done'}
        />
      </div>

      <div className="space-y-1.5">
        <FieldLabel hint="catalogue/plugins.yaml">plugins</FieldLabel>
        {catalogueOk ? (
          <div className="grid gap-1.5 rounded-md border border-stone-200 p-2 dark:border-stone-800 sm:grid-cols-2">
            {pluginIds.map((id) => (
              <label
                key={id}
                className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-stone-100 dark:hover:bg-stone-800/60"
              >
                <Checkbox
                  checked={agent.plugins.includes(id)}
                  onCheckedChange={(checked) =>
                    set({
                      plugins: checked
                        ? [...agent.plugins, id]
                        : agent.plugins.filter((p) => p !== id),
                    })
                  }
                  aria-label={`plugin ${id}`}
                  className="data-[state=checked]:border-amber-600 data-[state=checked]:bg-amber-600 data-[state=checked]:text-stone-950"
                />
                <span className={monoCls}>{id}</span>
              </label>
            ))}
          </div>
        ) : (
          <ChipsInput
            values={agent.plugins}
            onChange={(plugins) => set({ plugins })}
            placeholder="state.store"
            ariaLabel="Agent plugins"
          />
        )}
      </div>

      <div className="space-y-1.5">
        <FieldLabel hint="e.g. read_state, call_inference">permissions</FieldLabel>
        <ChipsInput
          values={agent.permissions}
          onChange={(permissions) => set({ permissions })}
          placeholder="read_state"
          ariaLabel="Agent permissions"
        />
      </div>

      <div className="space-y-1.5">
        <FieldLabel hint="human / agent id — free text allowed">reports to</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={agent.reportsTo}
            onChange={(e) => set({ reportsTo: e.target.value })}
            className={`h-11 sm:max-w-56 ${monoCls}`}
            placeholder="human"
            aria-label="Reports to"
          />
          <div className="flex flex-wrap gap-1">
            {REPORTS_TO_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => set({ reportsTo: preset })}
                className="rounded-full border border-stone-300 px-2 py-0.5 font-mono text-[11px] text-stone-500 hover:border-amber-600/60 hover:text-amber-700 dark:border-stone-700 dark:text-stone-400 dark:hover:text-amber-400"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ---- firm editor (remounts per firm via key, so draft state needs no effects) --

type FirmBase = Omit<Draft, 'isNew' | 'dbId'>

function FirmEditor({
  firm,
  base,
  pluginIds,
  catalogueOk,
  onSaved,
  onDeleted,
  onDiscardNew,
}: {
  firm: FirmDef | null
  base: FirmBase
  pluginIds: string[]
  catalogueOk: boolean
  onSaved: (dbId: string) => void
  onDeleted: () => void
  onDiscardNew: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState<Draft>(() => {
    if (firm) return firmToDraft(firm)
    return {
      ...base,
      isNew: true,
      dbId: null,
      firmId: 'new-firm',
      name: 'New Firm Co',
      stateBucket: defaultStateBucket('new-firm'),
      agents: (base.agents ?? []).map((a) => ({ ...a, id: '' })),
    }
  })

  const saveMutation = useMutation({
    mutationFn: (input: FirmInput) => {
      if (draft.isNew || !draft.dbId) {
        return post<{ firm: FirmDef }>('/api/firms', input)
      }
      return patch<{ firm: FirmDef }>(`/api/firms/${draft.dbId}`, input)
    },
    retry: false,
    onSuccess: ({ firm: saved }) => {
      toast({
        title: draft.isNew ? `Firm ${saved.firmId} created` : `Firm ${saved.firmId} saved`,
        description: 'Agents replaced, decisions untouched. Rebuild to re-render the repo.',
      })
      setDraft(firmToDraft(saved))
      onSaved(saved.id)
      void queryClient.invalidateQueries({ queryKey: qk.firms })
    },
    onError: (err: Error) => {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (dbId: string) => del<{ ok: boolean }>(`/api/firms/${dbId}`),
    retry: false,
    onSuccess: () => {
      toast({ title: 'Firm deleted', description: 'Workspace directory removed with it.' })
      void queryClient.invalidateQueries({ queryKey: qk.firms })
      onDeleted()
    },
    onError: (err: Error) => {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' })
    },
  })

  const valuesYaml = useMemo(() => generateValuesYaml(draftToInput(draft)), [draft])

  const dirty = useMemo(() => {
    if (!firm || draft.isNew) return false
    return JSON.stringify(draftToInput(draft)) !== JSON.stringify(draftToInput(firmToDraft(firm)))
  }, [draft, firm])

  function save() {
    const problems = validateDraft(draft)
    if (problems.length) {
      toast({ title: 'Cannot save yet', description: problems[0], variant: 'destructive' })
      return
    }
    saveMutation.mutate(draftToInput(draft))
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {/* identity */}
        <Card className={forgeCard}>
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="firm-id">
                <FieldLabel hint="^[a-z][a-z0-9-]{2,30}$">firmId</FieldLabel>
              </Label>
              <Input
                id="firm-id"
                value={draft.firmId}
                onChange={(e) => setDraft({ ...draft, firmId: e.target.value })}
                className={`h-11 ${monoCls}`}
                disabled={!draft.isNew}
                aria-describedby={draft.isNew ? undefined : 'firm-id-fixed'}
              />
              {!draft.isNew ? (
                <p id="firm-id-fixed" className="text-[11px] text-stone-500 dark:text-stone-500">
                  fixed after creation — workspace dirs and harness URLs hang off it
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="firm-name">
                <FieldLabel>name</FieldLabel>
              </Label>
              <Input
                id="firm-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="firm-purpose">
                <FieldLabel>purpose</FieldLabel>
              </Label>
              <Textarea
                id="firm-purpose"
                value={draft.purpose}
                onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="firm-gmail">
                <FieldLabel>owner gmail</FieldLabel>
              </Label>
              <Input
                id="firm-gmail"
                value={draft.ownerGmail}
                onChange={(e) => setDraft({ ...draft, ownerGmail: e.target.value })}
                className={`h-11 ${monoCls}`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="firm-repo">
                <FieldLabel hint="owner/firm-<id>">repo</FieldLabel>
              </Label>
              <Input
                id="firm-repo"
                value={draft.repo}
                onChange={(e) => setDraft({ ...draft, repo: e.target.value })}
                className={`h-11 ${monoCls}`}
              />
            </div>
          </CardContent>
        </Card>

        {/* state & inference */}
        <Card className={forgeCard}>
          <CardHeader>
            <CardTitle className="text-base">State & inference</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="firm-state">
                <FieldLabel hint="file:// URI">state bucket</FieldLabel>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="firm-state"
                  value={draft.stateBucket}
                  onChange={(e) => setDraft({ ...draft, stateBucket: e.target.value })}
                  className={`h-11 ${monoCls}`}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraft({ ...draft, stateBucket: defaultStateBucket(draft.firmId.trim()) })}
                  className="h-11 shrink-0 border-stone-300 dark:border-stone-700"
                >
                  auto
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800 sm:col-span-2">
              <div>
                <p className="text-sm font-medium text-stone-800 dark:text-stone-200">Inference enabled</p>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  llama.cpp plane (authored image sources; not exercised without GPU)
                </p>
              </div>
              <Switch
                checked={draft.inferenceEnabled}
                onCheckedChange={(checked) => setDraft({ ...draft, inferenceEnabled: checked })}
                aria-label="Toggle inference enabled"
                className="data-[state=checked]:border-amber-700 data-[state=checked]:bg-amber-600"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model-repo">
                <FieldLabel>model repo</FieldLabel>
              </Label>
              <Input
                id="model-repo"
                value={draft.modelRepo}
                onChange={(e) => setDraft({ ...draft, modelRepo: e.target.value })}
                className={`h-11 ${monoCls}`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model-file">
                <FieldLabel>model file</FieldLabel>
              </Label>
              <Input
                id="model-file"
                value={draft.modelFile}
                onChange={(e) => setDraft({ ...draft, modelFile: e.target.value })}
                className={`h-11 ${monoCls}`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llama-ref">
                <FieldLabel>llama.cpp ref</FieldLabel>
              </Label>
              <Input
                id="llama-ref"
                value={draft.llamaCppRef}
                onChange={(e) => setDraft({ ...draft, llamaCppRef: e.target.value })}
                className={`h-11 ${monoCls}`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ctx">
                <FieldLabel hint="context window">ctx</FieldLabel>
              </Label>
              <Input
                id="ctx"
                type="number"
                min={512}
                step={512}
                value={draft.ctx}
                onChange={(e) => setDraft({ ...draft, ctx: Number(e.target.value) })}
                className={`h-11 ${monoCls}`}
              />
            </div>
          </CardContent>
        </Card>

        {/* model plane + harness */}
        <Card className={forgeCard}>
          <CardHeader>
            <CardTitle className="text-base">Model plane & harness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <FieldLabel hint="routing order — e.g. workspace-llm">model backends</FieldLabel>
              <ChipsInput
                values={draft.modelBackends}
                onChange={(modelBackends) => setDraft({ ...draft, modelBackends })}
                placeholder="workspace-llm"
                ariaLabel="Model backends"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="harness-runtime">
                <FieldLabel>harness runtime</FieldLabel>
              </Label>
              <Input
                id="harness-runtime"
                value={draft.harnessRuntime}
                onChange={(e) => setDraft({ ...draft, harnessRuntime: e.target.value })}
                className={`h-11 ${monoCls}`}
                placeholder="prime-agent"
              />
            </div>
          </CardContent>
        </Card>

        {/* deploy */}
        <Card className={forgeCard}>
          <CardHeader>
            <CardTitle className="text-base">Deploy</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel>control target</FieldLabel>
              <Select
                value={draft.controlTarget}
                onValueChange={(value: 'hf-space' | 'local') => setDraft({ ...draft, controlTarget: value })}
              >
                <SelectTrigger className="h-11 w-full" aria-label="Control target">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">local</SelectItem>
                  <SelectItem value="hf-space">hf-space</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <FieldLabel hint="when control = hf-space">hf space hardware</FieldLabel>
              <Select
                value={draft.hfSpaceHardware}
                onValueChange={(hfSpaceHardware) => setDraft({ ...draft, hfSpaceHardware })}
              >
                <SelectTrigger className="h-11 w-full" aria-label="HF space hardware">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpu-basic">cpu-basic</SelectItem>
                  <SelectItem value="cpu-upgrade">cpu-upgrade</SelectItem>
                  <SelectItem value="zero-a10g">zero-a10g</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <FieldLabel hint="subset of kaggle | colab | hf-job | local">worker targets</FieldLabel>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {['kaggle', 'colab', 'hf-job', 'local'].map((target) => (
                  <label
                    key={target}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-stone-200 px-3 text-sm hover:border-amber-700/40 dark:border-stone-800"
                  >
                    <Checkbox
                      checked={draft.workerTargets.includes(target)}
                      onCheckedChange={(checked) =>
                        setDraft({
                          ...draft,
                          workerTargets: checked
                            ? [...draft.workerTargets, target]
                            : draft.workerTargets.filter((t) => t !== target),
                        })
                      }
                      aria-label={`worker target ${target}`}
                      className="data-[state=checked]:border-amber-600 data-[state=checked]:bg-amber-600 data-[state=checked]:text-stone-950"
                    />
                    <span className={monoCls}>{target}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kaggle-workers">
                <FieldLabel>kaggle workers</FieldLabel>
              </Label>
              <Input
                id="kaggle-workers"
                type="number"
                min={0}
                value={draft.kaggleWorkers}
                onChange={(e) => setDraft({ ...draft, kaggleWorkers: Number(e.target.value) })}
                className={`h-11 ${monoCls}`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="colab-workers">
                <FieldLabel>colab workers</FieldLabel>
              </Label>
              <Input
                id="colab-workers"
                type="number"
                min={0}
                value={draft.colabWorkers}
                onChange={(e) => setDraft({ ...draft, colabWorkers: Number(e.target.value) })}
                className={`h-11 ${monoCls}`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kaggle-schedule">
                <FieldLabel hint="cron">kaggle schedule</FieldLabel>
              </Label>
              <Input
                id="kaggle-schedule"
                value={draft.kaggleSchedule}
                onChange={(e) => setDraft({ ...draft, kaggleSchedule: e.target.value })}
                className={`h-11 ${monoCls}`}
                placeholder="0 */6 * * *"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idle-exit">
                <FieldLabel hint="seconds">idle exit</FieldLabel>
              </Label>
              <Input
                id="idle-exit"
                type="number"
                min={0}
                value={draft.idleExitSeconds}
                onChange={(e) => setDraft({ ...draft, idleExitSeconds: Number(e.target.value) })}
                className={`h-11 ${monoCls}`}
              />
            </div>
          </CardContent>
        </Card>

        {/* agents */}
        <Card className={forgeCard}>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Agents ({draft.agents.length})</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setDraft({
                  ...draft,
                  agents: [
                    ...draft.agents,
                    {
                      id: '',
                      fileName: `agent-${draft.agents.length + 1}.yaml`,
                      agentId: `agent-${draft.agents.length + 1}`,
                      role: '',
                      responsibilities: [],
                      plugins: [],
                      permissions: [],
                      reportsTo: 'human',
                    },
                  ],
                })
              }
              className="h-9 border-amber-700/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
            >
              <Plus className="mr-1 size-3" /> Add agent
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {draft.agents.length === 0 ? (
              <EmptyState
                icon={<UserPlus />}
                title="No agents"
                description="A firm needs at least one agent file under constitution/agents/."
              />
            ) : (
              draft.agents.map((agent, index) => (
                <AgentCard
                  key={agent.id || `new-${index}`}
                  agent={agent}
                  pluginIds={pluginIds}
                  catalogueOk={catalogueOk}
                  onChange={(next) => {
                    const agents = [...draft.agents]
                    agents[index] = next
                    setDraft({ ...draft, agents })
                  }}
                  onRemove={() => setDraft({ ...draft, agents: draft.agents.filter((_, i) => i !== index) })}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* plugins + secrets */}
        <Card className={forgeCard}>
          <CardHeader>
            <CardTitle className="text-base">Plugins & secrets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <FieldLabel hint="validate.py rejects unknown ids">plugin bindings</FieldLabel>
              {catalogueOk ? (
                <div className="grid gap-1.5 rounded-md border border-stone-200 p-2 dark:border-stone-800 sm:grid-cols-2">
                  {pluginIds.map((id) => (
                    <label
                      key={id}
                      className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-stone-100 dark:hover:bg-stone-800/60"
                    >
                      <Checkbox
                        checked={draft.pluginBindings.includes(id)}
                        onCheckedChange={(checked) =>
                          setDraft({
                            ...draft,
                            pluginBindings: checked
                              ? [...draft.pluginBindings, id]
                              : draft.pluginBindings.filter((p) => p !== id),
                          })
                        }
                        aria-label={`binding ${id}`}
                        className="data-[state=checked]:border-amber-600 data-[state=checked]:bg-amber-600 data-[state=checked]:text-stone-950"
                      />
                      <span className={monoCls}>{id}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <ChipsInput
                  values={draft.pluginBindings}
                  onChange={(pluginBindings) => setDraft({ ...draft, pluginBindings })}
                  placeholder="state.store"
                  ariaLabel="Plugin bindings"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <FieldLabel hint="names only — never values">secrets required</FieldLabel>
              <ChipsInput
                values={draft.secretsRequired}
                onChange={(secretsRequired) => setDraft({ ...draft, secretsRequired })}
                placeholder="HF_TOKEN"
                validate={(value) => UPPER_SNAKE_RE.test(value)}
                invalidMessage="secrets are UPPER_SNAKE names, e.g. HF_TOKEN"
                ariaLabel="Secrets required"
              />
            </div>
          </CardContent>
        </Card>

        {/* save / delete */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            className="h-11 border border-amber-700/60 bg-amber-600 font-semibold text-stone-950 shadow-sm hover:bg-amber-500"
          >
            {saveMutation.isPending ? (
              <Busy>{draft.isNew ? 'Creating firm…' : 'Saving…'}</Busy>
            ) : (
              <>
                <Save className="mr-1.5 size-4" /> {draft.isNew ? 'Create firm' : 'Save firm'}
              </>
            )}
          </Button>
          {draft.isNew ? (
            <Button
              type="button"
              variant="outline"
              onClick={onDiscardNew}
              className="h-11 border-stone-300 dark:border-stone-700"
            >
              Discard draft
            </Button>
          ) : null}
          {!draft.isNew && draft.dbId ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="mr-1.5 size-4" /> Delete firm
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {draft.firmId}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the database row (agents, decisions, runs) and the{' '}
                    <code className={monoCls}>workspaces/{draft.firmId}/</code> directory. There is no undo.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate(draft.dbId as string)}
                    className="h-11 border border-red-700/60 bg-red-600 text-white hover:bg-red-500"
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Delete permanently'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {dirty ? <StatusBadge tone="warn">unsaved changes</StatusBadge> : null}
        </div>
      </form>

      {/* ---- values.yaml live preview ---- */}
      <aside aria-label="values.yaml live preview" className="xl:sticky xl:top-24 xl:self-start">
        <Card className={forgeCard}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 text-sm ${monoCls}`}>
              <span className="text-amber-700 dark:text-amber-400">values.yaml</span>
              <span className="text-stone-400">· live preview</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CodeBlock code={valuesYaml} maxHeight="max-h-[560px]" label="ws/values.yaml" />
            <p className="mt-2 text-[11px] leading-relaxed text-stone-500 dark:text-stone-500">
              Generated client-side to mirror the backend serializer 1:1 — same keys, same order. The
              backend&apos;s copy is the authority at build time.
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}

// ---- firms panel ---------------------------------------------------------------

export function FirmsPanel() {
  const { data, isLoading, isError, error, refetch } = useFirms()
  const catalogue = useCatalogue()

  const firms = useMemo(
    () => [...(data?.firms ?? [])].sort((a, b) => a.firmId.localeCompare(b.firmId)),
    [data],
  )
  const pluginIds = useMemo(
    () => (catalogue.data?.plugins ?? []).map((p) => p.id),
    [catalogue.data],
  )

  // null = "first firm in the list"; the editor derives the firm from this.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newDraftOpen, setNewDraftOpen] = useState(false)

  const firm = firms.find((f) => f.id === selectedId) ?? firms[0] ?? null

  const newFirmBase = useMemo<FirmBase>(() => {
    const demo = firms.find((f) => f.firmId === 'lumen-research') ?? firms[0]
    if (demo) return firmToDraft(demo)
    return DEMO_DRAFT
  }, [firms])

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="stage 6 · compose"
        title="Firms"
        description="Edit values and agents; the right column previews the exact values.yaml the backend will hand to render.py. Saving updates the database — press Build afterwards to re-render the repo."
        actions={
          <Button
            type="button"
            onClick={() => {
              setNewDraftOpen(true)
              setSelectedId(null)
            }}
            disabled={newDraftOpen}
            className="h-11 border border-amber-700/60 bg-amber-600 font-semibold text-stone-950 shadow-sm hover:bg-amber-500 disabled:opacity-60"
          >
            <FilePlus2 className="mr-1.5 size-4" /> New firm
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* ---- left: firm list ---- */}
        <div className="space-y-3 lg:col-span-4 xl:col-span-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500 dark:text-stone-500">
            {newDraftOpen ? 'new firm (draft)' : `${firms.length} firm${firms.length === 1 ? '' : 's'}`}
          </p>
          {isLoading ? <LoadingCards count={2} /> : null}
          {isError ? <ConnectingNote error={error} onRetry={() => refetch()} /> : null}
          {!isLoading && !isError && firms.length === 0 ? (
            <EmptyState
              icon={<Boxes />}
              title="No firms yet"
              description="Create one from the demo values — everything stays editable."
              action={
                <Button
                  type="button"
                  onClick={() => setNewDraftOpen(true)}
                  className="h-11 border border-amber-700/60 bg-amber-600 font-semibold text-stone-950 hover:bg-amber-500"
                >
                  <Plus className="mr-1 size-4" /> New firm
                </Button>
              }
            />
          ) : null}
          <div className="grid max-h-[560px] gap-3 overflow-y-auto pe-1 lg:grid-cols-1">
            {firms.map((f) => {
              const active = !newDraftOpen && f.id === firm?.id
              return (
                <motion.button
                  key={f.id}
                  type="button"
                  whileHover={{ y: -2 }}
                  onClick={() => {
                    setSelectedId(f.id)
                    setNewDraftOpen(false)
                  }}
                  aria-pressed={active}
                  className={`w-full rounded-xl border p-4 text-left shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 ${
                    active
                      ? 'border-amber-600/70 bg-amber-500/10 dark:border-amber-600/50'
                      : 'border-stone-200 bg-white hover:border-amber-700/40 dark:border-amber-900/40 dark:bg-stone-900/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm font-semibold ${monoCls} text-amber-700 dark:text-amber-400`}>
                      {f.firmId}
                    </span>
                    {f.lastRun ? (
                      <StatusBadge tone={f.lastRun.status === 'pass' ? 'ok' : 'bad'}>{f.lastRun.kind}</StatusBadge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-stone-700 dark:text-stone-300">{f.name}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <StatChip label="agents" value={f.agents?.length ?? 0} />
                    <StatChip label="targets" value={(f.workerTargets ?? []).join(' + ') || '—'} mono />
                  </div>
                </motion.button>
              )
            })}
          </div>
        </div>

        {/* ---- right: editor ---- */}
        <div className="lg:col-span-8 xl:col-span-9">
          {newDraftOpen ? (
            <FirmEditor
              key="new-firm"
              firm={null}
              base={newFirmBase}
              pluginIds={pluginIds}
              catalogueOk={catalogue.isSuccess}
              onSaved={() => setNewDraftOpen(false)}
              onDeleted={() => setNewDraftOpen(false)}
              onDiscardNew={() => setNewDraftOpen(false)}
            />
          ) : firm ? (
            <FirmEditor
              key={firm.id}
              firm={firm}
              base={newFirmBase}
              pluginIds={pluginIds}
              catalogueOk={catalogue.isSuccess}
              onSaved={(dbId) => setSelectedId(dbId)}
              onDeleted={() => setSelectedId(null)}
              onDiscardNew={() => setNewDraftOpen(false)}
            />
          ) : (
            <EmptyState
              icon={<Wand2 />}
              title="Select a firm"
              description="Pick a firm on the left, or start a new one prefilled with the demo values."
            />
          )}
        </div>
      </div>
    </div>
  )
}
