// Firm Forge — shared server-side helpers: safe Json coercion, DB row → DTO mappers,
// and input validation for the firm/evidence/decision routes.
// Server-only, framework-free (routes build their own NextResponse).
import type { Agent, Decision, EvidenceRecord, Firm, TestRun } from '@prisma/client'
import type {
  AgentDef,
  DecisionDef,
  E2EStep,
  EvidenceDef,
  EvidenceInput,
  FirmDef,
  Manifest,
  TestRunDef,
} from './types'

// ---------- safe coercion (Prisma Json fields come back as unknown) ----------

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

export function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function asBoolean(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback
}

export function asSteps(v: unknown): E2EStep[] {
  if (!Array.isArray(v)) return []
  const out: E2EStep[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const status = o.status === 'pass' || o.status === 'fail' ? o.status : 'skip'
    out.push({ name: asString(o.name), status, detail: asString(o.detail), ms: asNumber(o.ms) })
  }
  return out
}

export function asManifest(v: unknown): Manifest | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const assetsRaw = Array.isArray(o.assets) ? o.assets : []
  const assets = assetsRaw
    .filter((a) => a && typeof a === 'object')
    .map((a) => {
      const r = a as Record<string, unknown>
      return {
        name: asString(r.name),
        target: asString(r.target),
        endpoint: asString(r.endpoint) || undefined,
        health: asString(r.health) || undefined,
        result: asString(r.result) || undefined,
      }
    })
  const e2e = (o.end_to_end && typeof o.end_to_end === 'object' ? o.end_to_end : {}) as Record<string, unknown>
  return {
    firm_id: asString(o.firm_id),
    verified_at: asString(o.verified_at),
    commit: asString(o.commit),
    assets,
    end_to_end: { task: asString(e2e.task), result: asString(e2e.result) },
    limits: asStringArray(o.limits),
    mocked: asStringArray(o.mocked),
  }
}

// ---------- DB row → DTO mappers ----------

export function toAgentDef(a: Agent): AgentDef {
  return {
    id: a.id,
    fileName: a.fileName,
    agentId: a.agentId,
    role: a.role,
    responsibilities: asStringArray(a.responsibilities),
    plugins: asStringArray(a.plugins),
    permissions: asStringArray(a.permissions),
    reportsTo: a.reportsTo,
  }
}

export function toDecisionDef(d: Decision): DecisionDef {
  return {
    id: d.id,
    firmId: d.firmId,
    capability: d.capability,
    choice: d.choice,
    evidence: d.evidence,
    verifiedAt: d.verifiedAt,
    decidedAt: d.decidedAt.toISOString(),
  }
}

export function toEvidenceDef(e: EvidenceRecord): EvidenceDef {
  return {
    id: e.id,
    provider: e.provider,
    capability: e.capability,
    execution: e.execution,
    pricingModel: e.pricingModel,
    cardRequired: e.cardRequired,
    computeCost: e.computeCost,
    sourceUrl: e.sourceUrl,
    verifiedAt: e.verifiedAt,
    termsExcerpt: e.termsExcerpt,
    limits: asStringArray(e.limits),
    restrictions: asStringArray(e.restrictions),
    createdAt: e.createdAt.toISOString(),
  }
}

export function toTestRunDef(r: TestRun): TestRunDef {
  const kind = r.kind === 'e2e' || r.kind === 'selftest' || r.kind === 'build' ? r.kind : 'build'
  return {
    id: r.id,
    kind,
    status: r.status === 'pass' ? 'pass' : 'fail',
    steps: asSteps(r.steps),
    manifest: asManifest(r.manifest),
    summary: r.summary ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

export type FirmWithRelations = Firm & { agents: Agent[]; decisions: Decision[] }

export function toFirmDef(f: FirmWithRelations, lastRun?: TestRun | null): FirmDef {
  return {
    id: f.id,
    firmId: f.firmId,
    name: f.name,
    purpose: f.purpose,
    ownerGmail: f.ownerGmail,
    repo: f.repo,
    stateBucket: f.stateBucket,
    inferenceEnabled: f.inferenceEnabled,
    modelRepo: f.modelRepo,
    modelFile: f.modelFile,
    llamaCppRef: f.llamaCppRef,
    ctx: f.ctx,
    modelBackends: asStringArray(f.modelBackends),
    harnessRuntime: f.harnessRuntime,
    controlTarget: f.controlTarget === 'hf-space' ? 'hf-space' : 'local',
    workerTargets: asStringArray(f.workerTargets),
    kaggleWorkers: f.kaggleWorkers,
    colabWorkers: f.colabWorkers,
    kaggleSchedule: f.kaggleSchedule,
    hfSpaceHardware: f.hfSpaceHardware,
    idleExitSeconds: f.idleExitSeconds,
    pluginBindings: asStringArray(f.pluginBindings),
    secretsRequired: asStringArray(f.secretsRequired),
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    agents: f.agents.map(toAgentDef),
    decisions: f.decisions.map(toDecisionDef),
    lastRun: lastRun ? toTestRunDef(lastRun) : null,
  }
}

// ---------- firm input validation (POST /api/firms, PATCH /api/firms/[dbId]) ----------

export const FIRM_ID_RE = /^[a-z][a-z0-9-]{2,30}$/
export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]*$/
/** render.py rejects quote, backslash, newline, braces — validate early for name/purpose. */
export const UNSAFE_TEXT_RE = /["\\{}\n\r]/
export const WORKER_TARGETS = ['kaggle', 'colab', 'hf-job', 'local'] as const
export const CONTROL_TARGETS = ['hf-space', 'local'] as const
export const EXECUTION_CLASSES = [
  'persistent_service',
  'interactive_api',
  'batch_worker',
  'ephemeral_notebook',
] as const
export const PRICING_MODELS = [
  'free_forever',
  'open_source_self_host',
  'free_tier',
  'trial',
  'paid_only',
  'discontinued',
] as const
export const NEEDS = ['persistent_serving', 'interactive', 'batch', 'experimentation'] as const

export interface ValidationIssue {
  field: string
  message: string
}

export interface FirmWriteData {
  firmId?: string
  name?: string
  purpose?: string
  ownerGmail?: string
  repo?: string
  inferenceEnabled?: boolean
  modelRepo?: string
  modelFile?: string
  llamaCppRef?: string
  ctx?: number
  modelBackends?: string[]
  harnessRuntime?: string
  controlTarget?: string
  workerTargets?: string[]
  kaggleWorkers?: number
  colabWorkers?: number
  kaggleSchedule?: string
  hfSpaceHardware?: string
  idleExitSeconds?: number
  pluginBindings?: string[]
  secretsRequired?: string[]
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function strField(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  return typeof v === 'string' ? v : null
}

function numField(body: Record<string, unknown>, key: string): number | undefined | null {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function boolField(body: Record<string, unknown>, key: string): boolean | undefined | null {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return null
}

function strArrayField(body: Record<string, unknown>, key: string): string[] | undefined | null {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) return null
  const items: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') return null
    items.push(item)
  }
  return items
}

/**
 * Validate a FirmInput JSON body.
 * mode 'create': firmId/name/purpose/ownerGmail/repo required.
 * mode 'update': every field optional (absent = unchanged).
 * Returns the validated scalar fields + (when provided) the agents array.
 */
export function validateFirmInput(
  body: unknown,
  mode: 'create' | 'update',
): { issues: ValidationIssue[]; data: FirmWriteData; agents?: AgentDef[] } {
  const issues: ValidationIssue[] = []
  const data: FirmWriteData = {}
  if (!isObj(body)) {
    issues.push({ field: 'body', message: 'expected a JSON object' })
    return { issues, data }
  }

  const firmId = strField(body, 'firmId')
  if (firmId !== undefined) {
    if (!FIRM_ID_RE.test(firmId)) {
      issues.push({ field: 'firmId', message: 'must match ^[a-z][a-z0-9-]{2,30}$' })
    } else {
      data.firmId = firmId
    }
  } else if (mode === 'create') {
    issues.push({ field: 'firmId', message: 'required' })
  }

  for (const key of ['name', 'purpose'] as const) {
    const v = strField(body, key)
    if (v !== undefined) {
      if (v.trim() === '') issues.push({ field: key, message: 'must be non-empty' })
      else if (UNSAFE_TEXT_RE.test(v)) {
        issues.push({ field: key, message: 'must not contain quote, backslash, brace or newline (render.py rejects them)' })
      } else data[key] = v
    } else if (mode === 'create') {
      issues.push({ field: key, message: 'required' })
    }
  }

  for (const key of ['ownerGmail', 'repo'] as const) {
    const v = strField(body, key)
    if (v !== undefined) {
      if (v.trim() === '') issues.push({ field: key, message: 'must be non-empty' })
      else data[key] = v
    } else if (mode === 'create') {
      issues.push({ field: key, message: 'required' })
    }
  }

  for (const key of ['modelRepo', 'modelFile', 'llamaCppRef', 'harnessRuntime', 'kaggleSchedule', 'hfSpaceHardware'] as const) {
    const v = strField(body, key)
    if (v !== undefined) data[key] = v
  }

  const inferenceEnabled = boolField(body, 'inferenceEnabled')
  if (inferenceEnabled === null) issues.push({ field: 'inferenceEnabled', message: 'must be a boolean' })
  else if (inferenceEnabled !== undefined) data.inferenceEnabled = inferenceEnabled

  for (const key of ['ctx', 'kaggleWorkers', 'colabWorkers', 'idleExitSeconds'] as const) {
    const v = numField(body, key)
    if (v === null) issues.push({ field: key, message: 'must be a number' })
    else if (v !== undefined) {
      if (!Number.isInteger(v) || v < 0) issues.push({ field: key, message: 'must be a non-negative integer' })
      else data[key] = v
    }
  }

  for (const key of ['modelBackends', 'pluginBindings'] as const) {
    const v = strArrayField(body, key)
    if (v === null) issues.push({ field: key, message: 'must be an array of strings' })
    else if (v !== undefined) {
      if (v.some((s) => s.trim() === '')) issues.push({ field: key, message: 'must not contain empty items' })
      else data[key] = v
    }
  }

  const workerTargets = strArrayField(body, 'workerTargets')
  if (workerTargets === null) issues.push({ field: 'workerTargets', message: 'must be an array of strings' })
  else if (workerTargets !== undefined) {
    const bad = workerTargets.filter((t) => !(WORKER_TARGETS as readonly string[]).includes(t))
    if (bad.length > 0) issues.push({ field: 'workerTargets', message: `unsupported target(s): ${bad.join(', ')}` })
    else data.workerTargets = workerTargets
  }

  const controlTarget = strField(body, 'controlTarget')
  if (controlTarget !== undefined) {
    if (!(CONTROL_TARGETS as readonly string[]).includes(controlTarget)) {
      issues.push({ field: 'controlTarget', message: 'must be hf-space or local' })
    } else data.controlTarget = controlTarget
  }

  const secretsRequired = strArrayField(body, 'secretsRequired')
  if (secretsRequired === null) issues.push({ field: 'secretsRequired', message: 'must be an array of strings' })
  else if (secretsRequired !== undefined) {
    const bad = secretsRequired.filter((s) => !SECRET_NAME_RE.test(s))
    if (bad.length > 0) {
      issues.push({ field: 'secretsRequired', message: `must be UPPER_SNAKE names only, got: ${bad.join(', ')}` })
    } else data.secretsRequired = secretsRequired
  }

  // agents (optional in both modes; when present they REPLACE the firm's agents)
  let parsedAgents: AgentDef[] | undefined
  if (body.agents !== undefined) {
    const raw = body.agents
    if (!Array.isArray(raw)) {
      issues.push({ field: 'agents', message: 'must be an array' })
    } else if (raw.length === 0) {
      issues.push({ field: 'agents', message: 'at least one agent is required' })
    } else {
      const agents: AgentDef[] = []
      const seenFiles = new Set<string>()
      raw.forEach((item, i) => {
        if (!isObj(item)) {
          issues.push({ field: `agents[${i}]`, message: 'must be an object' })
          return
        }
        const fileName = asString(item.fileName)
        const agentId = asString(item.agentId ?? item.id)
        const role = asString(item.role)
        const reportsTo = asString(item.reportsTo, 'human')
        const responsibilities = asStringArray(item.responsibilities)
        const plugins = asStringArray(item.plugins)
        const permissions = asStringArray(item.permissions)
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.yaml$/.test(fileName)) {
          issues.push({ field: `agents[${i}].fileName`, message: 'must be a simple file name ending in .yaml' })
          return
        }
        if (seenFiles.has(fileName)) {
          issues.push({ field: `agents[${i}].fileName`, message: `duplicate agent file ${fileName}` })
          return
        }
        seenFiles.add(fileName)
        if (agentId.trim() === '') issues.push({ field: `agents[${i}].agentId`, message: 'required' })
        if (role.trim() === '') issues.push({ field: `agents[${i}].role`, message: 'required' })
        if (responsibilities.length === 0) {
          issues.push({ field: `agents[${i}].responsibilities`, message: 'at least one responsibility is required' })
        }
        if (plugins.length === 0) {
          issues.push({ field: `agents[${i}].plugins`, message: 'at least one plugin binding is required (validate.py)' })
        }
        if (permissions.length === 0) {
          issues.push({ field: `agents[${i}].permissions`, message: 'at least one permission is required (validate.py)' })
        }
        agents.push({
          id: asString(item.id),
          fileName,
          agentId,
          role,
          responsibilities,
          plugins,
          permissions,
          reportsTo: reportsTo.trim() === '' ? 'human' : reportsTo,
        })
      })
      if (agents.length === raw.length) parsedAgents = agents
    }
  }

  return { issues, data, agents: parsedAgents }
}

/** Default agent trio used when a firm is created without agents. */
export function defaultAgents(): AgentDef[] {
  return [
    {
      id: '',
      fileName: 'orchestrator.yaml',
      agentId: 'orchestrator',
      role: 'Splits incoming questions into tasks, assigns them to the researcher, and reviews results before they are archived.',
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
  ]
}

// ---------- evidence input validation ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validateEvidenceInput(body: unknown, partial = false): { issues: ValidationIssue[]; data: Partial<EvidenceInput> } {
  const issues: ValidationIssue[] = []
  const data: Partial<EvidenceInput> = {}
  if (!isObj(body)) {
    issues.push({ field: 'body', message: 'expected a JSON object' })
    return { issues, data }
  }
  for (const key of ['provider', 'capability', 'execution', 'pricingModel', 'sourceUrl', 'verifiedAt', 'termsExcerpt'] as const) {
    const v = strField(body, key)
    if (v === undefined) {
      if (!partial) issues.push({ field: key, message: 'required' })
      continue
    }
    if (v.trim() === '') {
      issues.push({ field: key, message: 'must be non-empty' })
      continue
    }
    ;(data as Record<string, unknown>)[key] = v
  }
  const execution = data.execution
  if (execution !== undefined && !(EXECUTION_CLASSES as readonly string[]).includes(execution)) {
    issues.push({ field: 'execution', message: `must be one of ${EXECUTION_CLASSES.join(' | ')}` })
  }
  const pricingModel = data.pricingModel
  if (pricingModel !== undefined && !(PRICING_MODELS as readonly string[]).includes(pricingModel)) {
    issues.push({ field: 'pricingModel', message: `must be one of ${PRICING_MODELS.join(' | ')}` })
  }
  const verifiedAt = data.verifiedAt
  if (verifiedAt !== undefined && !DATE_RE.test(verifiedAt)) {
    issues.push({ field: 'verifiedAt', message: 'must be YYYY-MM-DD' })
  }
  const cardRequired = boolField(body, 'cardRequired')
  if (cardRequired !== null && cardRequired !== undefined) data.cardRequired = cardRequired
  const computeCost = strField(body, 'computeCost')
  if (computeCost !== undefined) data.computeCost = computeCost
  for (const key of ['limits', 'restrictions'] as const) {
    const v = strArrayField(body, key)
    if (v === null) issues.push({ field: key, message: 'must be an array of strings' })
    else if (v !== undefined) (data as Record<string, unknown>)[key] = v
  }
  return { issues, data }
}

export class FirmNotFoundError extends Error {
  constructor(public readonly dbId: string) {
    super(`firm not found: ${dbId}`)
  }
}
